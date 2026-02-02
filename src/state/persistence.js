import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// State file path - use data directory for Docker volume mounting
const STATE_DIR = process.env.STATE_DIR || '/app/data';
const STATE_FILE = `${STATE_DIR}/state.json`;

/**
 * Ensure state directory exists
 */
async function ensureStateDir() {
    try {
        await fs.mkdir(STATE_DIR, { recursive: true });
    } catch (error) {
        console.error('[Persistence] Erro ao criar diretório de estado:', error.message);
    }
}

/**
 * Load state from disk
 * @returns {Promise<Object>} State object with postedEventIds
 */
export async function loadState() {
    try {
        await ensureStateDir();
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        console.log(`[Persistence] Estado carregado: ${state.postedEventIds?.length || 0} eventos postados`);
        return {
            postedEventIds: new Set(state.postedEventIds || []),
            lastSaveTime: state.lastSaveTime,
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Persistence] Nenhum estado anterior encontrado, iniciando novo');
            return { postedEventIds: new Set() };
        }
        console.error('[Persistence] Erro ao carregar estado:', error.message);
        return { postedEventIds: new Set() };
    }
}

/**
 * Save state to disk
 * @param {Set<string>} postedEventIds - Set of posted event IDs
 * @returns {Promise<boolean>} Success status
 */
export async function saveState(postedEventIds) {
    try {
        await ensureStateDir();
        const state = {
            postedEventIds: Array.from(postedEventIds),
            lastSaveTime: new Date().toISOString(),
            version: '1.0',
        };

        // Write to temp file first, then rename for atomic write
        const tempFile = `${STATE_FILE}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
        await fs.rename(tempFile, STATE_FILE);

        console.log(`[Persistence] Estado salvo: ${state.postedEventIds.length} eventos`);
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
        const stats = await fs.stat(STATE_FILE);
        return {
            exists: true,
            size: stats.size,
            modified: stats.mtime,
        };
    } catch (error) {
        return { exists: false };
    }
}
