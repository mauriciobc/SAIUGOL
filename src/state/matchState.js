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

// Goals seen with ESPN's transient placeholder text, awaiting the full description before the
// real "GOOOOL" post goes out: Map<eventId, { matchId, statusId, firstSeenAt }>
const pendingGoals = new Map();

// Penalties missed/saved with placeholder text, awaiting full ESPN description.
const pendingPenalties = new Map();

// Match delays (129) seen without ESPN description — wait for hydration/injury text from the other team.
const pendingDelayStarts = new Map();

// Last known score per match: Map<matchId, { home: number, away: number }>
const lastScores = new Map();

// Previous snapshot per match for diff: key = "leagueCode:matchId", value = MatchSnapshot
/** @type {Map<string, import('./snapshotContract.js').MatchSnapshot>} */
const previousSnapshots = new Map();

// After restart: keys (leagueCode:matchId) that were live at last save; consumed on first poll
/** @type {Set<string>} */
const recoveredActiveKeys = new Set();

// Last calendar date (YYYY-MM-DD) a daily digest was posted; persisted to avoid double-posting on restart
let lastDigestDate = null;

// Last processed notification ID for the mention listener; persisted to avoid re-answering old mentions on restart
let lastNotificationId = null;

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
    if (state.lastDigestDate) {
        lastDigestDate = state.lastDigestDate;
    }
    if (state.lastNotificationId) {
        lastNotificationId = state.lastNotificationId;
    }
    if (state.pendingGoals && typeof state.pendingGoals === 'object') {
        for (const [eventId, data] of Object.entries(state.pendingGoals)) {
            if (data) pendingGoals.set(eventId, data);
        }
        console.log(`[State] ${pendingGoals.size} gols pendentes restaurados`);
    }
    if (state.pendingPenalties && typeof state.pendingPenalties === 'object') {
        for (const [eventId, data] of Object.entries(state.pendingPenalties)) {
            if (data) pendingPenalties.set(eventId, data);
        }
        console.log(`[State] ${pendingPenalties.size} pênaltis pendentes restaurados`);
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
    return await persistState(postedEventIds, previousSnapshots, activeMatchKeys, lastDigestDate, lastNotificationId, pendingGoals, pendingPenalties);
}

export function getLastDigestDate() { return lastDigestDate; }
export function setLastDigestDate(date) { lastDigestDate = date; }
export function getLastNotificationId() { return lastNotificationId; }
export function setLastNotificationId(id) { lastNotificationId = id; }

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
 * Reset module-level state for testing. Only callable when NODE_ENV=test.
 */
export function resetStateForTesting() {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('resetStateForTesting is only allowed in test environment');
    }
    initialized = false;
    initPromise = null;
    activeMatches.clear();
    postedEventIds.clear();
    pendingGoals.clear();
    pendingPenalties.clear();
    pendingDelayStarts.clear();
    lastScores.clear();
    previousSnapshots.clear();
    recoveredActiveKeys.clear();
    lastDigestDate = null;
    lastNotificationId = null;
    stopPeriodicSave();
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
 * Get a goal awaiting confirmation (ESPN text still placeholder-shaped).
 * @param {string} eventId - Event identifier
 * @returns {{ matchId: string, statusId: string, firstSeenAt: number }|null}
 */
export function getPendingGoal(eventId) {
    return pendingGoals.get(eventId) || null;
}

/**
 * Mark a goal as awaiting confirmation.
 * @param {string} eventId - Event identifier
 * @param {{ matchId: string, statusId: string, firstSeenAt?: number }} data
 */
export function markGoalPending(eventId, data) {
    pendingGoals.set(eventId, { ...data, firstSeenAt: data.firstSeenAt ?? Date.now() });
}

/**
 * Clear a goal's pending state (confirmed, disallowed, or timed out).
 * @param {string} eventId - Event identifier
 */
export function resolvePendingGoal(eventId) {
    pendingGoals.delete(eventId);
}

/**
 * Get a penalty awaiting confirmation (ESPN text still placeholder-shaped).
 * @param {string} eventId - Event identifier
 * @returns {{ matchId: string, statusId: string, firstSeenAt: number }|null}
 */
export function getPendingPenalty(eventId) {
    return pendingPenalties.get(eventId) || null;
}

/**
 * Mark a penalty as awaiting confirmation.
 * @param {string} eventId - Event identifier
 * @param {{ matchId: string, statusId: string, firstSeenAt?: number }} data
 */
export function markPenaltyPending(eventId, data) {
    pendingPenalties.set(eventId, { ...data, firstSeenAt: data.firstSeenAt ?? Date.now() });
}

/**
 * Clear a penalty's pending state (confirmed or timed out).
 * @param {string} eventId - Event identifier
 */
export function resolvePendingPenalty(eventId) {
    pendingPenalties.delete(eventId);
}

/**
 * Get a delay start awaiting ESPN description (ESPN often sends one event per team).
 * @param {string} eventId - Synthetic delay event ID
 * @returns {{ matchId: string, firstSeenAt: number }|null}
 */
export function getPendingDelayStart(eventId) {
    return pendingDelayStarts.get(eventId) || null;
}

/**
 * Mark a delay start as awaiting ESPN description before posting.
 * @param {string} eventId - Synthetic delay event ID
 * @param {{ matchId: string, firstSeenAt?: number }} data
 */
export function markDelayStartPending(eventId, data) {
    pendingDelayStarts.set(eventId, { ...data, firstSeenAt: data.firstSeenAt ?? Date.now() });
}

/**
 * Clear pending delay start state after posting.
 * @param {string} eventId - Synthetic delay event ID
 */
export function resolvePendingDelayStart(eventId) {
    pendingDelayStarts.delete(eventId);
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
    let cleanedPendingCount = 0;

    for (const eventId of postedEventIds) {
        if (eventId.startsWith(prefix)) {
            postedEventIds.delete(eventId);
            cleanedCount++;
        }
    }

    for (const eventId of pendingGoals.keys()) {
        if (eventId.startsWith(prefix)) {
            pendingGoals.delete(eventId);
            cleanedPendingCount++;
        }
    }

    for (const eventId of pendingPenalties.keys()) {
        if (eventId.startsWith(prefix)) {
            pendingPenalties.delete(eventId);
            cleanedPendingCount++;
        }
    }

    for (const eventId of pendingDelayStarts.keys()) {
        if (eventId.startsWith(prefix)) {
            pendingDelayStarts.delete(eventId);
            cleanedPendingCount++;
        }
    }

    if (cleanedCount > 0 || cleanedPendingCount > 0) {
        console.log(`[State] Removidos ${cleanedCount} eventos antigos e ${cleanedPendingCount} confirmações pendentes da partida ${matchId}`);
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
