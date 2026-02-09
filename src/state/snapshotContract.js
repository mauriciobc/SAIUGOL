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
 * Normalize ESPN status/state to contract status.
 * @param {string} [espnStatusName] - competition.status.type.name from API
 * @param {string} [espnState] - competition.status.type.state from API
 * @returns {SnapshotStatus}
 */
export function normalizeStatus(espnStatusName = '', espnState = '') {
    const name = String(espnStatusName).toLowerCase().trim();
    const state = String(espnState).toLowerCase().trim();

    if (STATUS_POST.some(s => name.includes(s) || state.includes(s))) {
        return 'post';
    }
    if (STATUS_IN.some(s => name.includes(s) || state.includes(s))) {
        return 'in';
    }
    if (STATUS_PRE.some(s => name.includes(s) || state.includes(s))) {
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
    const gameTime = event?.minute != null ? String(event.minute).trim() : "0'";

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
