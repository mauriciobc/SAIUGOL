import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

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
        console.error('[Persistence] Erro ao criar diretório de estado:', error.message);
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
        console.log(`[Persistence] Estado carregado: ${state.postedEventIds?.length || 0} eventos, ${snapshotCount} snapshots`);
        return {
            postedEventIds: new Set(state.postedEventIds || []),
            lastSaveTime: state.lastSaveTime,
            matchSnapshots: state.matchSnapshots || {},
            activeMatchKeys: Array.isArray(state.activeMatchKeys) ? state.activeMatchKeys : [],
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Persistence] Nenhum estado anterior encontrado, iniciando novo');
            return { postedEventIds: new Set(), matchSnapshots: {}, activeMatchKeys: [] };
        }
        console.error('[Persistence] Erro ao carregar estado:', error.message);
        return { postedEventIds: new Set(), matchSnapshots: {}, activeMatchKeys: [] };
    }
}

/**
 * Save state to disk
 * @param {Set<string>} postedEventIds - Set of posted event IDs
 * @param {Map<string, import('./snapshotContract.js').MatchSnapshot>} [matchSnapshots] - Snapshot cache (key: leagueCode:matchId)
 * @param {string[]} [activeMatchKeys] - Composite keys (leagueCode:matchId) of matches that were live at save
 * @returns {Promise<boolean>} Success status
 */
export async function saveState(postedEventIds, matchSnapshots = null, activeMatchKeys = null) {
    try {
        await ensureStateDir();
        const snapshotObj = matchSnapshots instanceof Map
            ? Object.fromEntries(matchSnapshots)
            : (matchSnapshots && typeof matchSnapshots === 'object' ? matchSnapshots : {});
        const state = {
            postedEventIds: Array.from(postedEventIds),
            lastSaveTime: new Date().toISOString(),
            version: '1.1',
            matchSnapshots: snapshotObj,
            activeMatchKeys: Array.isArray(activeMatchKeys) ? activeMatchKeys : [],
        };

        // Write to temp file first, then rename for atomic write
        const tempFile = `${getStateFile()}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
        await fs.rename(tempFile, getStateFile());

        const snapshotCount = Object.keys(snapshotObj).length;
        console.log(`[Persistence] Estado salvo: ${state.postedEventIds.length} eventos, ${snapshotCount} snapshots`);
        return true;
    } catch (error) {
        console.error('[Persistence] Erro ao salvar estado:', error.message);
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
