import { getTodayMatches, getMatchDetails, getLiveEvents, getMatchOfficials, getMatchPlays, getMatchCommentary } from '../api/espn.js';
import { getDateStringFor } from '../utils/dateUtils.js';
import { postStatus, syncRecentStatusesIfStale } from '../api/mastodon.js';
import { postMatchStatus } from './matchThread.js';
import {
    isMatchActive,
    addActiveMatch,
    clearMatchState,
    getStateStats,
    getPreviousSnapshot,
    getPreviousKeysForLeague,
    mergePreviousSnapshots,
    isEventPosted,
    markEventPosted,
    isRecoveredActiveKey,
    getLastDigestDate,
    setLastDigestDate,
} from '../state/matchState.js';
import { matchesToSnapshotMap } from '../state/snapshotContract.js';
import { computeDiff } from '../state/diffEngine.js';
import { processEvents, handleMatchEnd, markExistingEventsAsSeen, getMatchStartEventId } from './eventProcessor.js';
import { markExistingPlaysAsSeen, processEnhancedPlays } from './playProcessor.js';
import { markExistingCommentaryAsSeen, processCommentaryWithEvents } from './commentaryProcessor.js';
import { updateDayPlan, getPlannedLevel, canPost, TIER } from './postPlanner.js';
import { formatMatchStart, formatDailyDigest, formatMatchPreview, formatMatchOfficials } from './formatter.js';
import { config } from '../config.js';
import { botLogger } from '../utils/logger.js';

/**
 * Pure gate for pre-match officials posts (testable without full poll).
 * @param {{ inWindow: boolean, enabled: boolean, alreadyPosted: boolean, officialsCount: number }} opts
 * @returns {boolean}
 */
export function shouldPostMatchOfficials({ inWindow, enabled, alreadyPosted, officialsCount }) {
    return Boolean(inWindow && enabled && !alreadyPosted && officialsCount > 0);
}

/** Last successfully fetched league match list, updated every poll. */
let _lastLeagueMatches = [];

/**
 * Matches whose full-time post failed (Mastodon down after every retry): Map<matchId, { league, attempts }>.
 * The diff only emits match_end once, so they are retried at the start of later polls instead of being
 * cleared with the final score never posted. In memory only.
 */
const pendingMatchEnds = new Map();
const MAX_MATCH_END_ATTEMPTS = 10;

/**
 * Post a finished match's full time (then highlights and stats) and clear its state, or keep it pending
 * for the next poll when the full-time post did not go out.
 * @param {string|number} matchId
 * @param {Object} league
 */
async function finishMatch(matchId, league) {
    const key = String(matchId);
    let done = true;
    try {
        const details = await getMatchDetails(matchId, league.code);
        if (details) {
            details.league = league;
            done = await handleMatchEnd(normalizeMatchData(details));
        } else {
            botLogger.warn({ matchId }, 'Detalhes não disponíveis para partida finalizada (pode ter sido removida do ESPN)');
        }
    } catch (err) {
        botLogger.error({ matchId, error: err.message }, 'Erro ao processar fim da partida');
        done = false;
    }

    const attempts = (pendingMatchEnds.get(key)?.attempts ?? 0) + 1;
    if (done || attempts >= MAX_MATCH_END_ATTEMPTS) {
        if (!done) botLogger.error({ matchId, attempts }, 'Fim da partida não postado após várias tentativas; desistindo');
        pendingMatchEnds.delete(key);
        clearMatchState(matchId);
    } else {
        pendingMatchEnds.set(key, { league, attempts });
    }
}

/** Returns the most recent cross-league match list (for mention listener schedule replies). */
export function getLastLeagueMatches() { return _lastLeagueMatches; }

/**
 * Initialize the match monitor
 */
export async function initialize() {
    botLogger.info('Inicializando');
    const activeLeagues = config.activeLeagues || [];
    botLogger.info({ leagues: activeLeagues.map(l => l.name) }, 'Ligas ativas');
    return true;
}

/**
 * Main polling loop - build snapshots, compute diff, act only on changes, then poll events for live matches.
 * @returns {{ nextIntervalMs: number }}
 */
