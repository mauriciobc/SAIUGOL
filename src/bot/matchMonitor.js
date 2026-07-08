import { getTodayMatches, getMatchDetails, getLiveEvents } from '../api/espn.js';
import { getDateStringFor } from '../utils/dateUtils.js';
import { postStatus } from '../api/mastodon.js';
import {
    isMatchActive,
    addActiveMatch,
    clearMatchState,
    getStateStats,
    getPreviousSnapshot,
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
import { formatMatchStart, formatDailyDigest, formatMatchPreview } from './formatter.js';
import { config } from '../config.js';
import {
    recordMatchProcessed,
    recordBotError,
    logMetrics,
} from '../utils/metrics.js';

/** Last successfully fetched league match list, updated every poll. */
let _lastLeagueMatches = [];

/** Returns the most recent cross-league match list (for mention listener schedule replies). */
export function getLastLeagueMatches() { return _lastLeagueMatches; }

/**
 * Initialize the match monitor
 */
export async function initialize() {
    console.log('[MatchMonitor] Inicializando...');
    const activeLeagues = config.activeLeagues || [];
    console.log(`[MatchMonitor] Ligas ativas: ${activeLeagues.map(l => l.name).join(', ')}`);
    return true;
}

/**
 * Main polling loop - build snapshots, compute diff, act only on changes, then poll events for live matches.
 * @returns {{ nextIntervalMs: number }}
 */
export async function poll() {
    if (!config.activeLeagues || config.activeLeagues.length === 0) {
        console.warn('[MatchMonitor] Nenhuma liga configurada, pulando poll');
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
            recordBotError();
            console.error(`[MatchMonitor] Erro ao buscar partidas para ${league.name}:`, error.message);
            allLeagueMatches.push({ league, matches: [] });
        }
    }
    _lastLeagueMatches = allLeagueMatches;

    // Daily digest — fire once per calendar day across all leagues
    if (config.events.dailyDigest) {
        const today = getDateStringFor(new Date(), config.timezone);
        if (getLastDigestDate() !== today) {
            const hasMatches = allLeagueMatches.some(({ matches }) => matches.length > 0);
            if (hasMatches) {
                try {
                    const digestText = formatDailyDigest(allLeagueMatches);
                    await postStatus(digestText);
                    setLastDigestDate(today);
                    console.log('[MatchMonitor] Digest diário postado');
                } catch (err) {
                    recordBotError();
                    console.error('[MatchMonitor] Erro ao postar digest diário:', err.message);
                }
            } else {
                // No matches today — still mark as seen so we don't retry every poll
                setLastDigestDate(today);
            }
        }
    }

    for (const { league, matches } of allLeagueMatches) {
        try {
            console.log(`[MatchMonitor] ${matches.length} partidas encontradas para ${league.name}`);

            const newSnapshotMap = matchesToSnapshotMap(matches);
            for (const match of matches) {
                const matchId = match.id != null ? String(match.id) : '';
                const snap = newSnapshotMap.get(matchId);
                if (snap?.status === 'pre' && match.startTime) {
                    const t = new Date(match.startTime).getTime();
                    if (!Number.isNaN(t)) preMatchStartTimestamps.push(t);

                    // Pre-match preview — fire once when the match enters the poll window
                    if (config.events.matchPreview) {
                        const previewId = `${matchId}-preview`;
                        const inWindow = t - Date.now() <= config.bot.pollWindowBeforeMatchMs;
                        if (inWindow && !isEventPosted(previewId)) {
                            try {
                                const matchData = normalizeMatchData({ ...match, league });
                                const previewText = formatMatchPreview(matchData);
                                await postStatus(previewText);
                                markEventPosted(previewId);
                                console.log(`[MatchMonitor] Preview pré-jogo postado para partida ${matchId}`);
                            } catch (err) {
                                recordBotError();
                                console.error(`[MatchMonitor] Erro ao postar preview da partida ${matchId}:`, err.message);
                            }
                        }
                    }
                }
            }
            const { actions, snapshotEntries } = computeDiff(
                league.code,
                newSnapshotMap,
                (key) => getPreviousSnapshot(key)
            );
            allSnapshotEntries.push(...snapshotEntries);

            for (const action of actions) {
                if (action.type === 'match_start') {
                    const matchId = String(action.snapshot.id);
                    console.log(`[MatchMonitor] Partida iniciada: ${matchId} (${league.name})`);
                    const details = await getMatchDetails(action.snapshot.id, league.code);
                    if (details) {
                        details.league = league;
                        addActiveMatch(action.snapshot.id, details);
                        const matchStartEventId = getMatchStartEventId(matchId);
                        if (!isEventPosted(matchStartEventId) && config.events.matchStart) {
                            const matchData = normalizeMatchData(details);
                            await postStatus(formatMatchStart(matchData));
                            markEventPosted(matchStartEventId);
                        }
                    }
                } else if (action.type === 'match_end') {
                    console.log(`[MatchMonitor] Partida finalizada: ${action.snapshot.id}`);
                    try {
                        const details = await getMatchDetails(action.snapshot.id, league.code);
                        if (details) {
                            details.league = league;
                            await handleMatchEnd(normalizeMatchData(details));
                        }
                    } finally {
                        clearMatchState(action.snapshot.id);
                    }
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
                        console.log(`[MatchMonitor] Partida já em andamento adicionada: ${matchId} (${league.name})`);
                        const matchStartEventId = getMatchStartEventId(matchId);
                        if (!isEventPosted(matchStartEventId) && config.events.matchStart) {
                            const matchData = normalizeMatchData(details);
                            await postStatus(formatMatchStart(matchData));
                            markEventPosted(matchStartEventId);
                        }
                        const currentEvents = await getLiveEvents(matchId, league.code);
                        if (currentEvents.length > 0) {
                            markExistingEventsAsSeen(matchId, currentEvents);
                        }
                    }
                }
                await pollMatchEvents(matchId, league);
            }
        } catch (error) {
            recordBotError();
            console.error(`[MatchMonitor] Erro no poll da liga ${league.name}:`, error.message);
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
    console.log(`[MatchMonitor] Stats: ${stats.activeMatchCount} partidas ativas, ${stats.postedEventCount} eventos postados (próximo poll em ${nextIntervalMs / 1000}s${intervalReason})`);
    logMetrics();

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
    const events = await getLiveEvents(matchId, league.code);
    const details = await getMatchDetails(matchId, league.code);

    if (!details) {
        console.warn(`[MatchMonitor] Não foi possível obter detalhes da partida ${matchId}`);
        return;
    }

    details.league = league;
    const matchData = normalizeMatchData(details);
    recordMatchProcessed();

    if (events.length > 0) {
        const postedCount = await processEvents(events, matchData);
        if (postedCount > 0) {
            console.log(`[MatchMonitor] ${postedCount} eventos postados para partida ${matchId}`);
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
        status: apiMatch.status || apiMatch.state,
        venue: apiMatch.venue?.name || apiMatch.stadium,
        minute: apiMatch.minute || apiMatch.clock,
        startTime: apiMatch.startTime || apiMatch.date,
        league: apiMatch.league,
        venueCity: apiMatch.venueCity,
        boxscore: apiMatch.boxscore,
    };
}

/** @type {ReturnType<typeof setTimeout>|null} */
let pollTimer = null;
let monitoringStopped = false;

/**
 * Stop the elastic polling loop (clears the pending setTimeout).
 * Safe to call when monitoring was never started.
 */
export function stopMonitoring() {
    monitoringStopped = true;
    if (pollTimer != null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

/**
 * Start the continuous monitoring loop with elastic polling (setTimeout rescheduled after each poll).
 */
export async function startMonitoring() {
    monitoringStopped = false;
    console.log('[MatchMonitor] Iniciando monitoramento (polling elástico)');

    function scheduleNext() {
        if (monitoringStopped) return;
        poll().then((result) => {
            if (monitoringStopped) return;
            const ms = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
            pollTimer = setTimeout(scheduleNext, ms);
        }).catch((err) => {
            if (monitoringStopped) return;
            console.error('[MatchMonitor] Erro no poll:', err.message);
            pollTimer = setTimeout(scheduleNext, config.bot.pollIntervalAlertMs);
        });
    }

    let firstDelay = config.bot.pollIntervalLiveMs;
    try {
        const result = await poll();
        firstDelay = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
    } catch (err) {
        console.error('[MatchMonitor] Erro no poll:', err.message);
        firstDelay = config.bot.pollIntervalLiveMs;
    }
    if (monitoringStopped) return;
    pollTimer = setTimeout(scheduleNext, firstDelay);
}
