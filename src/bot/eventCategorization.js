import {
    PENALTY_SCORED_KEYWORDS,
    PENALTY_MISSED_KEYWORDS,
    TEMPORARY_ATTEMPT_KEYWORDS,
    isTemporaryAttemptDescription,
} from '../utils/eventKeywords.js';

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
    '83': 'END_REGULAR_TIME',        // End Regular Time / Fim do tempo regulamentar
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
const SKIP_TYPE_IDS = new Set(['89']);

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
    END_REGULAR_TIME: ['end regular time', 'fim do tempo regulamentar', 'fim do segundo tempo'],
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

export { EVENT_TYPES, DISALLOWED_GOAL_KEYWORDS };
