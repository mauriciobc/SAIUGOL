import { isTemporaryAttemptDescription, PENALTY_MISSED_KEYWORDS } from './eventKeywords.js';

/**
 * @param {string} [description]
 * @returns {boolean}
 */
export function isConfirmedGoalDescription(description) {
    if (!description || typeof description !== 'string') return false;
    return /^(?:Goal|Gol)!/i.test(description.trim());
}

/**
 * @param {string} [description]
 * @returns {boolean}
 */
export function isConfirmedPenaltyMissedDescription(description) {
    if (!description || typeof description !== 'string') return false;
    if (isTemporaryAttemptDescription(description)) return false;
    const d = description.toLowerCase();
    return (
        /^pênalti defendido!/i.test(description.trim())
        || /^penalty - saved/i.test(description.trim())
        || PENALTY_MISSED_KEYWORDS.some((kw) => d.includes(kw))
    );
}

/**
 * @typedef {'provisional'|'confirmed'|'direct'} EventVarPhase
 */

/**
 * ESPN sends "Tentativa temporária" while VAR reviews; final text replaces it on the same event id.
 * @param {Object} event
 * @param {string} baseCategory - GOAL | PENALTY_MISSED
 * @returns {EventVarPhase}
 */
export function getEventVarPhase(event, baseCategory) {
    if (baseCategory !== 'GOAL' && baseCategory !== 'PENALTY_MISSED') {
        return 'direct';
    }
    const desc = (event.description || event.text || '').trim();
    if (isTemporaryAttemptDescription(desc)) {
        return 'provisional';
    }
    if (baseCategory === 'GOAL' && isConfirmedGoalDescription(desc)) {
        return 'confirmed';
    }
    if (baseCategory === 'PENALTY_MISSED' && isConfirmedPenaltyMissedDescription(desc)) {
        return 'confirmed';
    }
    if (desc) {
        return 'confirmed';
    }
    return 'direct';
}

/**
 * @param {string} baseCategory
 * @param {EventVarPhase} phase
 * @param {boolean} provisionalWasPosted
 * @returns {string}
 */
export function getPostCategory(baseCategory, phase, provisionalWasPosted) {
    if (phase === 'provisional') {
        return baseCategory === 'GOAL' ? 'GOAL_PROVISIONAL' : 'PENALTY_MISSED_PROVISIONAL';
    }
    if (phase === 'confirmed' && provisionalWasPosted) {
        return baseCategory === 'GOAL' ? 'GOAL_CONFIRMED' : 'PENALTY_MISSED_CONFIRMED';
    }
    return baseCategory;
}

/**
 * Resolve post category and dedup event id for VAR-phased goal / penalty-missed events.
 * @param {{ baseEventId: string, baseCategory: string, event: Object, isEventPosted: (id: string) => boolean }} params
 * @returns {{ eventId: string, postCategory: string, phase: EventVarPhase }|null}
 */
export function resolveVarPhasedPost({ baseEventId, baseCategory, event, isEventPosted }) {
    if (baseCategory !== 'GOAL' && baseCategory !== 'PENALTY_MISSED') {
        if (isEventPosted(baseEventId)) return null;
        return { eventId: baseEventId, postCategory: baseCategory, phase: 'direct' };
    }

    const phase = getEventVarPhase(event, baseCategory);
    const provisionalId = `${baseEventId}-provisional`;
    const confirmedId = `${baseEventId}-confirmed`;

    if (phase === 'provisional') {
        if (isEventPosted(provisionalId)) return null;
        return {
            eventId: provisionalId,
            postCategory: getPostCategory(baseCategory, 'provisional', false),
            phase,
        };
    }

    if (phase === 'confirmed') {
        if (isEventPosted(confirmedId)) return null;
        if (isEventPosted(provisionalId)) {
            return {
                eventId: confirmedId,
                postCategory: getPostCategory(baseCategory, 'confirmed', true),
                phase,
            };
        }
        if (isEventPosted(baseEventId)) return null;
        return { eventId: baseEventId, postCategory: baseCategory, phase: 'direct' };
    }

    if (isEventPosted(baseEventId)) return null;
    return { eventId: baseEventId, postCategory: baseCategory, phase: 'direct' };
}

/**
 * Mark all relevant dedup ids when catching up mid-match.
 * @param {string} baseEventId
 * @param {Object} event
 * @param {string} baseCategory
 * @param {(id: string) => void} markPosted
 */
export function markVarPhasedEventSeen(baseEventId, event, baseCategory, markPosted) {
    if (baseCategory !== 'GOAL' && baseCategory !== 'PENALTY_MISSED') {
        markPosted(baseEventId);
        return;
    }
    const phase = getEventVarPhase(event, baseCategory);
    if (phase === 'provisional') {
        markPosted(`${baseEventId}-provisional`);
        return;
    }
    markPosted(`${baseEventId}-provisional`);
    markPosted(`${baseEventId}-confirmed`);
    markPosted(baseEventId);
}
