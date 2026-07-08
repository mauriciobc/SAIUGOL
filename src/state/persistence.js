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

/**
 * Load state from disk
 * @returns {Promise<Object>} State object with postedEventIds and matchSnapshots
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
            matchSnapshots: state.matchSnapshots || {},
            activeMatchKeys: Array.isArray(state.activeMatchKeys) ? state.activeMatchKeys : [],
            lastDigestDate: state.lastDigestDate || null,
            lastNotificationId: state.lastNotificationId || null,
            pendingGoals: state.pendingGoals && typeof state.pendingGoals === 'object' ? state.pendingGoals : {},
            pendingPenalties: state.pendingPenalties && typeof state.pendingPenalties === 'object' ? state.pendingPenalties : {},
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            persistenceLogger.info('Nenhum estado anterior encontrado, iniciando novo');
            return { postedEventIds: new Set(), matchSnapshots: {}, activeMatchKeys: [], lastDigestDate: null, lastNotificationId: null, pendingGoals: {}, pendingPenalties: {} };
        }
        persistenceLogger.error({ error: error.message }, 'Erro ao carregar estado');
        return { postedEventIds: new Set(), matchSnapshots: {}, activeMatchKeys: [], lastDigestDate: null, lastNotificationId: null, pendingGoals: {}, pendingPenalties: {} };
    }
}

/**
 * Save state to disk
 * @param {Set<string>} postedEventIds - Set of posted event IDs
 * @param {Map<string, import('./snapshotContract.js').MatchSnapshot>} [matchSnapshots] - Snapshot cache (key: leagueCode:matchId)
 * @param {string[]} [activeMatchKeys] - Composite keys (leagueCode:matchId) of matches that were live at save
 * @param {string} [lastDigestDate]
 * @param {string} [lastNotificationId]
 * @param {Map<string, Object>} [pendingGoals] - Goals awaiting ESPN confirmation (key: eventId)
 * @param {Map<string, Object>} [pendingPenalties] - Penalties awaiting ESPN confirmation (key: eventId)
 * @returns {Promise<boolean>} Success status
 */
export async function saveState(postedEventIds, matchSnapshots = null, activeMatchKeys = null, lastDigestDate = null, lastNotificationId = null, pendingGoals = null, pendingPenalties = null) {
    try {
        await ensureStateDir();
        const snapshotObj = matchSnapshots instanceof Map
            ? Object.fromEntries(matchSnapshots)
            : (matchSnapshots && typeof matchSnapshots === 'object' ? matchSnapshots : {});
        const pendingGoalsObj = pendingGoals instanceof Map
            ? Object.fromEntries(pendingGoals)
            : (pendingGoals && typeof pendingGoals === 'object' ? pendingGoals : {});
        const pendingPenaltiesObj = pendingPenalties instanceof Map
            ? Object.fromEntries(pendingPenalties)
            : (pendingPenalties && typeof pendingPenalties === 'object' ? pendingPenalties : {});
        const state = {
            postedEventIds: Array.from(postedEventIds),
            lastSaveTime: new Date().toISOString(),
            version: '1.1',
            matchSnapshots: snapshotObj,
            activeMatchKeys: Array.isArray(activeMatchKeys) ? activeMatchKeys : [],
            lastDigestDate: lastDigestDate || null,
            lastNotificationId: lastNotificationId || null,
            pendingGoals: pendingGoalsObj,
            pendingPenalties: pendingPenaltiesObj,
        };

        // Write to temp file first, then rename for atomic write
        const tempFile = `${getStateFile()}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
        await fs.rename(tempFile, getStateFile());

        const snapshotCount = Object.keys(snapshotObj).length;
        persistenceLogger.info(
            { eventCount: state.postedEventIds.length, snapshotCount },
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
