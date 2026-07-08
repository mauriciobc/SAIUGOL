/**
 * Public barrel for Mastodon post formatters (split under ./formatters/).
 */
export { parseSubstitutionFromDescription, parseDelayReason } from '../domain/eventTextParsers.js';

export {
    formatGoal,
    formatGoalPending,
    formatGoalDisallowed,
    formatPenaltyMissed,
    formatPenaltyMissedPending,
} from './formatters/scoringFormatters.js';

export {
    formatCard,
    formatSubstitution,
    formatVAR,
} from './formatters/cardFormatters.js';

export {
    formatMatchStart,
    formatSecondHalfStart,
    formatHalfTime,
    formatEndRegularTime,
    formatMatchEnd,
    formatExtraTimeStart,
    formatExtraTimeHalf,
    formatExtraTimeSecondHalf,
    formatExtraTimeEnd,
    formatShootoutStart,
    formatMatchDelayStart,
    formatMatchDelayEnd,
} from './formatters/matchPhaseFormatters.js';

export {
    formatMatchStats,
    formatDailyDigest,
    formatMatchPreview,
    formatHighlights,
} from './formatters/digestFormatters.js';
