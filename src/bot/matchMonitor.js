import { getTodayMatches, getMatchDetails, getLiveEvents } from '../api/espn.js';
import { getAllMatchStatuses as getHeaderStatuses, checkForChanges } from '../api/fastcast.js';
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
} from '../state/matchState.js';
import { matchesToSnapshotMap } from '../state/snapshotContract.js';
import { computeDiff } from '../state/diffEngine.js';
import { processEvents, handleMatchEnd, markExistingEventsAsSeen, getMatchStartEventId } from './eventProcessor.js';
import { formatMatchStart } from './formatter.js';
import { config } from '../config.js';

/** Map to store previous header states: key = "leagueCode:matchId", value = header status object */
const previousHeaderStates = new Map();

/** Counter for API calls saved by header-first strategy */
let headerChecks = 0;
let summaryCallsSaved = 0;

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
 * Uses Header API as pre-check to reduce Summary API calls.
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

    for (const league of config.activeLeagues) {
        try {
            const matches = await getTodayMatches(league.code);
            console.log(`[MatchMonitor] ${matches.length} partidas encontradas para ${league.name}`);

            const newSnapshotMap = matchesToSnapshotMap(matches);
            for (const match of matches) {
                const matchId = match.id != null ? String(match.id) : '';
                const snap = newSnapshotMap.get(matchId);
                if (snap?.status === 'pre' && match.startTime) {
                    const t = new Date(match.startTime).getTime();
                    if (!Number.isNaN(t)) preMatchStartTimestamps.push(t);
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

            const useHeaderFirst = config.bot.useHeaderFirstStrategy !== false;
            let headerMap = new Map();

            if (useHeaderFirst) {
                headerChecks++;
                const headerMatches = await getHeaderStatuses(league.code);
                headerMap = new Map(headerMatches.map(m => [m.id, m]));
            }

            for (const match of matches) {
                const matchId = match.id != null ? String(match.id) : '';
                const snap = newSnapshotMap.get(matchId);
                if (snap?.status !== 'in') continue;

                const compositeKey = `${league.code}:${matchId}`;
                const needCatchUp = !isMatchActive(matchId) || isRecoveredActiveKey(compositeKey);

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
                    if (useHeaderFirst) {
                        const headerMatch = headerMap.get(matchId);
                        if (headerMatch) {
                            previousHeaderStates.set(compositeKey, { ...headerMatch });
                        }
                    }
                    continue;
                }

                if (!useHeaderFirst) {
                    await pollMatchEvents(matchId, league);
                    continue;
                }

                const headerMatch = headerMap.get(matchId);
                const previousHeader = previousHeaderStates.get(compositeKey);

                const headerChange = !previousHeader || (
                    previousHeader.status !== (headerMatch?.status || snap.status) ||
                    previousHeader.homeScore !== headerMatch?.homeScore ||
                    previousHeader.awayScore !== headerMatch?.awayScore ||
                    previousHeader.clock !== headerMatch?.clock ||
                    previousHeader.lastPlay !== headerMatch?.lastPlay
                );

                if (!previousHeader || headerChange) {
                    if (previousHeader && headerMatch) {
                        console.log(`[MatchMonitor] Header change for ${matchId}: ${previousHeader.status}->${headerMatch.status}, ${previousHeader.clock}->${headerMatch.clock}, lastPlay: ${previousHeader.lastPlay?.slice(0, 30)} -> ${headerMatch.lastPlay?.slice(0, 30)}`);
                    }
                    await pollMatchEvents(matchId, league);
                } else {
                    summaryCallsSaved++;
                }

                if (headerMatch) {
                    previousHeaderStates.set(compositeKey, { ...headerMatch });
                }
            }
        } catch (error) {
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
    console.log(`[MatchMonitor] Stats: ${stats.activeMatchCount} partidas ativas, ${stats.postedEventCount} eventos postados, Header checks: ${headerChecks}, Summary saved: ${summaryCallsSaved} (próximo poll em ${nextIntervalMs / 1000}s${intervalReason})`);

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
        },
        awayTeam: {
            id: apiMatch.awayTeam?.id,
            name: apiMatch.awayTeam?.name || apiMatch.awayName || 'Visitante',
        },
        homeScore: apiMatch.homeScore ?? apiMatch.homeGoals ?? 0,
        awayScore: apiMatch.awayScore ?? apiMatch.awayGoals ?? 0,
        status: apiMatch.status || apiMatch.state,
        venue: apiMatch.venue?.name || apiMatch.stadium,
        minute: apiMatch.minute || apiMatch.clock,
        startTime: apiMatch.startTime || apiMatch.date,
        league: apiMatch.league,
    };
}

/**
 * Start the continuous monitoring loop with elastic polling (setTimeout rescheduled after each poll).
 */
export async function startMonitoring() {
    console.log('[MatchMonitor] Iniciando monitoramento (polling elástico)');

    function scheduleNext() {
        poll().then((result) => {
            const ms = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
            setTimeout(scheduleNext, ms);
        }).catch((err) => {
            console.error('[MatchMonitor] Erro no poll:', err.message);
            setTimeout(scheduleNext, config.bot.pollIntervalAlertMs);
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
    setTimeout(scheduleNext, firstDelay);
}
