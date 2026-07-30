/**
 * Shared confirmation FSM for ESPN placeholder → final-text lifecycles
 * (goals, missed penalties, match-delay starts).
 *
 * Pure decision only — posting / persistence stay in the caller.
 *
 * @typedef {'pass'|'wait'|'start_pending'|'confirm'|'disallow'} ConfirmationAction
 * @typedef {{ action: ConfirmationAction, timedOut?: boolean }} ConfirmationDecision
 *
 * @param {object} input
 * @param {boolean} input.alreadyPosted
 * @param {boolean} input.applies - Whether this lifecycle owns the event
 * @param {{ firstSeenAt: number, statusId?: string }|null} [input.pending]
 * @param {boolean} [input.isReady] - Description is final (not placeholder / has delay reason)
 * @param {boolean} [input.timedOut]
 * @param {boolean} [input.isDisallowed] - Goal disallowed while pending
 * @param {boolean} [input.shouldStartPending] - First sight should enter pending flow
 * @returns {ConfirmationDecision}
 */
export function decideConfirmationStep({
    alreadyPosted,
    applies,
    pending = null,
    isReady = false,
    timedOut = false,
    isDisallowed = false,
    shouldStartPending = false,
}) {
    if (alreadyPosted || !applies) return { action: 'pass' };

    if (pending) {
        if (isDisallowed) return { action: 'disallow' };
        if (isReady || timedOut) return { action: 'confirm', timedOut: !isReady && timedOut };
        return { action: 'wait' };
    }

    if (shouldStartPending) return { action: 'start_pending' };
    return { action: 'pass' };
}
