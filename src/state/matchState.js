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

// After restart: keys (leagueCode:matchId) that were live at last save; consumed on first poll
/** @type {Set<string>} */
const recoveredActiveKeys = new Set();

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
    if (state.activeMatchKeys && state.activeMatchKeys.length > 0) {
        state.activeMatchKeys.forEach((k) => recoveredActiveKeys.add(k));
        console.log(`[State] ${recoveredActiveKeys.size} chaves de partidas ativas restauradas`);
    }

    // Start periodic save timer (skip in test to avoid keeping process alive)
    if (process.env.NODE_ENV !== 'test') {
        startPeriodicSave();
    }
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
    const activeMatchKeys = [];
    for (const [key, snap] of previousSnapshots) {
        if (snap && snap.status === 'in') activeMatchKeys.push(key);
    }
    return await persistState(postedEventIds, previousSnapshots, activeMatchKeys);
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

// Promise resolved when state is loaded from persistence (used to avoid first poll before load)
let initPromise = null;

// Start loading on module load; callers must await whenReady() before first poll
initPromise = initializeState().catch((error) => {
    console.error('[State] Erro na inicialização:', error.message);
    throw error;
});

/**
 * Returns a Promise that resolves when persisted state has been loaded. Must be awaited before
 * starting monitoring so the first poll sees restored previousSnapshots (avoids race on restart).
 * @returns {Promise<void>}
 */
export function whenReady() {
    if (initialized) return Promise.resolve();
    if (!initPromise) initPromise = initializeState();
    return initPromise;
}

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

/** Normalize match id so Map lookups work whether callers pass string or number. */
function mid(matchId) {
    if (matchId == null) {
        throw new Error('matchId cannot be null or undefined');
    }
    return String(matchId);
}

/**
 * Check if a match is being monitored
 * @param {number|string} matchId - Match ID
 * @returns {boolean}
 */
export function isMatchActive(matchId) {
    return activeMatches.has(mid(matchId));
}

/**
 * Add a match to active monitoring
 * @param {number|string} matchId - Match ID
 * @param {Object} matchData - Match details
 */
export function addActiveMatch(matchId, matchData) {
    const key = mid(matchId);
    activeMatches.set(key, matchData);
    console.log(`[State] Partida ${key} adicionada ao monitoramento`);
}

/**
 * Remove a match from active monitoring
 * @param {number|string} matchId - Match ID
 */
export function removeActiveMatch(matchId) {
    activeMatches.delete(mid(matchId));
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
 * @param {number|string} matchId - Match ID
 * @returns {Object|null} { home: number, away: number } or null
 */
export function getLastScore(matchId) {
    return lastScores.get(mid(matchId)) || null;
}

/**
 * Update the last known score for a match
 * @param {number|string} matchId - Match ID
 * @param {number} home - Home team score
 * @param {number} away - Away team score
 */
export function updateLastScore(matchId, home, away) {
    lastScores.set(mid(matchId), { home, away });
}

/**
 * Clean up posted event IDs for a finished match
 * @param {number|string} matchId - Match ID
 */
function cleanupMatchEvents(matchId) {
    const prefix = `${mid(matchId)}-`;
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
 * @param {number|string} matchId - Match ID
 */
export function clearMatchState(matchId) {
    const key = mid(matchId);
    activeMatches.delete(key);
    lastScores.delete(key);
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
 * True if this composite key was restored as "was live at save"; removes the key so it is only consumed once.
 * Used by matchMonitor catch-up to treat the match as already live after restart.
 * @param {string} compositeKey - "leagueCode:matchId"
 * @returns {boolean}
 */
export function isRecoveredActiveKey(compositeKey) {
    if (!recoveredActiveKeys.has(compositeKey)) return false;
    recoveredActiveKeys.delete(compositeKey);
    return true;
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
