import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveState } from '../src/state/persistence.js';
import { getMatchStartEventId, getMatchDelayEventId, markExistingEventsAsSeen, processEvents } from '../src/bot/eventProcessor.js';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';

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
        await saveState(new Set(), { matchSnapshots: new Map([['bra.1:1', snap]]) });

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

        await saveState(new Set(), {
            pendingGoals: new Map([['m9-ev9', { matchId: 'm9', statusId: '999', firstSeenAt: Date.now() }]]),
        });

        const { resetStateForTesting, getPendingGoal } = await import('../src/state/matchState.js');
        resetStateForTesting();

        const { whenReady } = await import('../src/state/matchState.js');
        await whenReady();

        const restored = getPendingGoal('m9-ev9');
        assert.ok(restored, 'expected pending goal to be restored');
        assert.strictEqual(restored.statusId, '999');
    });
});

describe('restart in the middle of a confirmation', () => {
    const delayId = getMatchDelayEventId('m7', 'MATCH_DELAY_START', "30'");
    const delayEvent = (description) => ({ id: 'd1', typeId: '129', type: 'jogo atrasado', minute: "30'", teamId: '1', description });
    const match = { id: 'm7', homeTeam: { id: '1', name: 'Bahia' }, awayTeam: { id: '2', name: 'Flamengo' }, homeScore: 0, awayScore: 0, league: { hashtags: [] } };
    const saved = {};

    beforeEach(() => {
        process.env.STATE_DIR = testDir;
        saved.dryRun = config.bot.dryRun;
        saved.betweenPosts = config.delays.betweenPosts;
        config.bot.dryRun = false;
        config.delays.betweenPosts = 0;
    });

    afterEach(() => {
        config.bot.dryRun = saved.dryRun;
        config.delays.betweenPosts = saved.betweenPosts;
        __setClient(null);
    });

    it('posts a stoppage that was waiting for ESPN\'s description when the bot went down', async () => {
        await saveState(new Set(), {
            pendingDelayStarts: new Map([[delayId, { matchId: 'm7', firstSeenAt: Date.now() }]]),
            matchThreads: new Map([['m7', '12345']]),
        });
        const matchState = await import('../src/state/matchState.js');
        matchState.resetStateForTesting();
        await matchState.whenReady();
        assert.ok(matchState.getPendingDelayStart(delayId), 'pending stoppage restored');
        assert.strictEqual(matchState.getMatchThreadTail('m7'), '12345', 'thread tail restored separately');

        // Catch-up after the restart must not swallow it
        markExistingEventsAsSeen('m7', [delayEvent('')]);
        assert.strictEqual(matchState.isEventPosted(delayId), false);

        const posted = [];
        __setClient({ postStatus: async (text) => { posted.push(text); return { data: { id: String(posted.length) } }; } });
        const count = await processEvents([delayEvent('Jogo paralisado para hidratação.')], match);
        assert.strictEqual(count, 1);
        assert.strictEqual(matchState.isEventPosted(delayId), true);
        assert.strictEqual(matchState.getPendingDelayStart(delayId), null);
    });

    it('leaves restored pending goals and penalties to their confirmation on catch-up', async () => {
        const matchState = await import('../src/state/matchState.js');
        matchState.resetStateForTesting();
        await matchState.whenReady();
        matchState.markGoalPending('m8-g1', { matchId: 'm8', statusId: '1', firstSeenAt: Date.now() });
        matchState.markPenaltyPending('m8-p1', { matchId: 'm8', statusId: '2', firstSeenAt: Date.now() });

        markExistingEventsAsSeen('m8', [
            { id: 'g1', typeId: '70', type: 'goal', minute: "10'" },
            { id: 'p1', typeId: '114', type: 'penalty - saved', minute: "20'" },
            { id: 'c1', typeId: '94', type: 'yellow card', minute: "25'" },
        ]);
        assert.strictEqual(matchState.isEventPosted('m8-g1'), false);
        assert.strictEqual(matchState.isEventPosted('m8-p1'), false);
        assert.strictEqual(matchState.isEventPosted('m8-c1'), true);
    });
});

describe('catch-up match start event id', () => {
    it('usa mesmo formato de event id que o handler match_start (evita duplicata)', () => {
        assert.strictEqual(getMatchStartEventId('123'), '123-match-start');
    });
});