export async function poll() {
    if (!config.activeLeagues || config.activeLeagues.length === 0) {
        botLogger.warn('Nenhuma liga configurada, pulando poll');
        return { nextIntervalMs: config.bot.pollIntervalHibernationMs };
    }

    const allSnapshotEntries = [];
    /** Timestamps (ms) of scheduled start for matches with status 'pre' and valid startTime (all leagues). */
    const preMatchStartTimestamps = [];

    // Collect all league matches first so the daily digest can show a full cross-league schedule.
    /** @type {Array<{ league: Object, matches: Array }>} */
    const allLeagueMatches = [];
    for (const league of config.activeLeagues) {
        try {
            const matches = await getTodayMatches(league.code);
            allLeagueMatches.push({ league, matches });
        } catch (error) {
            botLogger.error({ league: league.name, error: error.message }, 'Erro ao buscar partidas');
            allLeagueMatches.push({ league, matches: [] });
        }
    }
    _lastLeagueMatches = allLeagueMatches;

    // Smart schedule: plan the day's content levels from its overlapping matches (once per day)
    if (config.planner.enabled) {
        if (allLeagueMatches.some(({ matches }) => matches.length > 0)) {
            await syncRecentStatusesIfStale();
        }
        updateDayPlan(allLeagueMatches);
    }

    // Full-time posts that failed on an earlier poll: retry so the final score is not lost
    for (const [matchId, { league }] of [...pendingMatchEnds]) {
        await finishMatch(matchId, league);
    }

    // Daily digest — fire once per calendar day across all leagues
    if (config.events.dailyDigest) {
        const today = getDateStringFor(new Date(), config.timezone);
        if (getLastDigestDate() !== today) {
            const hasMatches = allLeagueMatches.some(({ matches }) => matches.length > 0);
            if (hasMatches) {
                try {
                    const digestText = formatDailyDigest(allLeagueMatches);
                    // Only mark the day done once it went out; otherwise the next poll retries
                    if (await postStatus(digestText)) {
                        setLastDigestDate(today);
                        botLogger.info('Digest diário postado');
                    } else {
                        botLogger.error('Digest diário não publicado; nova tentativa no próximo poll');
                    }
                } catch (err) {
                    botLogger.error({ error: err.message }, 'Erro ao postar digest diário');
                }
            } else {
                // No matches today — still mark as seen so we don't retry every poll
                setLastDigestDate(today);
            }
        }
    }

    for (const { league, matches } of allLeagueMatches) {
        try {
            botLogger.info({ league: league.name, matchCount: matches.length }, 'Partidas encontradas');

            const newSnapshotMap = matchesToSnapshotMap(matches);
            for (const match of matches) {
                const matchId = match.id != null ? String(match.id) : '';
                const snap = newSnapshotMap.get(matchId);
                if (snap?.status === 'pre' && match.startTime) {
                    const t = new Date(match.startTime).getTime();
                    if (!Number.isNaN(t)) preMatchStartTimestamps.push(t);

                    const inWindow = t - Date.now() <= config.bot.pollWindowBeforeMatchMs;
                    const matchData = inWindow ? normalizeMatchData({ ...match, league }) : null;

                    // Pre-match preview — fire once when the match enters the poll window
                    if (config.events.matchPreview) {
                        const previewId = `${matchId}-preview`;
                        if (inWindow && !isEventPosted(previewId) && canPost(matchId, TIER.STANDARD)) {
                            try {
                                const previewText = formatMatchPreview(matchData);
                                if (await postMatchStatus(matchId, previewText)) {
                                    markEventPosted(previewId);
                                    botLogger.info({ matchId }, 'Preview pré-jogo postado');
                                }
                            } catch (err) {
                                botLogger.error({ matchId, error: err.message }, 'Erro ao postar preview');
                            }
                        }
                    }

                    // Pre-match officials — once when ESPN publishes the referee list
                    if (config.events.matchOfficials && inWindow && canPost(matchId, TIER.STANDARD)) {
                        const officialsId = `${matchId}-officials`;
                        if (!isEventPosted(officialsId)) {
                            try {
                                const officials = await getMatchOfficials(matchId, league.code);
                                if (shouldPostMatchOfficials({
                                    inWindow: true,
                                    enabled: true,
                                    alreadyPosted: false,
                                    officialsCount: officials.length,
                                })) {
                                    const text = formatMatchOfficials(matchData, officials);
                                    if (text) {
                                        const posted = await postMatchStatus(matchId, text);
                                        if (posted) {
                                            markEventPosted(officialsId);
                                            botLogger.info({ matchId }, 'Árbitros postados');
                                        }
                                    }
                                }
                            } catch (err) {
                                botLogger.error({ matchId, error: err.message }, 'Erro ao postar árbitros');
                            }
                        }
                    }
                }
            }
            const { actions, snapshotEntries } = computeDiff(
                league.code,
                newSnapshotMap,
                (key) => getPreviousSnapshot(key),
                () => getPreviousKeysForLeague(league.code)
            );
            allSnapshotEntries.push(...snapshotEntries);

            for (const action of actions) {
                if (action.type === 'match_start') {
                    const matchId = String(action.snapshot.id);
                    botLogger.info({ matchId, league: league.name }, 'Partida iniciada');
                    const details = await getMatchDetails(action.snapshot.id, league.code);
                    if (details) {
                        details.league = league;
                        addActiveMatch(action.snapshot.id, details);
                        const matchStartEventId = getMatchStartEventId(matchId);
                        if (!isEventPosted(matchStartEventId) && config.events.matchStart) {
                            const matchData = normalizeMatchData(details);
                            if (await postMatchStatus(matchId, formatMatchStart(matchData))) {
                                markEventPosted(matchStartEventId);
                            }
                        }
                    }
                } else if (action.type === 'match_end') {
                    botLogger.info({ matchId: action.snapshot.id }, 'Partida finalizada');
                    await finishMatch(action.snapshot.id, league);
                }
            }

            for (const match of matches) {
                const matchId = match.id != null ? String(match.id) : '';
                const snap = newSnapshotMap.get(matchId);
                if (snap?.status !== 'in') continue;

                const compositeKey = `${league.code}:${matchId}`;
                const needCatchUp = !isMatchActive(matchId) || isRecoveredActiveKey(compositeKey);
                // Catch-up: partida já ao vivo mas não estava no set ativo (ex.: bot reiniciou com jogo em andamento)
                if (needCatchUp) {
                    const details = await getMatchDetails(matchId, league.code);
                    if (details) {
                        details.league = league;
                        addActiveMatch(matchId, details);
                        botLogger.info({ matchId, league: league.name }, 'Partida já em andamento adicionada');
                        const matchStartEventId = getMatchStartEventId(matchId);
                        if (!isEventPosted(matchStartEventId) && config.events.matchStart) {
                            const matchData = normalizeMatchData(details);
                            if (await postMatchStatus(matchId, formatMatchStart(matchData))) {
                                markEventPosted(matchStartEventId);
                            }
                        }
                        const currentEvents = await getLiveEvents(matchId, league.code);
                        if (currentEvents.length > 0) {
                            markExistingEventsAsSeen(matchId, currentEvents);
                        }
                        // Skip what the planned live feed already published before the bot joined
                        const level = getPlannedLevel(matchId);
                        if (level === TIER.PLAYS) {
                            markExistingPlaysAsSeen(matchId, await getMatchPlays(matchId, league.code));
                        } else if (level >= TIER.COMMENTARY) {
                            markExistingCommentaryAsSeen(matchId, await getMatchCommentary(matchId, league.code));
                        }
                    }
                }
                await pollMatchEvents(matchId, league);
            }
        } catch (error) {
            botLogger.error({ league: league.name, error: error.message }, 'Erro no poll da liga');
        }
    }

    mergePreviousSnapshots(allSnapshotEntries);

    const hasLive = allSnapshotEntries.some(([, s]) => s.status === 'in');
    const hasPre = allSnapshotEntries.some(([, s]) => s.status === 'pre');
    const nextIntervalMs = computeNextIntervalMs(
        hasLive,
        hasPre,
        preMatchStartTimestamps,
        Date.now(),
        config.bot
    );

    const stats = getStateStats();
    let intervalReason = '';
    if (hasLive) {
        intervalReason = ' (ao vivo)';
    } else if (hasPre && preMatchStartTimestamps.length > 0) {
        const earliestStart = Math.min(...preMatchStartTimestamps);
        const wakeAt = earliestStart - config.bot.pollWindowBeforeMatchMs;
        const wakeInMs = wakeAt - Date.now();
        if (wakeInMs > 0 && nextIntervalMs === config.bot.pollScheduleRefreshMaxMs) {
            intervalReason = ' (refresh do schedule)';
        } else if (wakeInMs > 0) {
            intervalReason = ' (timeslot antes da partida)';
        }
    }
    botLogger.info({
        activeMatchCount: stats.activeMatchCount,
        postedEventCount: stats.postedEventCount,
        nextIntervalSec: nextIntervalMs / 1000,
        intervalReason: intervalReason || undefined,
    }, 'Stats do poll');

    return { nextIntervalMs };
}

