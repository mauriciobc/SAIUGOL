import { config } from '../config.js';
import { postStatus } from '../api/mastodon.js';
import { getHighlights } from '../api/espn.js';
import {
    isEventPosted,
    markEventPosted,
    getLastScore,
    updateLastScore,
} from '../state/matchState.js';
import {
    formatGoal,
    formatCard,
    formatSubstitution,
    formatVAR,
    formatMatchStart,
    formatSecondHalfStart,
    formatHalfTime,
    formatMatchEnd,
    formatHighlights,
} from './formatter.js';

/**
 * Event type constants
 */
const EVENT_TYPES = {
    GOAL: ['goal', 'gol', 'penalty', 'own goal', 'goal - header', 'gol de cabeça', 'penalty - scored', 'pênalti convertido'],
    YELLOW_CARD: ['yellow card', 'yellowcard', 'cartão amarelo'],
    RED_CARD: ['red card', 'redcard', 'second yellow', 'cartão vermelho'],
    SUBSTITUTION: ['substitution', 'sub', 'substituição'],
    VAR: ['var', 'video assistant referee'],
    SECOND_HALF_START: ['start 2nd half', 'second half', '2nd half', 'começo do 2º tempo'],
    MATCH_START: ['kickoff', 'kick off', 'match start', 'começo'],
    MATCH_END: ['full time', 'fulltime', 'match end', 'fim de jogo'],
    HALF_TIME: ['half time', 'halftime', 'meio tempo'],
};

/** Type substrings that mean the goal was disallowed/overturned — do not post as goal. */
const DISALLOWED_GOAL_KEYWORDS = [
    'disallowed', 'no goal', 'ruled out', 'overturned', 'not given', 'chalked off',
    'annulado', 'não vale', 'cancelado', 'impedimento',
];

/**
 * Determine the event category from event type string
 * @param {string} type - Event type string
 * @returns {string|null} Category name or null
 */
function categorizeEvent(type) {
    if (!type) return null;
    const lowerType = type.toLowerCase();

    for (const [category, keywords] of Object.entries(EVENT_TYPES)) {
        if (keywords.some((kw) => lowerType.includes(kw))) {
            if (category === 'GOAL' && DISALLOWED_GOAL_KEYWORDS.some((kw) => lowerType.includes(kw))) {
                return null;
            }
            return category;
        }
    }
    return null;
}

/**
 * Generate a unique event ID
 * @param {number} matchId - Match ID
 * @param {Object} event - Event object
 * @returns {string} Unique event ID
 */
function generateEventId(matchId, event) {
    if (event.id != null && event.id !== '') {
        return `${matchId}-${event.id}`;
    }
    const playerId = event.player?.id ?? (typeof event.player === 'string' ? event.player : event.team?.id) ?? 'unknown';
    return `${matchId}-${event.type}-${event.minute}-${playerId}`;
}

/**
 * Mark current events as already seen (for matches joined in progress).
 * @param {string} matchId - Match ID
 * @param {Array<Object>} events - Current events from API
 */
export function markExistingEventsAsSeen(matchId, events) {
    for (const event of events) {
        const eventId = generateEventId(matchId, event);
        markEventPosted(eventId);
    }
}

/**
 * Check if event type should be posted based on config
 * @param {string} category - Event category
 * @returns {boolean}
 */
function shouldPostEvent(category) {
    switch (category) {
        case 'GOAL':
            return config.events.goals;
        case 'YELLOW_CARD':
            return config.events.yellowCards;
        case 'RED_CARD':
            return config.events.redCards;
        case 'SUBSTITUTION':
            return config.events.substitutions;
        case 'VAR':
            return config.events.varReviews;
        case 'SECOND_HALF_START':
        case 'MATCH_START':
            return config.events.matchStart;
        case 'HALF_TIME':
            return config.events.interval;
        case 'MATCH_END':
            return config.events.matchEnd;
        default:
            return false;
    }
}

const PRIORITY_HIGH = 0;  // GOAL, RED_CARD - process first
const PRIORITY_NORMAL = 1;

function eventPriority(category) {
    if (category === 'GOAL' || category === 'RED_CARD') return PRIORITY_HIGH;
    return PRIORITY_NORMAL;
}

function isFavoriteTeam(event, match) {
    const ids = config.bot.favoriteTeamIds || [];
    const names = config.bot.favoriteTeamNames || [];
    if (!ids.length && !names.length) return false;
    const teamId = event.teamId || event.team?.id;
    const teamName = teamId === match.homeTeam?.id ? match.homeTeam?.name : (teamId === match.awayTeam?.id ? match.awayTeam?.name : event.team?.name || '');
    if (teamId && ids.includes(String(teamId))) return true;
    if (teamName && names.some(n => teamName.toLowerCase().includes(n.toLowerCase()))) return true;
    return false;
}

/**
 * Process a list of events for a match (goals and red cards first)
 * @param {Array} events - List of events from API
 * @param {Object} match - Match data
 * @returns {Promise<number>} Number of events posted
 */
