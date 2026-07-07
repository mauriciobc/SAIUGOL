import { config } from '../config.js';
import { postStatus, uploadMediaFromUrl } from '../api/mastodon.js';
import { getHighlights } from '../api/espn.js';
import {
    PENALTY_SCORED_KEYWORDS,
    PENALTY_MISSED_KEYWORDS,
    TEMPORARY_ATTEMPT_KEYWORDS,
    isTemporaryAttemptDescription,
} from '../utils/eventKeywords.js';
import {
    resolveVarPhasedPost,
    markVarPhasedEventSeen,
} from '../utils/eventVarPhase.js';
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
    formatPenaltyMissed,
    formatGoalProvisional,
    formatGoalConfirmed,
    formatPenaltyMissedProvisional,
    formatPenaltyMissedConfirmed,
    formatMatchDelayStart,
    formatMatchDelayEnd,
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
    '114': 'PENALTY_MISSED',         // Penalty - Saved / Pênalti defendido
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
    '93': 'RED_CARD',                // Red Card / Cartão vermelho
    '129': 'MATCH_DELAY_START',      // Start Delay / Jogo atrasado (hidratação, lesão, etc.)
    '130': 'MATCH_DELAY_END',        // End Delay / Fim do atraso
    '138': 'GOAL',                   // Goal - Free-kick / Gol de falta
    '167': 'VAR',                    // VAR - Card Upgrade
};

/** Housekeeping typeIds — never post (diffEngine or other paths handle these). */
const SKIP_TYPE_IDS = new Set(['83', '89']);

/**
 * Event type constants — fallback for event ids not covered by ID_TO_CATEGORY
 * (e.g. leagues that report a different id scheme, or types not yet observed).
 */
