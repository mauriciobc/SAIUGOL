import { config } from '../config.js';
import { postStatus, uploadMediaFromUrl } from '../api/mastodon.js';
import { getHighlights } from '../api/espn.js';
import { PENALTY_SCORED_KEYWORDS, PENALTY_MISSED_KEYWORDS } from '../utils/eventKeywords.js';
import {
    isEventPosted,
    markEventPosted,
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
    formatMatchStats,
    formatExtraTimeStart,
    formatExtraTimeHalf,
    formatExtraTimeSecondHalf,
    formatExtraTimeEnd,
    formatShootoutStart,
} from './formatter.js';

/**
 * ESPN keyEvents[].type.id → category. Numeric ids are stable across languages, unlike
 * type.text substrings (e.g. "Halftime Extra Time" contains "halftime", "Start 2nd Half Extra
 * Time" contains "2nd half" — matching those by text alone misclassifies extra-time events as
 * their regular-time equivalents). Checked before the text-keyword fallback in categorizeEvent.
 * Ids verified against live ESPN summary responses (EN and PT).
 */
const ID_TO_CATEGORY = {
    '70': 'GOAL',                    // Gol / Goal
    '97': 'GOAL',                    // Own Goal / Gol Contra
    '98': 'GOAL',                    // Penalty - Scored / Gol de pênalti
    '137': 'GOAL',                   // Goal - Header / Gol de cabeça
    '173': 'GOAL',                   // Goal - Volley
    '94': 'YELLOW_CARD',             // Yellow Card / Cartão amarelo
    '76': 'SUBSTITUTION',            // Substitution / substituição
    '80': 'MATCH_START',             // Kickoff / Começo
    '82': 'SECOND_HALF_START',       // Start 2nd Half / Começo do 2º tempo
    '81': 'HALF_TIME',               // Halftime / Intervalo
    '84': 'EXTRA_TIME_START',        // Start Extra Time / Começo da prorrogação
    '85': 'EXTRA_TIME_HALF',         // Halftime Extra Time / Intervalo da prorrogação
    '86': 'EXTRA_TIME_SECOND_HALF',  // Start 2nd Half Extra Time / Começo do 2º tempo da prorrogação
    '87': 'EXTRA_TIME_END',          // End Extra Time / Fim da prorrogação
    '88': 'SHOOTOUT_START',          // Start Shootout / Começo da disputa de pênaltis
};

/**
 * Event type constants — fallback for event ids not covered by ID_TO_CATEGORY
 * (e.g. leagues that report a different id scheme, or types not yet observed).
 */
const EVENT_TYPES = {
    GOAL: ['goal', 'gol', 'own goal', 'goal - header', 'gol de cabeça', ...PENALTY_SCORED_KEYWORDS],
    YELLOW_CARD: ['yellow card', 'yellowcard', 'cartão amarelo'],
    RED_CARD: ['red card', 'redcard', 'second yellow', 'cartão vermelho'],
    SUBSTITUTION: ['substitution', 'sub', 'substituição'],
    VAR: ['var', 'video assistant referee'],
    EXTRA_TIME_START: ['start extra time', 'começo da prorrogação'],
    EXTRA_TIME_HALF: ['halftime extra time', 'intervalo da prorrogação'],
    EXTRA_TIME_SECOND_HALF: ['start 2nd half extra time', 'começo do 2º tempo da prorrogação'],
    EXTRA_TIME_END: ['end extra time', 'fim da prorrogação'],
    SHOOTOUT_START: ['start shootout', 'começo da disputa de pênaltis'],
    SECOND_HALF_START: ['start 2nd half', 'second half', '2nd half', 'começo do 2º tempo'],
    MATCH_START: ['kickoff', 'kick off', 'match start', 'começo'],
    MATCH_END: ['full time', 'fulltime', 'match end', 'fim de jogo'],
    HALF_TIME: ['half time', 'halftime', 'meio tempo'],
};

/** Type substrings that mean the goal was disallowed/overturned — do not post as goal. */
const DISALLOWED_GOAL_KEYWORDS = [
    'disallowed', 'no goal', 'ruled out', 'overturned', 'not given', 'chalked off',
    'annulado', 'não vale', 'cancelado', 'impedimento', ...PENALTY_MISSED_KEYWORDS,
];

/**
 * Determine the event category from event type id (preferred) or type string (fallback).
 * @param {string} type - Event type string
 * @param {string|number} [typeId] - ESPN keyEvents[].type.id
 * @returns {string|null} Category name or null
 */
