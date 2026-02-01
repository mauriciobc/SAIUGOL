/**
 * In-memory state management for tracking matches and events
 */

// Cached league ID
let cachedLeagueId = null;

// Active matches being monitored: Map<matchId, matchData>
const activeMatches = new Map();

// Set of posted event IDs to avoid duplicates: Set<eventId>
const postedEventIds = new Set();

// Last known score per match: Map<matchId, { home: number, away: number }>
const lastScores = new Map();

/**
 * Get or set the cached league ID
 * @param {number|null} id - League ID to cache (optional)
 * @returns {number|null} Cached league ID
 */
export function getLeagueId(id = undefined) {
    if (id !== undefined) {
        cachedLeagueId = id;
    }
    return cachedLeagueId;
}

/**
 * Check if a match is being monitored
 * @param {number} matchId - Match ID
 * @returns {boolean}
 */
export function isMatchActive(matchId) {
    return activeMatches.has(matchId);
}

/**
 * Add a match to active monitoring
 * @param {number} matchId - Match ID
 * @param {Object} matchData - Match details
 */
export function addActiveMatch(matchId, matchData) {
    activeMatches.set(matchId, matchData);
    console.log(`[State] Partida ${matchId} adicionada ao monitoramento`);
}

/**
 * Remove a match from active monitoring
 * @param {number} matchId - Match ID
 */
export function removeActiveMatch(matchId) {
    activeMatches.delete(matchId);
    console.log(`[State] Partida ${matchId} removida do monitoramento`);
}

/**
 * Get all active matches
 * @returns {Map<number, Object>}
 */
export function getActiveMatches() {
    return activeMatches;
}

/**
 * Check if an event has already been posted
 * @param {string} eventId - Event identifier
 * @returns {boolean}
 */
export function isEventPosted(eventId) {
    return postedEventIds.has(eventId);
}

/**
 * Mark an event as posted
 * @param {string} eventId - Event identifier
 */
export function markEventPosted(eventId) {
    postedEventIds.add(eventId);
}

/**
 * Get the last known score for a match
 * @param {number} matchId - Match ID
 * @returns {Object|null} { home: number, away: number } or null
 */
export function getLastScore(matchId) {
    return lastScores.get(matchId) || null;
}

/**
 * Update the last known score for a match
 * @param {number} matchId - Match ID
 * @param {number} home - Home team score
 * @param {number} away - Away team score
 */
export function updateLastScore(matchId, home, away) {
    lastScores.set(matchId, { home, away });
}

/**
 * Clear all state for a match when it ends
 * @param {number} matchId - Match ID
 */
export function clearMatchState(matchId) {
    activeMatches.delete(matchId);
    lastScores.delete(matchId);
    // Note: We keep posted events to avoid re-posting if bot restarts
}

/**
 * Get stats about current state
 * @returns {Object} State statistics
 */
export function getStateStats() {
    return {
        leagueId: cachedLeagueId,
        activeMatchCount: activeMatches.size,
        postedEventCount: postedEventIds.size,
    };
}
