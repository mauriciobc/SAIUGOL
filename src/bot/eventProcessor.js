import { config } from '../config.js';
import { eventProcessorLogger } from '../utils/logger.js';
import { postStatus, uploadMediaFromUrl } from '../api/mastodon.js';
import { getHighlights } from '../api/espn.js';
import { isPlaceholderEventText } from '../utils/eventKeywords.js';
import {
    isEventPosted,
    markEventPosted,
    getPendingGoal,
    markGoalPending,
    resolvePendingGoal,
    getPendingPenalty,
    markPenaltyPending,
    resolvePendingPenalty,
    getPendingDelayStart,
    markDelayStartPending,
    resolvePendingDelayStart,
} from '../state/matchState.js';
import {
    formatGoal,
    formatGoalPending,
    formatGoalDisallowed,
    formatCard,
    formatSubstitution,
    formatVAR,
    formatMatchStart,
    formatSecondHalfStart,
    formatHalfTime,
    formatEndRegularTime,
    formatMatchEnd,
    formatHighlights,
    formatMatchStats,
    formatExtraTimeStart,
    formatExtraTimeHalf,
    formatExtraTimeSecondHalf,
    formatExtraTimeEnd,
    formatShootoutStart,
    formatPenaltyMissed,
    formatPenaltyMissedPending,
    formatMatchDelayStart,
    formatMatchDelayEnd,
} from './formatter.js';
import { decideConfirmationStep } from './confirmationLifecycle.js';
import { recordEventPosted } from '../utils/metrics.js';

import {
    categorizeEvent,
    EVENT_TYPES,
    DISALLOWED_GOAL_KEYWORDS,
} from './eventCategorization.js';

export { categorizeEvent };

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
        const eventId = isMatchDelayCategory(category)
            ? getMatchDelayEventId(matchId, category, event.minute)
            : generateEventId(matchId, event);
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
        case 'PENALTY_MISSED':
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
        case 'END_REGULAR_TIME':
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

/** Type substrings that mean the event is a goal (reuses EVENT_TYPES.GOAL). */
function looksLikeGoalType(type) {
    const lower = (type || '').toLowerCase();
    return EVENT_TYPES.GOAL.some((kw) => lower.includes(kw));
}

/** Type substrings that mean a penalty was missed/saved. */
function looksLikePenaltyMissedType(type) {
    const lower = (type || '').toLowerCase();
    return EVENT_TYPES.PENALTY_MISSED.some((kw) => lower.includes(kw));
}

function hasDelayDescription(event) {
    return Boolean((event.description || '').trim());
}

/**
 * Wait for ESPN delay description before posting MATCH_DELAY_START.
 * ESPN often emits one 129 per team; only one carries hydration/injury text.
 * @returns {Promise<{ handled: boolean, posted: boolean }>}
 */
async function handleMatchDelayStartLifecycle(event, eventId, category, match) {
    const applies = category === 'MATCH_DELAY_START' && shouldPostEvent('MATCH_DELAY_START');
    const pending = getPendingDelayStart(eventId);
    const hasDesc = hasDelayDescription(event);
    const timedOut = pending
        ? Date.now() - pending.firstSeenAt >= config.delays.delayReasonTimeoutMs
        : false;

    const decision = decideConfirmationStep({
        alreadyPosted: isEventPosted(eventId),
        applies,
        pending,
        isReady: hasDesc,
        timedOut,
        shouldStartPending: !hasDesc,
    });

    switch (decision.action) {
        case 'wait':
            return { handled: true, posted: false };
        case 'start_pending':
            markDelayStartPending(eventId, { matchId: String(match.id), firstSeenAt: Date.now() });
            console.log(`[EventProcessor] Atraso aguardando descrição ESPN (evento ${eventId}, partida ${match.id})`);
            return { handled: true, posted: false };
        case 'confirm': {
            const text = formatMatchDelayStart(event, match);
            const result = await postStatus(text);
            if (!result) return { handled: true, posted: false };
            markEventPosted(eventId);
            resolvePendingDelayStart(eventId);
            console.log(
                `[EventProcessor] Atraso postado${hasDesc ? '' : ' (timeout, sem descrição ESPN)'} (evento ${eventId}, partida ${match.id})`
            );
            return { handled: true, posted: true };
        }
        default:
            return { handled: false, posted: false };
    }
}

