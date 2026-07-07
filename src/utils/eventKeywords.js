/**
 * Shared ESPN keyEvents[].type.text keyword lists for in-game (not shootout) penalty
 * detection. Centralized so espn.js, eventProcessor.js, and formatter.js can't drift out of
 * sync — each previously kept its own copy of these phrases, risking silent mismatches if one
 * were updated (e.g. when ESPN adds wording) without the others.
 */

/** Phrases meaning a penalty was converted (counts as a goal). */
export const PENALTY_SCORED_KEYWORDS = ['penalty - scored', 'gol de pênalti', 'pênalti convertido'];

/** Phrases meaning a penalty was missed/saved (does not count as a goal). */
export const PENALTY_MISSED_KEYWORDS = [
    'penalty - saved',
    'penalty - missed',
    'pênalti defendido',
    'pênalti perdido',
    'pênalti - defendido',
    'pênalti - perdido',
];

/** ESPN provisional description while the play is still being written (PT/EN). */
export const TEMPORARY_ATTEMPT_KEYWORDS = [
    'tentativa temporária',
    'tentativa temporaria',
    'temporary attempt',
];

export function isTemporaryAttemptDescription(description) {
    const d = (description || '').toLowerCase();
    return TEMPORARY_ATTEMPT_KEYWORDS.some((kw) => d.includes(kw));
}

/**
 * True when `text` looks like ESPN's transient short-form event text (e.g. "Jude Bellingham
 * (England) Goal at 36'" / "...Gol temporário aos 36'" / "...Tentativa temporária aos 21'")
 * rather than the full narrative description. ESPN fills in keyEvents[].text asynchronously
 * under the same event id — polling can catch the placeholder before it's replaced.
 * @param {string} text - event.text / event.description
 * @returns {boolean}
 */
export function isPlaceholderEventText(text) {
    if (!text || typeof text !== 'string') return false;
    if (isTemporaryAttemptDescription(text)) return true;
    return /\b(?:at|aos)\s+\d+(?:\+\d+)?['’]?\s*$/i.test(text.trim());
}
