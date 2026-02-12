import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveState } from '../src/state/persistence.js';
import { getMatchStartEventId } from '../src/bot/eventProcessor.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-matchstate-init-'));
const originalStateDir = process.env.STATE_DIR;

afterEach(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
});

describe('matchState initialization and whenReady', () => {
    before(() => {
        process.env.STATE_DIR = testDir;
    });

    it('whenReady retorna Promise que resolve apos estado carregado', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const snap = { id: '1', score: { home: 0, away: 0 }, status: 'in', gameTime: "0'" };
        await saveState(new Set(), new Map([['bra.1:1', snap]]));

        const { whenReady, getPreviousSnapshot } = await import('../src/state/matchState.js');
        const readyPromise = whenReady();
        assert.ok(readyPromise instanceof Promise, 'whenReady() deve retornar uma Promise');

        await readyPromise;

        const restored = getPreviousSnapshot('bra.1:1');
        assert.ok(restored, 'expected previous snapshot to be restored');
        assert.strictEqual(restored.id, '1');
        assert.strictEqual(restored.status, 'in');
        assert.deepStrictEqual(restored.score, { home: 0, away: 0 });
    });

    it('whenReady resolve imediatamente quando ja inicializado', async () => {
        const { whenReady } = await import('../src/state/matchState.js');
        await whenReady();
        const start = Date.now();
        await whenReady();
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 50, 'Segundo whenReady() deve resolver imediatamente (ja inicializado)');
    });
});

describe('catch-up match start event id', () => {
    it('usa mesmo formato de event id que o handler match_start (evita duplicata)', () => {
        assert.strictEqual(getMatchStartEventId('123'), '123-match-start');
    });
});
