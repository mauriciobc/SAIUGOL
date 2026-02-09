/**
 * Diff engine: compare new snapshots with previous cache and emit actions
 * only when something relevant changed. No Mastodon/formatter dependency.
 *
 * @module state/diffEngine
 */

/**
 * @typedef {'match_start'|'match_end'|'score_changed'} DiffActionType
 */

/**
 * @typedef {Object} DiffAction
 * @property {DiffActionType} type
 * @property {import('./snapshotContract.js').MatchSnapshot} snapshot
 * @property {string} leagueCode
 */

/**
 * @param {{ home: number, away: number }} a
 * @param {{ home: number, away: number }} b
 * @returns {boolean}
 */
function scoreEqual(a, b) {
    if (!a || !b) return false;
    return a.home === b.home && a.away === b.away;
}

/**
 * Compute diff between new snapshots and previous cache for one league.
 * Returns actions only when there is a change (status or score).
 *
 * @param {string} leagueCode - League code (e.g. 'bra.1')
 * @param {Map<string, import('./snapshotContract.js').MatchSnapshot>} newSnapshotMap - New snapshots keyed by match id
 * @param {(key: string) => import('./snapshotContract.js').MatchSnapshot|undefined} getPreviousSnapshot - Get previous snapshot by composite key
 * @returns {{ actions: DiffAction[], snapshotEntries: Array<[string, import('./snapshotContract.js').MatchSnapshot]> }}
 */
export function computeDiff(leagueCode, newSnapshotMap, getPreviousSnapshot) {
    /** @type {DiffAction[]} */
    const actions = [];
    /** @type {Array<[string, import('./snapshotContract.js').MatchSnapshot]>} */
    const snapshotEntries = [];

    for (const [matchId, newSnap] of newSnapshotMap) {
        const compositeKey = `${leagueCode}:${matchId}`;
        const oldSnap = getPreviousSnapshot(compositeKey);
        snapshotEntries.push([compositeKey, newSnap]);

        const oldStatus = oldSnap?.status;
        const newStatus = newSnap.status;
        const scoreChanged = !scoreEqual(oldSnap?.score, newSnap.score);

        if (oldStatus === 'pre' && newStatus === 'in') {
            actions.push({ type: 'match_start', snapshot: newSnap, leagueCode });
        } else if (oldStatus === 'in' && newStatus === 'post') {
            actions.push({ type: 'match_end', snapshot: newSnap, leagueCode });
        } else if (newStatus === 'in' && scoreChanged) {
            actions.push({ type: 'score_changed', snapshot: newSnap, leagueCode });
        }
    }

    return { actions, snapshotEntries };
}