function categorizeEvent(type, typeId) {
    const lowerType = (type || '').toLowerCase();
    const isDisallowedGoal = () => DISALLOWED_GOAL_KEYWORDS.some((kw) => lowerType.includes(kw));

    if (typeId != null) {
        const category = ID_TO_CATEGORY[String(typeId)];
        if (category != null) {
            if (category === 'GOAL' && isDisallowedGoal()) return null;
            return category;
        }
    }

    if (!type) return null;
    for (const [category, keywords] of Object.entries(EVENT_TYPES)) {
        if (keywords.some((kw) => lowerType.includes(kw))) {
            if (category === 'GOAL' && isDisallowedGoal()) return null;
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
 * Event ID usado pelo handler match_start e pelo catch-up (formato único para evitar duplicata).
 * @param {string|number} matchId - Match ID
 * @returns {string}
 */
export function getMatchStartEventId(matchId) {
    return `${String(matchId)}-match-start`;
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
        case 'EXTRA_TIME_START':
        case 'EXTRA_TIME_HALF':
        case 'EXTRA_TIME_SECOND_HALF':
        case 'EXTRA_TIME_END':
        case 'SHOOTOUT_START':
            return config.events.extraTime;
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
        category: categorizeEvent(event.type, event.typeId),
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
        if (category === 'MATCH_START' && isEventPosted(getMatchStartEventId(match.id))) return false;
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
            let postOptions = {};
            if (category === 'GOAL' && config.media.attachCrests) {
                const scoringTeamId = event.teamId || event.team?.id;
                const scoringTeam =
                    scoringTeamId && String(scoringTeamId) === String(match.homeTeam?.id)
                        ? match.homeTeam
                        : scoringTeamId && String(scoringTeamId) === String(match.awayTeam?.id)
                        ? match.awayTeam
                        : null;
                const logoUrl = scoringTeam?.logo;
                if (logoUrl) {
                    const mediaId = await uploadMediaFromUrl(logoUrl, {
                        type: 'image',
                        description: `${scoringTeam.name} crest`,
                    });
                    if (mediaId) postOptions = { mediaIds: [mediaId] };
                }
            }
            const result = await postStatus(text, postOptions);
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
        case 'EXTRA_TIME_START':
            return formatExtraTimeStart(match);
        case 'EXTRA_TIME_HALF':
            return formatExtraTimeHalf(match, event);
        case 'EXTRA_TIME_SECOND_HALF':
            return formatExtraTimeSecondHalf(match, event);
        case 'EXTRA_TIME_END':
            return formatExtraTimeEnd(match);
        case 'SHOOTOUT_START':
            return formatShootoutStart(match);
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
            // formatHighlights includes video URLs as text fallback
            const highlightsText = formatHighlights(match, highlights);
            
            // Try to upload the first highlight video as an attachment
            const firstHighlight = highlights[0];
            let mediaIds = [];
            
            if (firstHighlight.url) {
                console.log(`[EventProcessor] Baixando vídeo do highlight: ${firstHighlight.url}`);
                const mediaId = await uploadMediaFromUrl(firstHighlight.url, { 
                    type: 'video', 
                    description: firstHighlight.title || 'Highlight'
                });
                
                if (mediaId) {
                    mediaIds.push(mediaId);
                } else if (firstHighlight.thumbnail) {
                    // Fallback to thumbnail if video fails
                    console.log(`[EventProcessor] Fallback para thumbnail: ${firstHighlight.thumbnail}`);
                    const thumbId = await uploadMediaFromUrl(firstHighlight.thumbnail, { 
                        type: 'image', 
                        description: firstHighlight.title || 'Thumbnail'
                    });
                    if (thumbId) mediaIds.push(thumbId);
                }
            }

            const postOptions = mediaIds.length > 0 ? { mediaIds } : {};
            await postStatus(highlightsText, postOptions);
            markEventPosted(highlightsId);
            console.log(`[EventProcessor] Highlights postados para partida ${match.id}`);
        }
    }

    if (config.events.matchStats) {
        const statsId = `${match.id}-match-stats`;
        if (!isEventPosted(statsId)) {
            const statsText = formatMatchStats(match);
            if (statsText) {
                await postStatus(statsText);
                markEventPosted(statsId);
                console.log(`[EventProcessor] Estatísticas postadas para partida ${match.id}`);
            }
        }
    }
}
