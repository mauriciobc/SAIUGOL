import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createChild } from '../utils/logger.js';

const persistenceLogger = createChild({ component: 'persistence' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// State file path - use data directory for Docker volume mounting (runtime so tests can override)
function getStateDir() {
    return process.env.STATE_DIR || '/app/data';
}
function getStateFile() {
    return `${getStateDir()}/state.json`;
}

/**
 * Ensure state directory exists
 */
async function ensureStateDir() {
    try {
        await fs.mkdir(getStateDir(), { recursive: true });
    } catch (error) {
        persistenceLogger.error({ error: error.message }, 'Erro ao criar diretório de estado');
    }
}

/** Keyed state saved as plain objects in state.json (Maps in memory). */
const KEYED_STATE = ['matchSnapshots', 'pendingGoals', 'pendingPenalties', 'pendingDelayStarts', 'matchThreads'];

/** Map → plain object for JSON; a plain object passes through; anything else → {}. */
function toPlainObject(value) {
    if (value instanceof Map) return Object.fromEntries(value);
    return value && typeof value === 'object' ? value : {};
}

function emptyState() {
    return {
        postedEventIds: new Set(),
        activeMatchKeys: [],
        lastDigestDate: null,
        lastNotificationId: null,
        ...Object.fromEntries(KEYED_STATE.map((key) => [key, {}])),
    };
}

/**
 * Load state from disk
 * @returns {Promise<Object>} State with postedEventIds (Set), activeMatchKeys, lastDigestDate,
 *   lastNotificationId and the keyed state (matchSnapshots, pendingGoals, pendingPenalties,
 *   pendingDelayStarts, matchThreads) as plain objects
 */
export async function loadState() {
    try {
        await ensureStateDir();
        const data = await fs.readFile(getStateFile(), 'utf-8');
        const state = JSON.parse(data);
        const snapshotCount = state.matchSnapshots ? Object.keys(state.matchSnapshots).length : 0;
        persistenceLogger.info(
            { eventCount: state.postedEventIds?.length || 0, snapshotCount },
            'Estado carregado'
        );
        return {
            postedEventIds: new Set(state.postedEventIds || []),
            lastSaveTime: state.lastSaveTime,
            activeMatchKeys: Array.isArray(state.activeMatchKeys) ? state.activeMatchKeys : [],
            lastDigestDate: state.lastDigestDate || null,
            lastNotificationId: state.lastNotificationId || null,
            ...Object.fromEntries(KEYED_STATE.map((key) => [key, toPlainObject(state[key])])),
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            persistenceLogger.info('Nenhum estado anterior encontrado, iniciando novo');
        } else {
            persistenceLogger.error({ error: error.message }, 'Erro ao carregar estado');
        }
        return emptyState();
    }
}

/**
 * Save state to disk
 * @param {Set<string>} postedEventIds - Set of posted event IDs
 * @param {Object} [state] - Everything else, by name (all optional)
 * @param {Map<string, import('./snapshotContract.js').MatchSnapshot>} [state.matchSnapshots] - Snapshot cache (key: leagueCode:matchId)
 * @param {string[]} [state.activeMatchKeys] - Composite keys (leagueCode:matchId) of matches that were live at save
 * @param {string} [state.lastDigestDate]
 * @param {string} [state.lastNotificationId]
 * @param {Map<string, Object>} [state.pendingGoals] - Goals awaiting ESPN confirmation (key: eventId)
 * @param {Map<string, Object>} [state.pendingPenalties] - Penalties awaiting ESPN confirmation (key: eventId)
 * @param {Map<string, Object>} [state.pendingDelayStarts] - Stoppages awaiting ESPN's description (key: eventId)
 * @param {Map<string, string>} [state.matchThreads] - Latest status id posted per match (key: matchId)
 * @returns {Promise<boolean>} Success status
 */
export async function saveState(postedEventIds, state = {}) {
    try {
        await ensureStateDir();
        const toSave = {
            postedEventIds: Array.from(postedEventIds),
            lastSaveTime: new Date().toISOString(),
            version: '1.2',
            activeMatchKeys: Array.isArray(state.activeMatchKeys) ? state.activeMatchKeys : [],
            lastDigestDate: state.lastDigestDate || null,
            lastNotificationId: state.lastNotificationId || null,
            ...Object.fromEntries(KEYED_STATE.map((key) => [key, toPlainObject(state[key])])),
        };

        // Write to temp file first, then rename for atomic write
        const tempFile = `${getStateFile()}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(toSave, null, 2), 'utf-8');
        await fs.rename(tempFile, getStateFile());

        persistenceLogger.info(
            { eventCount: toSave.postedEventIds.length, snapshotCount: Object.keys(toSave.matchSnapshots).length },
            'Estado salvo'
        );
        return true;
    } catch (error) {
        persistenceLogger.error({ error: error.message }, 'Erro ao salvar estado');
        return false;
    }
}

/**
 * Get state file statistics for debugging
 * @returns {Promise<Object|null>} File stats or null
 */
export async function getStateStats() {
    try {
        const stats = await fs.stat(getStateFile());
        return {
            exists: true,
            size: stats.size,
            modified: stats.mtime,
        };
    } catch (error) {
        return { exists: false };
    }
}
