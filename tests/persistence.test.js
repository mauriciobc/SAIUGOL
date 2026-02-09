import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadState, saveState, getStateStats } from '../src/state/persistence.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-persistence-test-'));
const originalStateDir = process.env.STATE_DIR;

beforeEach(() => {
    process.env.STATE_DIR = testDir;
});

afterEach(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
});

describe('persistence', () => {
    it('loadState deve retornar estado vazio quando arquivo não existe', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const state = await loadState();

        assert.ok(state.postedEventIds instanceof Set);
        assert.strictEqual(state.postedEventIds.size, 0);
        assert.ok(typeof state.matchSnapshots === 'object');
        assert.strictEqual(Object.keys(state.matchSnapshots || {}).length, 0);
    });

    it('saveState deve gravar e loadState deve restaurar', async () => {
        const postedIds = new Set(['e1', 'e2']);
        const snapshots = new Map([
            ['bra.1:m1', { id: 'm1', score: { home: 1, away: 0 }, status: 'in', gameTime: "45'" }],
        ]);

        const saved = await saveState(postedIds, snapshots);
        assert.strictEqual(saved, true);

        const loaded = await loadState();
        assert.strictEqual(loaded.postedEventIds.size, 2);
        assert.ok(loaded.postedEventIds.has('e1'));
        assert.ok(loaded.postedEventIds.has('e2'));
        assert.strictEqual(Object.keys(loaded.matchSnapshots).length, 1);
        assert.strictEqual(loaded.matchSnapshots['bra.1:m1'].id, 'm1');
    });

    it('saveState deve aceitar matchSnapshots como objeto', async () => {
        const postedIds = new Set();
        const snapshots = { 'league:1': { id: '1', score: { home: 0, away: 0 }, status: 'pre', gameTime: '-' } };

        const saved = await saveState(postedIds, snapshots);
        assert.strictEqual(saved, true);

        const loaded = await loadState();
        assert.strictEqual(loaded.matchSnapshots['league:1'].id, '1');
    });

    it('getStateStats deve retornar exists: false quando arquivo não existe', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const stats = await getStateStats();
        assert.strictEqual(stats.exists, false);
    });

    it('getStateStats deve retornar exists e size após save', async () => {
        await saveState(new Set(), new Map());
        const stats = await getStateStats();
        assert.strictEqual(stats.exists, true);
        assert.ok(typeof stats.size === 'number');
        assert.ok(stats.size > 0);
    });
});