export async function processEvents(events, match) {
    let postedCount = 0;

    const withIds = events.map((event) => ({
        event,
        eventId: generateEventId(match.id, event),
        category: categorizeEvent(event.type),
    }));

    for (let i = 0; i < withIds.length; i++) {
        const { event, eventId, category } = withIds[i];
        const posted = isEventPosted(eventId);
        console.log(
            `[EventProcessor] Partida ${match.id} evento ${i + 1}/${events.length}:`,
            JSON.stringify({
                eventId,
                category: category ?? '(sem categoria)',
                alreadyPosted: posted,
                content: event,
            }, null, 2)
        );
    }

    // MATCH_START pode ser postado por dois caminhos: action match_start (ID {matchId}-match-start)
    // ou evento kickoff da API (ID {matchId}-{event.id}). Evitar duplicata tratando o ID sintético.
    const postable = withIds.filter(({ eventId, category }) => {
        if (isEventPosted(eventId)) return false;
        if (category === 'MATCH_START' && isEventPosted(`${match.id}-match-start`)) return false;
        return category && shouldPostEvent(category);
    });

    if (postable.length === 0 && events.length > 0) {
        const alreadyPosted = withIds.filter(({ eventId }) => isEventPosted(eventId)).length;
        const noCategory = withIds.filter(({ category }) => !category).length;
        const disabledItems = withIds.filter(
            ({ category }) => category && !shouldPostEvent(category)
        );
        const categoryDisabledCount = disabledItems.length;
        const disabledCategories = [...new Set(disabledItems.map(({ category }) => category))].join(', ');
        console.log(
            `[EventProcessor] Partida ${match.id}: ${events.length} eventos recebidos, 0 novos para postar ` +
            `(já postados: ${alreadyPosted}, sem categoria: ${noCategory}, categoria desativada: ${categoryDisabledCount}${disabledCategories ? ` [${disabledCategories}]` : ''})`
        );
        return 0;
    }

    postable.sort((a, b) => eventPriority(a.category) - eventPriority(b.category));

    for (const { event, eventId, category } of postable) {
        const isFavorite = isFavoriteTeam(event, match);
        const text = formatEventPost(category, event, match, { isFavoriteTeam: isFavorite });
        if (text) {
            const result = await postStatus(text);
            if (result) {
                markEventPosted(eventId);
                postedCount++;
                console.log(`[EventProcessor] Postado evento ${category} para partida ${match.id}`);
            }
            await new Promise((resolve) => setTimeout(resolve, config.delays.betweenPosts));
        }
    }

    return postedCount;
}

/**
 * Format event post based on category
 * @param {string} category - Event category
 * @param {Object} event - Event data
 * @param {Object} match - Match data
 * @param {{ isFavoriteTeam?: boolean }} [options]
 * @returns {string|null} Formatted post text or null
 */
function formatEventPost(category, event, match, options = {}) {
    switch (category) {
        case 'GOAL':
            return formatGoal(event, match, options);
        case 'YELLOW_CARD':
        case 'RED_CARD':
            return formatCard(event, match, options);
        case 'SUBSTITUTION':
            return formatSubstitution(event, match);
        case 'VAR':
            return formatVAR(event, match);
        case 'MATCH_START':
            return formatMatchStart(match);
        case 'SECOND_HALF_START':
            return formatSecondHalfStart(match, event);
        case 'HALF_TIME':
            return formatHalfTime(match, event);
        case 'MATCH_END':
            return formatMatchEnd(match);
        default:
            return null;
    }
}

/**
 * Check for score changes and post if there's a new goal
 * @param {Object} match - Match data with current score
 * @returns {Promise<boolean>} True if score change was posted
 */
export async function checkScoreChange(match) {
    const lastScore = getLastScore(match.id);
    const currentHome = match.homeScore || 0;
    const currentAway = match.awayScore || 0;

    if (!lastScore) {
        updateLastScore(match.id, currentHome, currentAway);
        return false;
    }

    const scoreDiff =
        currentHome + currentAway - (lastScore.home + lastScore.away);

    if (scoreDiff > 0) {
        // Score increased - there was a goal
        // The actual goal event will be posted by processEvents
        updateLastScore(match.id, currentHome, currentAway);
        return true;
    }

    return false;
}

/**
 * Handle match end - post final score and highlights
 * @param {Object} match - Match data
 */
export async function handleMatchEnd(match) {
    const matchEndId = `${match.id}-match-end`;

    if (isEventPosted(matchEndId)) {
        return;
    }

    // Post final score
    const endText = formatMatchEnd(match);
    await postStatus(endText);
    markEventPosted(matchEndId);

    console.log(`[EventProcessor] Partida ${match.id} finalizada`);

    // Wait a bit and then check for highlights
    await new Promise((resolve) => setTimeout(resolve, config.delays.beforeHighlights));

    const highlights = await getHighlights(match.id, match.league?.code);
    if (highlights.length > 0) {
        const highlightsId = `${match.id}-highlights`;
        if (!isEventPosted(highlightsId)) {
            const highlightsText = formatHighlights(match, highlights);
            await postStatus(highlightsText);
            markEventPosted(highlightsId);
            console.log(`[EventProcessor] Highlights postados para partida ${match.id}`);
        }
    }
}
