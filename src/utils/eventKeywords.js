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