/**
 * Handle a goal event through its ESPN-confirmation lifecycle (pending → reply).
 * @returns {Promise<{ handled: boolean, posted: boolean }>}
 */
async function handleGoalConfirmationLifecycle(event, eventId, category, match) {
    const rawType = (event.type || '').toLowerCase();
    const applies = category === 'GOAL' || looksLikeGoalType(rawType);
    const pending = getPendingGoal(eventId);
    const isDisallowedNow = DISALLOWED_GOAL_KEYWORDS.some((kw) => rawType.includes(kw));
    const isPlaceholder = isPlaceholderEventText(event.description);
    const timedOut = pending
        ? Date.now() - pending.firstSeenAt > config.delays.goalConfirmationTimeoutMs
        : false;

    const decision = decideConfirmationStep({
        alreadyPosted: isEventPosted(eventId),
        applies,
        pending,
        isReady: !isPlaceholder,
        timedOut,
        isDisallowed: isDisallowedNow,
        shouldStartPending: category === 'GOAL' && !isDisallowedNow && isPlaceholder && shouldPostEvent('GOAL'),
    });

    switch (decision.action) {
        case 'wait':
            return { handled: true, posted: false };
        case 'disallow': {
            const result = await postStatus(formatGoalDisallowed(event, match), { inReplyToId: pending.statusId });
            if (!result) return { handled: true, posted: false };
            markEventPosted(eventId);
            resolvePendingGoal(eventId);
            console.log(`[EventProcessor] Gol anulado (evento ${eventId}, partida ${match.id})`);
            return { handled: true, posted: true };
        }
        case 'confirm': {
            const isFavorite = isFavoriteTeam(event, match);
            const result = await postStatus(formatGoal(event, match, { isFavoriteTeam: isFavorite }), { inReplyToId: pending.statusId });
            if (!result) return { handled: true, posted: false };
            markEventPosted(eventId);
            resolvePendingGoal(eventId);
            console.log(`[EventProcessor] Gol confirmado${isPlaceholder ? ' (timeout, texto ainda pendente)' : ''} (evento ${eventId}, partida ${match.id})`);
            return { handled: true, posted: true };
        }
        case 'start_pending': {
            const result = await postStatus(formatGoalPending(event, match));
            if (result) {
                markGoalPending(eventId, { matchId: String(match.id), statusId: result.id, firstSeenAt: Date.now() });
                console.log(`[EventProcessor] Gol aguardando confirmação (evento ${eventId}, partida ${match.id})`);
            }
            return { handled: true, posted: !!result };
        }
        default:
            return { handled: false, posted: false };
    }
}

/**
 * Handle a penalty-missed event through the same ESPN-confirmation lifecycle as goals.
 * @returns {Promise<{ handled: boolean, posted: boolean }>}
 */
