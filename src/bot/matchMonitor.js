import {
    getBrasileiraoLeagueId,
    getTodayMatches,
    getMatchDetails,
    getLiveEvents,
} from '../api/espn.js';
import { postStatus } from '../api/mastodon.js';
import {
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
 */
export async function initialize() {
    console.log('[MatchMonitor] Inicializando...');
    const activeLeagues = config.activeLeagues || [];
    console.log(`[MatchMonitor] Ligas ativas: ${activeLeagues.map(l => l.name).join(', ')}`);
    return true;
}

/**
 * Main polling loop - check for matches and events
 */
export async function poll() {
    if (!config.activeLeagues || config.activeLeagues.length === 0) {
        console.warn('[MatchMonitor] Nenhuma liga configurada, pulando poll');
        return;
    }

    for (const league of config.activeLeagues) {
        try {
            // Get today's matches for this league
            const matches = await getTodayMatches(league.code);
            console.log(`[MatchMonitor] ${matches.length} partidas encontradas para ${league.name}`);

            for (const match of matches) {
                // Inject league info into match object
                match.league = league;
                await processMatch(match);
            }
        } catch (error) {
            console.error(`[MatchMonitor] Erro no poll da liga ${league.name}:`, error.message);
        }
    }

    // Log stats
    const stats = getStateStats();
    console.log(`[MatchMonitor] Stats: ${stats.activeMatchCount} partidas ativas, ${stats.postedEventCount} eventos postados`);
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
        console.log(`[MatchMonitor] Nova partida ao vivo: ${matchId} (${match.league.name})`);

        // Get full match details
        const details = await getMatchDetails(matchId, match.league.code);
        if (details) {
            // Preserve league info
            details.league = match.league;
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
        await pollMatchEvents(matchId, match.league);
    }

    // Check if match finished
    if (isMatchFinished(status) && isMatchActive(matchId)) {
        console.log(`[MatchMonitor] Partida finalizada: ${matchId}`);

        const details = await getMatchDetails(matchId, match.league.code);
        if (details) {
            details.league = match.league;
            const matchData = normalizeMatchData(details);
            await handleMatchEnd(matchData);
        }

        clearMatchState(matchId);
    }
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
