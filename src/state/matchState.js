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

// Last Mastodon status id per match (for threading): Map<matchId, statusId>
const lastTootIdByMatch = new Map();

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
    if (state.threadLastTootIds && typeof state.threadLastTootIds === 'object') {
        for (const [key, statusId] of Object.entries(state.threadLastTootIds)) {
            if (key && statusId) lastTootIdByMatch.set(key, statusId);
        }
        console.log(`[State] ${lastTootIdByMatch.size} thread last toots restaurados`);
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
    return await persistState(postedEventIds, previousSnapshots, lastTootIdByMatch);
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

// Initialize on module load (skip in test to avoid pending promise / timer)
if (process.env.NODE_ENV !== 'test') {
    initializeState().catch(error => {
        console.error('[State] Erro na inicialização:', error.message);
    });
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
 * Get the last posted toot (status) id for a match (for threading)
 * @param {number|string} matchId - Match ID
 * @returns {string|null} Mastodon status id or null
 */
export function getLastTootId(matchId) {
    return lastTootIdByMatch.get(mid(matchId)) ?? null;
}

/**
 * Set the last posted toot id for a match (after posting)
 * @param {number|string} matchId - Match ID
 * @param {string} statusId - Mastodon status id
 */
export function setLastTootId(matchId, statusId) {
    lastTootIdByMatch.set(mid(matchId), statusId);
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
    lastTootIdByMatch.delete(key);
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
