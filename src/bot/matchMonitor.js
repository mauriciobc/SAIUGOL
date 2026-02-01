import {
    getBrasileiraoLeagueId,
    getTodayMatches,
    getMatchDetails,
    getLiveEvents,
} from '../api/espn.js';
import { postStatus } from '../api/mastodon.js';
import {
    getLeagueId,
    isMatchActive,
    addActiveMatch,
    removeActiveMatch,
    getActiveMatches,
    clearMatchState,
    getStateStats,
} from '../state/matchState.js';
import { processEvents, handleMatchEnd } from './eventProcessor.js';
import { formatMatchStart } from './formatter.js';
import { config } from '../config.js';

/**
 * Match status constants
 */
const MATCH_STATUS = {
    SCHEDULED: ['scheduled', 'not started', 'tbd'],
    LIVE: ['live', 'in play', '1h', '2h', 'ht', 'et', 'bt', 'pt'],
    FINISHED: ['finished', 'ft', 'aet', 'pen'],
    POSTPONED: ['postponed', 'cancelled', 'suspended'],
};

/**
 * Check if match is live
 * @param {string} status - Match status string
 * @returns {boolean}
 */
function isMatchLive(status) {
    if (!status) return false;
    const lowerStatus = status.toLowerCase();
    return MATCH_STATUS.LIVE.some((s) => lowerStatus.includes(s));
}

/**
 * Check if match is finished
 * @param {string} status - Match status string
 * @returns {boolean}
 */
function isMatchFinished(status) {
    if (!status) return false;
    const lowerStatus = status.toLowerCase();
    return MATCH_STATUS.FINISHED.some((s) => lowerStatus.includes(s));
}

/**
 * Initialize the match monitor
 * Fetches and caches the Brasileirão league ID
 */
export async function initialize() {
    console.log('[MatchMonitor] Inicializando...');

    // Get and cache league ID
    let leagueId = getLeagueId();
    if (!leagueId) {
        leagueId = await getBrasileiraoLeagueId();
        if (leagueId) {
            getLeagueId(leagueId);
            console.log(`[MatchMonitor] Liga Brasileirão encontrada: ${leagueId}`);
        } else {
            console.error('[MatchMonitor] Não foi possível encontrar a liga Brasileirão');
        }
    }

    return leagueId !== null;
}

/**
 * Main polling loop - check for matches and events
 */
export async function poll() {
    const leagueId = getLeagueId();
    if (!leagueId) {
        console.warn('[MatchMonitor] Liga não configurada, pulando poll');
        return;
    }

    try {
        // Get today's matches
        const matches = await getTodayMatches(leagueId);
        console.log(`[MatchMonitor] ${matches.length} partidas encontradas para hoje`);

        for (const match of matches) {
            await processMatch(match);
        }

        // Log stats
        const stats = getStateStats();
        console.log(`[MatchMonitor] Stats: ${stats.activeMatchCount} partidas ativas, ${stats.postedEventCount} eventos postados`);
    } catch (error) {
        console.error('[MatchMonitor] Erro no poll:', error.message);
    }
}

/**
 * Process a single match
 * @param {Object} match - Match data from API
 */
async function processMatch(match) {
    const matchId = match.id;
    const status = match.status || match.state;

    // Check if match just started
    if (isMatchLive(status) && !isMatchActive(matchId)) {
        console.log(`[MatchMonitor] Nova partida ao vivo: ${matchId}`);

        // Get full match details
        const details = await getMatchDetails(matchId);
        if (details) {
            addActiveMatch(matchId, details);

            // Post match start
            if (config.events.matchStart) {
                const matchData = normalizeMatchData(details);
                const startText = formatMatchStart(matchData);
                await postStatus(startText);
            }
        }
    }

    // Process live match
    if (isMatchActive(matchId)) {
        await pollMatchEvents(matchId);
    }

    // Check if match finished
    if (isMatchFinished(status) && isMatchActive(matchId)) {
        console.log(`[MatchMonitor] Partida finalizada: ${matchId}`);

        const details = await getMatchDetails(matchId);
        if (details) {
            const matchData = normalizeMatchData(details);
            await handleMatchEnd(matchData);
        }

        clearMatchState(matchId);
    }
}

/**
 * Poll live events for a specific match
 * @param {number} matchId - Match ID
 */
async function pollMatchEvents(matchId) {
    const events = await getLiveEvents(matchId);
    const details = await getMatchDetails(matchId);

    if (!details) {
        console.warn(`[MatchMonitor] Não foi possível obter detalhes da partida ${matchId}`);
        return;
    }

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
    };
}

/**
 * Start the continuous monitoring loop
 * @param {number} intervalMs - Polling interval in milliseconds
 */
export async function startMonitoring(intervalMs = config.bot.pollIntervalMs) {
    console.log(`[MatchMonitor] Iniciando monitoramento (intervalo: ${intervalMs}ms)`);

    // Initial poll
    await poll();

    // Set up interval
    setInterval(async () => {
        await poll();
    }, intervalMs);
}