/**
 * Compute next poll interval from current state (pure, for testing).
 * @param {boolean} hasLive
 * @param {boolean} hasPre
 * @param {number[]} preMatchStartTimestamps - Unix ms of scheduled start for 'pre' matches
 * @param {number} nowMs - Current time (Unix ms)
 * @param {{ pollIntervalLiveMs: number, pollIntervalAlertMs: number, pollIntervalHibernationMs: number, pollWindowBeforeMatchMs: number, pollScheduleRefreshMaxMs: number }} botConfig
 * @returns {number}
 */
export function computeNextIntervalMs(hasLive, hasPre, preMatchStartTimestamps, nowMs, botConfig) {
    if (hasLive) return botConfig.pollIntervalLiveMs;
    if (hasPre && preMatchStartTimestamps.length > 0) {
        const earliestStart = Math.min(...preMatchStartTimestamps);
        const wakeAt = earliestStart - botConfig.pollWindowBeforeMatchMs;
        const wakeInMs = wakeAt - nowMs;
        if (wakeInMs > 0) {
            return Math.min(
                wakeInMs,
                botConfig.pollIntervalHibernationMs,
                botConfig.pollScheduleRefreshMaxMs
            );
        }
        return botConfig.pollIntervalAlertMs;
    }
    if (hasPre) return botConfig.pollIntervalAlertMs;
    return botConfig.pollIntervalHibernationMs;
}

