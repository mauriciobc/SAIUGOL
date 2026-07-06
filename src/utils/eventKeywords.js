/**
 * Shared ESPN keyEvents[].type.text keyword lists for in-game (not shootout) penalty
 * detection. Centralized so espn.js, eventProcessor.js, and formatter.js can't drift out of
 * sync — each previously kept its own copy of these phrases, risking silent mismatches if one
 * were updated (e.g. when ESPN adds wording) without the others.
 */

/** Phrases meaning a penalty was converted (counts as a goal). */
export const PENALTY_SCORED_KEYWORDS = ['penalty - scored', 'gol de pênalti', 'pênalti convertido'];

/** Phrases meaning a penalty was missed/saved (does not count as a goal). */
export const PENALTY_MISSED_KEYWORDS = ['penalty - saved', 'penalty - missed', 'pênalti defendido', 'pênalti perdido'];

/**
 * True when `text` looks like ESPN's transient short-form event text (e.g. "Jude Bellingham
 * (England) Goal at 36'" / "...Gol temporário aos 36'") rather than the full narrative
 * description ("Gol! México 0, Inglaterra 1. Jude Bellingham (Inglaterra) de cabeça..."). ESPN
 * fills in keyEvents[].text asynchronously under the same event id — polling can catch the
 * placeholder before it's replaced. Confirmed goal narratives (including own goals, which never
 * start with "Gol!"/"Goal!") end in descriptive prose, never in a bare "at/aos <minute>'".
 * @param {string} text - event.text / event.description
 * @returns {boolean}
 */
export function isPlaceholderEventText(text) {
    if (!text || typeof text !== 'string') return false;
    return /\b(?:at|aos)\s+\d+(?:\+\d+)?['’]?\s*$/i.test(text.trim());
}