async function handlePenaltyConfirmationLifecycle(event, eventId, category, match) {
    const rawType = (event.type || '').toLowerCase();
    const applies = category === 'PENALTY_MISSED' || looksLikePenaltyMissedType(rawType);
    const pending = getPendingPenalty(eventId);
    const isPlaceholder = isPlaceholderEventText(event.description);
    const timedOut = pending
        ? Date.now() - pending.firstSeenAt > config.delays.goalConfirmationTimeoutMs
        : false;

    const decision = decideConfirmationStep({
        alreadyPosted: isEventPosted(eventId),
        applies,
        pending,
        isReady: !isPlaceholder,
        timedOut,
        shouldStartPending: category === 'PENALTY_MISSED' && isPlaceholder && shouldPostEvent('PENALTY_MISSED'),
    });

    switch (decision.action) {
        case 'wait':
            return { handled: true, posted: false };
        case 'confirm': {
            const isFavorite = isFavoriteTeam(event, match);
            const result = await postStatus(
                formatPenaltyMissed(event, match, { isFavoriteTeam: isFavorite }),
                { inReplyToId: pending.statusId }
            );
            if (!result) return { handled: true, posted: false };
            markEventPosted(eventId);
            resolvePendingPenalty(eventId);
            console.log(`[EventProcessor] Pênalti defendido confirmado${isPlaceholder ? ' (timeout, texto ainda pendente)' : ''} (evento ${eventId}, partida ${match.id})`);
            return { handled: true, posted: true };
        }
        case 'start_pending': {
            const result = await postStatus(formatPenaltyMissedPending(event, match));
            if (result) {
                markPenaltyPending(eventId, { matchId: String(match.id), statusId: result.id, firstSeenAt: Date.now() });
                console.log(`[EventProcessor] Pênalti aguardando confirmação (evento ${eventId}, partida ${match.id})`);
            }
            return { handled: true, posted: !!result };
        }
        default:
            return { handled: false, posted: false };
    }
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
        events.map((event) => ({
            event,
            eventId: generateEventId(match.id, event),
            category: categorizeEvent(event.type, event.typeId, event.description),
        })),
        match.id
    );

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

    const handledEventIds = new Set();
    for (const { event, eventId, category } of withIds) {
        const goalResult = await handleGoalConfirmationLifecycle(event, eventId, category, match);
        if (goalResult.handled) {
            handledEventIds.add(eventId);
            if (goalResult.posted) {
                postedCount++;
                recordEventPosted();
                await new Promise((resolve) => setTimeout(resolve, config.delays.betweenPosts));
            }
            continue;
        }

        const penaltyResult = await handlePenaltyConfirmationLifecycle(event, eventId, category, match);
        if (penaltyResult.handled) {
            handledEventIds.add(eventId);
            if (penaltyResult.posted) {
                postedCount++;
                recordEventPosted();
                await new Promise((resolve) => setTimeout(resolve, config.delays.betweenPosts));
            }
            continue;
        }

        const delayResult = await handleMatchDelayStartLifecycle(event, eventId, category, match);
        if (delayResult.handled) {
            handledEventIds.add(eventId);
            if (delayResult.posted) {
                postedCount++;
                recordEventPosted();
                await new Promise((resolve) => setTimeout(resolve, config.delays.betweenPosts));
            }
        }
    }

    const postable = withIds.filter(({ event, eventId, category }) => {
        if (handledEventIds.has(eventId)) return false;
        if (isEventPosted(eventId)) return false;
        if (category === 'MATCH_START' && isEventPosted(getMatchStartEventId(match.id))) return false;
        if (isPlaceholderEventText(event?.description ?? '')) {
            eventProcessorLogger.debug(
                { eventId, category, matchId: match.id },
                'Aguardando descrição ESPN definitiva'
            );
            return false;
        }
        return category && shouldPostEvent(category);
    });

    if (postable.length === 0) {
        if (events.length > 0 && postedCount === 0) {
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
        }
        return postedCount;
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
                recordEventPosted();
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
        case 'PENALTY_MISSED':
            return formatPenaltyMissed(event, match, options);
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
        case 'END_REGULAR_TIME':
            return formatEndRegularTime(match, event);
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

    const endText = formatMatchEnd(match);
    await postStatus(endText);
    markEventPosted(matchEndId);

    console.log(`[EventProcessor] Partida ${match.id} finalizada`);

    await new Promise((resolve) => setTimeout(resolve, config.delays.beforeHighlights));

    const highlights = await getHighlights(match.id, match.league?.code);
    if (highlights.length > 0) {
        const highlightsId = `${match.id}-highlights`;
        if (!isEventPosted(highlightsId)) {
            const highlightsText = formatHighlights(match, highlights);

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