const EVENT_TYPES = {
    PENALTY_MISSED: [...PENALTY_MISSED_KEYWORDS],
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
    MATCH_DELAY_START: ['start delay', 'jogo atrasado'],
    MATCH_DELAY_END: ['end delay', 'fim do atraso'],
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
 * @param {string} [description] - Event description (for provisional ESPN text)
 * @returns {string|null} Category name or null
 */
export function categorizeEvent(type, typeId, description) {
    const lowerType = (type || '').toLowerCase();
    const isDisallowedGoal = () => DISALLOWED_GOAL_KEYWORDS.some((kw) => lowerType.includes(kw));
    const isPenaltyType = () =>
        PENALTY_MISSED_KEYWORDS.some((kw) => lowerType.includes(kw))
        || lowerType.includes('penalty')
        || lowerType.includes('pênalti');

    if (typeId != null) {
        if (SKIP_TYPE_IDS.has(String(typeId))) return null;
        const category = ID_TO_CATEGORY[String(typeId)];
        if (category != null) {
            if (category === 'GOAL' && isDisallowedGoal()) return null;
            return category;
        }
    }

    // Provisional ESPN type — goal attempts await VAR; penalty when type hints penalty.
    if (TEMPORARY_ATTEMPT_KEYWORDS.some((kw) => lowerType.includes(kw))) {
        return isPenaltyType() ? 'PENALTY_MISSED' : 'GOAL';
    }

    if (!type) return null;
    for (const [category, keywords] of Object.entries(EVENT_TYPES)) {
        if (keywords.some((kw) => lowerType.includes(kw))) {
            if (category === 'GOAL' && isDisallowedGoal()) return null;
            return category;
        }
    }

    // Provisional description — goal awaits VAR; penalty when type hints penalty.
    if (isTemporaryAttemptDescription(description)) {
        return isPenaltyType() ? 'PENALTY_MISSED' : 'GOAL';
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

function normalizeMinute(minute) {
    return String(minute ?? '').trim().replace(/'+$/, '');
}

function isMatchDelayCategory(category) {
    return category === 'MATCH_DELAY_START' || category === 'MATCH_DELAY_END';
}

/**
 * Synthetic event ID for match delays (129/130). ESPN emits two events per pause (one per team).
 * @param {string|number} matchId
 * @param {string} category - MATCH_DELAY_START | MATCH_DELAY_END
 * @param {string} minute
 * @returns {string}
 */
export function getMatchDelayEventId(matchId, category, minute) {
    const phase = category === 'MATCH_DELAY_START' ? 'start' : 'end';
    return `${String(matchId)}-delay-${phase}-${normalizeMinute(minute)}`;
}

/**
 * Collapse duplicate delay events (same minute) and prefer the one with a description.
 * @param {Array} withIds
 * @param {string|number} matchId
 * @returns {Array}
 */
function resolveDelayEvents(withIds, matchId) {
    const groups = new Map();
    const nonDelay = [];

    for (const item of withIds) {
        if (!isMatchDelayCategory(item.category)) {
            nonDelay.push(item);
            continue;
        }
        const key = getMatchDelayEventId(matchId, item.category, item.event.minute);
        const existing = groups.get(key);
        const hasDesc = Boolean((item.event.description || '').trim());
        if (!existing) {
            groups.set(key, { ...item, eventId: key });
        } else {
            const existingHasDesc = Boolean((existing.event.description || '').trim());
            if (hasDesc && !existingHasDesc) {
                groups.set(key, { ...item, eventId: key });
            }
        }
    }

    return [...nonDelay, ...groups.values()];
}

/**
 * Mark current events as already seen (for matches joined in progress).
 * @param {string} matchId - Match ID
 * @param {Array<Object>} events - Current events from API
 */
export function markExistingEventsAsSeen(matchId, events) {
    for (const event of events) {
        const category = categorizeEvent(event.type, event.typeId, event.description);
        const baseEventId = isMatchDelayCategory(category)
            ? getMatchDelayEventId(matchId, category, event.minute)
            : generateEventId(matchId, event);
        if (isMatchDelayCategory(category)) {
            markEventPosted(baseEventId);
        } else {
            markVarPhasedEventSeen(baseEventId, event, category, markEventPosted);
        }
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
        case 'GOAL_PROVISIONAL':
        case 'GOAL_CONFIRMED':
        case 'PENALTY_MISSED':
        case 'PENALTY_MISSED_PROVISIONAL':
        case 'PENALTY_MISSED_CONFIRMED':
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
        case 'MATCH_DELAY_START':
        case 'MATCH_DELAY_END':
            return config.events.matchDelay;
        case 'MATCH_END':
            return config.events.matchEnd;
        default:
            return false;
    }
}

const PRIORITY_HIGH = 0;  // GOAL, RED_CARD - process first
const PRIORITY_NORMAL = 1;

function eventPriority(category) {
    if (category === 'GOAL' || category === 'GOAL_PROVISIONAL' || category === 'GOAL_CONFIRMED' || category === 'RED_CARD') {
        return PRIORITY_HIGH;
    }
    return PRIORITY_NORMAL;
}

function isGoalPostCategory(category) {
    return category === 'GOAL' || category === 'GOAL_PROVISIONAL' || category === 'GOAL_CONFIRMED';
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

    const withIds = resolveDelayEvents(
        events.map((event) => {
            const baseEventId = generateEventId(match.id, event);
            const category = categorizeEvent(event.type, event.typeId, event.description);
            const resolved = resolveVarPhasedPost({
                baseEventId,
                baseCategory: category,
                event,
                isEventPosted,
            });
            return {
                event,
                baseEventId,
                category,
                eventId: resolved?.eventId ?? baseEventId,
                postCategory: resolved?.postCategory ?? category,
                varPhase: resolved?.phase ?? null,
            };
        }),
        match.id
    );

    for (let i = 0; i < withIds.length; i++) {
        const { event, eventId, category, postCategory, varPhase } = withIds[i];
        const posted = isEventPosted(eventId);
        console.log(
            `[EventProcessor] Partida ${match.id} evento ${i + 1}/${events.length}:`,
            JSON.stringify({
                eventId,
                category: category ?? '(sem categoria)',
                postCategory: postCategory ?? '(sem post)',
                varPhase,
                alreadyPosted: posted,
                content: event,
            }, null, 2)
        );
    }

    const postable = withIds.filter(({ eventId, category, postCategory }) => {
        if (!category || !postCategory) return false;
        if (isEventPosted(eventId)) return false;
        if (category === 'MATCH_START' && isEventPosted(getMatchStartEventId(match.id))) return false;
        return shouldPostEvent(postCategory);
    });

    if (postable.length === 0 && events.length > 0) {
        const alreadyPosted = withIds.filter(({ eventId }) => isEventPosted(eventId)).length;
        const noCategory = withIds.filter(({ category }) => !category).length;
        const disabledItems = withIds.filter(
            ({ postCategory }) => postCategory && !shouldPostEvent(postCategory)
        );
        const categoryDisabledCount = disabledItems.length;
        const disabledCategories = [...new Set(disabledItems.map(({ postCategory }) => postCategory))].join(', ');
        console.log(
            `[EventProcessor] Partida ${match.id}: ${events.length} eventos recebidos, 0 novos para postar ` +
            `(já postados: ${alreadyPosted}, sem categoria: ${noCategory}, categoria desativada: ${categoryDisabledCount}${disabledCategories ? ` [${disabledCategories}]` : ''})`
        );
        return 0;
    }

    postable.sort((a, b) => eventPriority(a.postCategory) - eventPriority(b.postCategory));

    for (const { event, eventId, postCategory } of postable) {
        const isFavorite = isFavoriteTeam(event, match);
        const text = formatEventPost(postCategory, event, match, { isFavoriteTeam: isFavorite });
        if (text) {
            let postOptions = {};
            if (isGoalPostCategory(postCategory) && config.media.attachCrests) {
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
                console.log(`[EventProcessor] Postado evento ${postCategory} para partida ${match.id}`);
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
        case 'GOAL_PROVISIONAL':
            return formatGoalProvisional(event, match, options);
        case 'GOAL_CONFIRMED':
            return formatGoalConfirmed(event, match, options);
        case 'PENALTY_MISSED':
            return formatPenaltyMissed(event, match, options);
        case 'PENALTY_MISSED_PROVISIONAL':
            return formatPenaltyMissedProvisional(event, match, options);
        case 'PENALTY_MISSED_CONFIRMED':
            return formatPenaltyMissedConfirmed(event, match, options);
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
        case 'MATCH_DELAY_START':
            return formatMatchDelayStart(event, match);
        case 'MATCH_DELAY_END':
            return formatMatchDelayEnd(event, match);
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
