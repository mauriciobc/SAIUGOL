import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveState } from '../src/state/persistence.js';
import { getMatchStartEventId } from '../src/bot/eventProcessor.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-matchstate-init-'));
const originalStateDir = process.env.STATE_DIR;

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

describe('matchState initialization and whenReady', () => {
    beforeEach(() => {
        process.env.STATE_DIR = testDir;
    });

    it('whenReady retorna Promise que resolve apos estado carregado', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const snap = { id: '1', score: { home: 0, away: 0 }, status: 'in', gameTime: "0'" };
        await saveState(new Set(), new Map([['bra.1:1', snap]]));

        const { resetStateForTesting, getPreviousSnapshot } = await import('../src/state/matchState.js');
        resetStateForTesting();

        const { whenReady } = await import('../src/state/matchState.js');
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

    it('restaura gols pendentes persistidos após reinício (evita perder a tréplica de confirmação)', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        await saveState(new Set(), new Map(), [], null, null, new Map([
            ['m9-ev9', { matchId: 'm9', statusId: '999', firstSeenAt: Date.now() }],
        ]));

        const { resetStateForTesting, getPendingGoal } = await import('../src/state/matchState.js');
        resetStateForTesting();

        const { whenReady } = await import('../src/state/matchState.js');
        await whenReady();

        const restored = getPendingGoal('m9-ev9');
        assert.ok(restored, 'expected pending goal to be restored');
        assert.strictEqual(restored.statusId, '999');
    });

    it('restaura atrasos pendentes persistidos após reinício (evita perder a janela de hidratação/lesão)', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const firstSeenAt = 1751765766000;
        await saveState(
            new Set(),
            new Map(),
            [],
            null,
            null,
            null,
            null,
            new Map([['760509-delay-start-23', { matchId: '760509', firstSeenAt }]])
        );

        const { resetStateForTesting, getPendingDelayStart } = await import('../src/state/matchState.js');
        resetStateForTesting();

        const { whenReady } = await import('../src/state/matchState.js');
        await whenReady();

        const restored = getPendingDelayStart('760509-delay-start-23');
        assert.ok(restored, 'expected pending delay start to be restored');
        assert.strictEqual(restored.matchId, '760509');
        assert.strictEqual(restored.firstSeenAt, firstSeenAt);
    });

    it('saveStateNow persiste pendingDelayStarts em memória', async () => {
        const stateFile = join(testDir, 'state.json');
        if (existsSync(stateFile)) rmSync(stateFile);

        const { resetStateForTesting, whenReady, markDelayStartPending, saveStateNow } = await import('../src/state/matchState.js');
        resetStateForTesting();
        await whenReady();

        markDelayStartPending('m2-delay-start-45', { matchId: 'm2', firstSeenAt: 42 });
        const saved = await saveStateNow();
        assert.strictEqual(saved, true);

        const { loadState } = await import('../src/state/persistence.js');
        const loaded = await loadState();
        assert.strictEqual(loaded.pendingDelayStarts['m2-delay-start-45'].matchId, 'm2');
        assert.strictEqual(loaded.pendingDelayStarts['m2-delay-start-45'].firstSeenAt, 42);
    });
});

describe('catch-up match start event id', () => {
    it('usa mesmo formato de event id que o handler match_start (evita duplicata)', () => {
        assert.strictEqual(getMatchStartEventId('123'), '123-match-start');
    });
});
