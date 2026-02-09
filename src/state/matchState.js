/**
 * In-memory state management for tracking matches and events
 */

import { loadState, saveState as persistState } from './persistence.js';
import { config } from '../config.js';

// Cached league ID
let cachedLeagueId = null;

// Active matches being monitored: Map<matchId, matchData>
const activeMatches = new Map();

// Set of posted event IDs to avoid duplicates: Set<eventId>
const postedEventIds = new Set();

// Last known score per match: Map<matchId, { home: number, away: number }>
const lastScores = new Map();

// Previous snapshot per match for diff: key = "leagueCode:matchId", value = MatchSnapshot
/** @type {Map<string, import('./snapshotContract.js').MatchSnapshot>} */
const previousSnapshots = new Map();

// Periodic save timer
let saveTimer = null;

// Initialization flag to prevent multiple initializations
let initialized = false;

/**
 * Initialize state from persistence
 */
async function initializeState() {
    if (initialized) {
        console.log('[State] Já inicializado, ignorando');
        return;
    }
    initialized = true;

    const state = await loadState();
    if (state.postedEventIds && state.postedEventIds.size > 0) {
        // Restore posted events
        state.postedEventIds.forEach(id => postedEventIds.add(id));
        console.log(`[State] ${postedEventIds.size} eventos restaurados do estado persistido`);
    }
    if (state.matchSnapshots && typeof state.matchSnapshots === 'object') {
        for (const [key, snap] of Object.entries(state.matchSnapshots)) {
            if (snap && snap.id != null) previousSnapshots.set(key, snap);
        }
        console.log(`[State] ${previousSnapshots.size} snapshots restaurados`);
    }

    // Start periodic save timer
    startPeriodicSave();
}

/**
 * Start periodic state saving
 */
function startPeriodicSave() {
    if (saveTimer) return;

    const interval = config.delays.statePersistence;
    saveTimer = setInterval(async () => {
        await saveStateNow();
    }, interval);

    console.log(`[State] Auto-save iniciado (intervalo: ${interval}ms)`);
}

/**
 * Save state immediately
 * @returns {Promise<boolean>}
 */
export async function saveStateNow() {
    return await persistState(postedEventIds, previousSnapshots);
}

/**
 * Stop periodic saving (for shutdown)
 */
export function stopPeriodicSave() {
    if (saveTimer) {
        clearInterval(saveTimer);
        saveTimer = null;
        console.log('[State] Auto-save parado');
    }
}

// Initialize on module load
initializeState().catch(error => {
    console.error('[State] Erro na inicialização:', error.message);
});

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
 * Clean up posted event IDs for a finished match
 * @param {number} matchId - Match ID
 */
function cleanupMatchEvents(matchId) {
    const prefix = `${matchId}-`;
    let cleanedCount = 0;

    for (const eventId of postedEventIds) {
        if (eventId.startsWith(prefix)) {
            postedEventIds.delete(eventId);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[State] Removidos ${cleanedCount} eventos antigos da partida ${matchId}`);
    }
}

/**
 * Clear all state for a match when it ends
 * @param {number} matchId - Match ID
 */
export function clearMatchState(matchId) {
    activeMatches.delete(matchId);
    lastScores.delete(matchId);
    cleanupMatchEvents(matchId);
}

/**
 * Get previous snapshot for a match (composite key: leagueCode:matchId).
 * @param {string} compositeKey - "leagueCode:matchId"
 * @returns {import('./snapshotContract.js').MatchSnapshot|undefined}
 */
export function getPreviousSnapshot(compositeKey) {
    return previousSnapshots.get(compositeKey);
}

/**
 * Merge snapshots into the previous-snapshot cache (e.g. after a poll).
 * @param {Array<[string, import('./snapshotContract.js').MatchSnapshot]>} entries - Pairs of compositeKey, snapshot
 */
export function mergePreviousSnapshots(entries) {
    for (const [key, snap] of entries) {
        if (key && snap) previousSnapshots.set(key, snap);
    }
}

/**
 * Get all previous snapshots (for persistence).
 * @returns {Map<string, import('./snapshotContract.js').MatchSnapshot>}
 */
export function getPreviousSnapshotsMap() {
    return previousSnapshots;
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
        snapshotCount: previousSnapshots.size,
    };
}

/**
 * Graceful shutdown - save state and stop timers
 * @returns {Promise<void>}
 */
export async function shutdown() {
    console.log('[State] Encerrando e salvando estado...');
    stopPeriodicSave();
    await saveStateNow();
    console.log('[State] Estado salvo com sucesso');
}
