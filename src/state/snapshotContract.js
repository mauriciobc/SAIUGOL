/**
 * Contract for match state snapshot. Single source of truth for the three
 * variables we track per match. If ESPN changes their JSON, only this module
 * (and optionally the ESPN normalizer) needs to be updated.
 *
 * @module state/snapshotContract
 */

/**
 * Normalized match status for diff and polling logic.
 * @typedef {'pre'|'in'|'post'} SnapshotStatus
 * - pre: not started (scheduled, tbd, etc.)
 * - in: in progress (live, 1h, 2h, ht, etc.)
 * - post: finished (ft, aet, pen, etc.)
 */

/**
 * @typedef {Object} MatchSnapshot
 * @property {string} id - Match ID (ESPN primary key)
 * @property {{ home: number, away: number }} score - Current score
 * @property {SnapshotStatus} status - Normalized status
 * @property {string} gameTime - Display string (e.g. "45'", "HT", "FT")
 */

const STATUS_PRE = ['scheduled', 'not started', 'tbd', 'pre'];
const STATUS_IN = ['live', 'in play', '1h', '2h', 'ht', 'et', 'bt', 'pt', 'in'];
const STATUS_POST = ['finished', 'ft', 'aet', 'pen', 'post'];

/**
 * Tokens from string (lowercase, non-empty, split on non-word chars).
 * @param {string} str
 * @returns {string[]}
 */
function getTokens(str) {
    return String(str).toLowerCase().trim().split(/\W+/).filter(Boolean);
}

/**
 * True if keyword appears as whole word in text (\b boundaries).
 * @param {string} text
 * @param {string} keyword
 * @returns {boolean}
 */
function hasWord(text, keyword) {
    if (!keyword) return false;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * True if any status keyword matches: single-word as token, multi-word as \b phrase.
 * @param {string[]} tokens - Union of tokens from name and state
 * @param {string} name - Raw name
 * @param {string} state - Raw state
 * @param {string[]} statusKeywords
 * @returns {boolean}
 */
function matchesStatus(tokens, name, state, statusKeywords) {
    return statusKeywords.some((kw) => {
        if (kw.includes(' ')) {
            return hasWord(name, kw) || hasWord(state, kw);
        }
        return tokens.includes(kw);
    });
}

/**
 * Normalize ESPN status/state to contract status.
 * Uses token/word-boundary matching so e.g. "postponed" does not match "post".
 * @param {string} [espnStatusName] - competition.status.type.name from API
 * @param {string} [espnState] - competition.status.type.state from API
 * @returns {SnapshotStatus}
 */
export function normalizeStatus(espnStatusName = '', espnState = '') {
    const name = String(espnStatusName).toLowerCase().trim();
    const state = String(espnState).toLowerCase().trim();
    const tokens = [...new Set([...getTokens(name), ...getTokens(state)])];

    if (matchesStatus(tokens, name, state, STATUS_POST)) {
        return 'post';
    }
    if (matchesStatus(tokens, name, state, STATUS_IN)) {
        return 'in';
    }
    if (matchesStatus(tokens, name, state, STATUS_PRE)) {
        return 'pre';
    }

    return 'pre';
}

/**
 * Build a MatchSnapshot from a normalized match object (as returned by getTodayMatches).
 * All ESPN structure reading is centralized here.
 *
 * @param {Object} event - Normalized match from ESPN scoreboard (id, homeScore, awayScore, status, state, minute)
 * @returns {MatchSnapshot}
 */
export function espnEventToSnapshot(event) {
    const id = event?.id != null ? String(event.id) : '';
    const home = parseInt(event?.homeScore, 10) || 0;
    const away = parseInt(event?.awayScore, 10) || 0;
    const status = normalizeStatus(event?.status, event?.state);
    const rawMinute = event?.minute != null ? String(event.minute).trim() : '';
    const gameTime = status === 'pre' ? '-' : (rawMinute || "0'");

    return {
        id,
        score: { home, away },
        status,
        gameTime,
    };
}

/**
 * Build a map of snapshots keyed by match id from a list of normalized matches.
 * @param {Array<Object>} matches - List of normalized matches from getTodayMatches
 * @returns {Map<string, MatchSnapshot>}
 */
export function matchesToSnapshotMap(matches) {
    const map = new Map();
    if (!Array.isArray(matches)) return map;
    for (const m of matches) {
        const snap = espnEventToSnapshot(m);
        if (snap.id) map.set(snap.id, snap);
    }
    return map;
}
