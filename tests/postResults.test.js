import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { initI18n } from '../src/services/i18n.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-postresults-'));
const originalStateDir = process.env.STATE_DIR;

let matchState;
let handleMatchEnd;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
    ({ handleMatchEnd } = await import('../src/bot/eventProcessor.js'));
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

const match = {
    id: '880001',
    homeTeam: { id: '1', name: 'Bahia' },
    awayTeam: { id: '2', name: 'Flamengo' },
    homeScore: 0,
    awayScore: 3,
    league: { code: 'bra.1', hashtags: ['#Brasileirão'] },
};

describe('handleMatchEnd', () => {
    const saved = {};

    beforeEach(() => {
        matchState.resetStateForTesting();
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

    it('does not mark full time as posted when Mastodon rejects it, so it can be retried', async () => {
        __setClient({
            postStatus: async () => {
                throw Object.assign(new Error('Request failed with status code 422'), { response: { status: 422 } });
            },
        });
        assert.strictEqual(await handleMatchEnd(match), false);
        assert.strictEqual(matchState.isEventPosted(`${match.id}-match-end`), false);
    });

    it('reports success without posting again when full time already went out', async () => {
        let calls = 0;
        __setClient({ postStatus: async () => { calls += 1; return { data: { id: '1' } }; } });
        matchState.markEventPosted(`${match.id}-match-end`);
        assert.strictEqual(await handleMatchEnd(match), true);
        assert.strictEqual(calls, 0);
    });
});

describe('clearMatchState', () => {
    beforeEach(() => matchState.resetStateForTesting());

    it('keeps the kickoff and full-time ids so a status flip-back does not re-announce them', () => {
        for (const suffix of ['match-start', 'match-end', 'goal-1', 'preview']) {
            matchState.markEventPosted(`${match.id}-${suffix}`);
        }
        matchState.clearMatchState(match.id);
        assert.strictEqual(matchState.isEventPosted(`${match.id}-match-start`), true);
        assert.strictEqual(matchState.isEventPosted(`${match.id}-match-end`), true);
        assert.strictEqual(matchState.isEventPosted(`${match.id}-goal-1`), false);
        assert.strictEqual(matchState.isEventPosted(`${match.id}-preview`), false);
    });
});

describe('whenReady', () => {
    it('resolves only once the persisted state is loaded, for every caller', async () => {
        writeFileSync(join(testDir, 'state.json'), JSON.stringify({ postedEventIds: ['restored-event'] }));
        matchState.resetStateForTesting();

        const first = matchState.whenReady();
        const second = matchState.whenReady(); // used to resolve at once while the first load was still running
        await second;
        assert.strictEqual(matchState.isEventPosted('restored-event'), true);
        await first;
    });
});
