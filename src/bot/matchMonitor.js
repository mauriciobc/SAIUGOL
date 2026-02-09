import { getTodayMatches, getMatchDetails, getLiveEvents } from '../api/espn.js';
import { postStatus } from '../api/mastodon.js';
import {
    isMatchActive,
    addActiveMatch,
    clearMatchState,
    getStateStats,
    getPreviousSnapshot,
    mergePreviousSnapshots,
} from '../state/matchState.js';
import { matchesToSnapshotMap } from '../state/snapshotContract.js';
import { computeDiff } from '../state/diffEngine.js';
import { processEvents, handleMatchEnd } from './eventProcessor.js';
import { formatMatchStart } from './formatter.js';
import { config } from '../config.js';

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

    for (const league of config.activeLeagues) {
        try {
            const matches = await getTodayMatches(league.code);
            console.log(`[MatchMonitor] ${matches.length} partidas encontradas para ${league.name}`);

            const newSnapshotMap = matchesToSnapshotMap(matches);
            const { actions, snapshotEntries } = computeDiff(
                league.code,
                newSnapshotMap,
                (key) => getPreviousSnapshot(key)
            );
            allSnapshotEntries.push(...snapshotEntries);

            for (const action of actions) {
                if (action.type === 'match_start') {
                    console.log(`[MatchMonitor] Partida iniciada: ${action.snapshot.id} (${league.name})`);
                    const details = await getMatchDetails(action.snapshot.id, league.code);
                    if (details) {
                        details.league = league;
                        addActiveMatch(action.snapshot.id, details);
                        if (config.events.matchStart) {
                            const matchData = normalizeMatchData(details);
                            await postStatus(formatMatchStart(matchData));
                        }
                    }
                } else if (action.type === 'match_end') {
                    console.log(`[MatchMonitor] Partida finalizada: ${action.snapshot.id}`);
                    const details = await getMatchDetails(action.snapshot.id, league.code);
                    if (details) {
                        details.league = league;
                        await handleMatchEnd(normalizeMatchData(details));
                    }
                    clearMatchState(action.snapshot.id);
                }
            }

            for (const match of matches) {
                const snap = newSnapshotMap.get(String(match.id));
                if (snap?.status === 'in' && isMatchActive(match.id)) {
                    await pollMatchEvents(match.id, league);
                }
            }
        } catch (error) {
            console.error(`[MatchMonitor] Erro no poll da liga ${league.name}:`, error.message);
        }
    }

    mergePreviousSnapshots(allSnapshotEntries);

    const hasLive = allSnapshotEntries.some(([, s]) => s.status === 'in');
    const hasPre = allSnapshotEntries.some(([, s]) => s.status === 'pre');
    const nextIntervalMs = hasLive
        ? config.bot.pollIntervalLiveMs
        : hasPre
            ? config.bot.pollIntervalAlertMs
            : config.bot.pollIntervalHibernationMs;

    const stats = getStateStats();
    console.log(`[MatchMonitor] Stats: ${stats.activeMatchCount} partidas ativas, ${stats.postedEventCount} eventos postados (próximo poll em ${nextIntervalMs / 1000}s)`);

    return { nextIntervalMs };
}

/**
 * Poll live events for a specific match
 * @param {number} matchId - Match ID
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

    const result = await poll();
    const firstDelay = result?.nextIntervalMs ?? config.bot.pollIntervalLiveMs;
    setTimeout(scheduleNext, firstDelay);
}