/**
 * Poll live events for a specific match
 * @param {string} matchId - Match ID (canonical string)
 * @param {Object} league - League object
 */
async function pollMatchEvents(matchId, league) {
    // The day's plan picks the live feed: full commentary (which already narrates every shot), else the
    // shots feed (also the fallback when commentary does not fit), else key events only.
    const level = getPlannedLevel(matchId);
    const feed = level >= TIER.COMMENTARY ? 'commentary' : level === TIER.PLAYS ? 'plays' : null;
    const [events, details, plays, commentary] = await Promise.all([
        getLiveEvents(matchId, league.code),
        getMatchDetails(matchId, league.code),
        feed === 'plays' ? getMatchPlays(matchId, league.code) : Promise.resolve(null),
        feed === 'commentary' ? getMatchCommentary(matchId, league.code) : Promise.resolve(null),
    ]);

    if (!details) {
        botLogger.warn({ matchId }, 'Não foi possível obter detalhes da partida');
        return;
    }

    details.league = league;
    const matchData = normalizeMatchData(details);

    if (commentary) {
        const counts = await processCommentaryWithEvents(commentary, events, matchData);
        if (counts.events + counts.commentary > 0) {
            botLogger.info({ matchId, events: counts.events, commentary: counts.commentary }, 'Eventos e comentários postados');
        }
    } else if (events.length > 0) {
        const postedCount = await processEvents(events, matchData);
        if (postedCount > 0) {
            botLogger.info({ matchId, postedCount }, 'Eventos postados');
        }
    }

    if (plays && plays.length > 0) {
        const enhancedCount = await processEnhancedPlays(plays, matchData);
        if (enhancedCount > 0) {
            botLogger.info({ matchId, plays: enhancedCount }, 'Plays aprimorados postados');
        }
    }
}

/**
 * Normalize match data from API response to standard format
 * @param {Object} apiMatch - Match data from API
 * @returns {Object} Normalized match data
 */
function normalizeMatchData(apiMatch) {
    return {
        id: apiMatch.id,
        homeTeam: {
            id: apiMatch.homeTeam?.id,
            name: apiMatch.homeTeam?.name || apiMatch.homeName || 'Casa',
            logo: apiMatch.homeTeam?.logo,
            form: apiMatch.homeTeam?.form,
            record: apiMatch.homeTeam?.record,
            standing: apiMatch.homeTeam?.standing,
        },
        awayTeam: {
            id: apiMatch.awayTeam?.id,
            name: apiMatch.awayTeam?.name || apiMatch.awayName || 'Visitante',
            logo: apiMatch.awayTeam?.logo,
            form: apiMatch.awayTeam?.form,
            record: apiMatch.awayTeam?.record,
            standing: apiMatch.awayTeam?.standing,
        },
        homeScore: apiMatch.homeScore ?? apiMatch.homeGoals ?? 0,
        awayScore: apiMatch.awayScore ?? apiMatch.awayGoals ?? 0,
        homeShootoutScore: apiMatch.homeShootoutScore,
        awayShootoutScore: apiMatch.awayShootoutScore,
        tie: apiMatch.tie,
        status: apiMatch.status || apiMatch.state,
        venue: apiMatch.venue?.name || apiMatch.stadium,
        minute: apiMatch.minute || apiMatch.clock,
        startTime: apiMatch.startTime || apiMatch.date,
        league: apiMatch.league,
        venueCity: apiMatch.venueCity,
        boxscore: apiMatch.boxscore,
    };
}

/**
 * Start the continuous monitoring loop with elastic polling (setTimeout rescheduled after each poll).
 */
export async function startMonitoring() {
    botLogger.info('Iniciando monitoramento (polling elástico)');

    function scheduleNext() {
        poll().then((result) => {
            const ms = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
            setTimeout(scheduleNext, ms);
        }).catch((err) => {
            botLogger.error({ error: err.message }, 'Erro no poll');
            setTimeout(scheduleNext, config.bot.pollIntervalAlertMs);
        });
    }

    let firstDelay = config.bot.pollIntervalLiveMs;
    try {
        const result = await poll();
        firstDelay = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
    } catch (err) {
        botLogger.error({ error: err.message }, 'Erro no poll');
        firstDelay = config.bot.pollIntervalLiveMs;
    }
    setTimeout(scheduleNext, firstDelay);
}
