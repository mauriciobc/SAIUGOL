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
    formatMatchEnd,
    formatHighlights,
} from './formatter.js';

/**
 * Event type constants
 */
const EVENT_TYPES = {
    GOAL: ['goal', 'penalty', 'own goal'],
    YELLOW_CARD: ['yellow card', 'yellowcard'],
    RED_CARD: ['red card', 'redcard', 'second yellow'],
    SUBSTITUTION: ['substitution', 'sub'],
    VAR: ['var', 'video assistant referee'],
    MATCH_START: ['kickoff', 'kick off', 'match start'],
    MATCH_END: ['full time', 'fulltime', 'match end'],
    HALF_TIME: ['half time', 'halftime'],
};

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
    // Include ESPN event ID if available for better uniqueness
    const espnId = event.id || '';
    const playerId = event.player?.id || event.team?.id || 'unknown';
    const timestamp = event.timestamp || Date.now();

    return `${matchId}-${espnId}-${event.type}-${event.minute}-${playerId}-${timestamp}`;
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
        case 'MATCH_START':
            return config.events.matchStart;
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

    const postable = events
        .map((event) => ({ event, eventId: generateEventId(match.id, event), category: categorizeEvent(event.type) }))
        .filter(({ eventId, category }) => !isEventPosted(eventId) && category && shouldPostEvent(category));

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
