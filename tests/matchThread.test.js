import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { initI18n } from '../src/services/i18n.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-matchthread-'));
const originalStateDir = process.env.STATE_DIR;

let matchState;
let postMatchStatus;
let processEvents;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
    ({ postMatchStatus } = await import('../src/bot/matchThread.js'));
    ({ processEvents } = await import('../src/bot/eventProcessor.js'));
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

const match = {
    id: '777001',
    homeTeam: { id: '1', name: 'Bahia' },
    awayTeam: { id: '2', name: 'Flamengo' },
    homeScore: 0,
    awayScore: 0,
    league: { hashtags: ['#Brasileirao'] },
};

const yellowCard = {
    id: 'yc-1',
    typeId: '94',
    type: 'cartão amarelo',
    minute: "30'",
    teamId: '2',
    description: 'Léo Pereira (Flamengo) recebe cartão amarelo por falta dura.',
    player: { name: 'Léo Pereira' },
};

const redCard = {
    id: 'rc-1',
    typeId: '93',
    type: 'cartão vermelho',
    minute: "80'",
    teamId: '1',
    description: 'David Duarte (Bahia) recebe cartão vermelho por jogada violenta.',
    player: { name: 'David Duarte' },
};

describe('postMatchStatus', () => {
    let posted;
    let nextId;
    let missingIds;
    const saved = {};

    beforeEach(() => {
        matchState.resetStateForTesting();
        saved.thread = config.bot.threadMatchPosts;
        saved.dryRun = config.bot.dryRun;
        saved.betweenPosts = config.delays.betweenPosts;
        config.bot.threadMatchPosts = true;
        config.bot.dryRun = false;
        config.delays.betweenPosts = 0;
        posted = [];
        nextId = 100;
        missingIds = new Set();
        __setClient({
            postStatus: async (text, opts) => {
                if (opts.in_reply_to_id && missingIds.has(opts.in_reply_to_id)) {
                    const err = new Error('Request failed with status code 404');
                    err.response = { status: 404 };
                    throw err;
                }
                nextId += 1;
                posted.push({ text, inReplyTo: opts.in_reply_to_id, id: String(nextId) });
                return { data: { id: String(nextId) } };
            },
        });
    });

    afterEach(() => {
        config.bot.threadMatchPosts = saved.thread;
        config.bot.dryRun = saved.dryRun;
        config.delays.betweenPosts = saved.betweenPosts;
        __setClient(null);
    });

    it('chains each post of a match to the previous one', async () => {
        await postMatchStatus(match.id, 'preview');
        await postMatchStatus(match.id, 'kickoff');
        await postMatchStatus(match.id, 'goal');

        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, '101', '102']);
        assert.strictEqual(matchState.getMatchThreadTail(match.id), '103');
    });

    it('keeps separate threads per match', async () => {
        await postMatchStatus('1', 'a1');
        await postMatchStatus('2', 'b1');
        await postMatchStatus('1', 'a2');

        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, undefined, '101']);
    });

    it('lets an explicit inReplyToId win and continues the thread from the new post', async () => {
        await postMatchStatus(match.id, 'goal pending'); // 101
        await postMatchStatus(match.id, 'card'); // 102
        await postMatchStatus(match.id, 'goal confirmed', { inReplyToId: '101' }); // 103
        await postMatchStatus(match.id, 'half time'); // 104

        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, '101', '101', '103']);
    });

    it('posts standalone when the thread tail was deleted, then threads from there', async () => {
        matchState.setMatchThreadTail(match.id, 'deleted-status');
        missingIds.add('deleted-status');

        const result = await postMatchStatus(match.id, 'kickoff');
        await postMatchStatus(match.id, 'goal');

        assert.strictEqual(result.id, '101');
        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, '101']);
    });

    it('does not reply or track anything when the flag is off', async () => {
        config.bot.threadMatchPosts = false;
        await postMatchStatus(match.id, 'preview');
        await postMatchStatus(match.id, 'kickoff');

        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, undefined]);
        assert.strictEqual(matchState.getMatchThreadTail(match.id), null);
    });

    it('forgets the thread when the match state is cleared', async () => {
        await postMatchStatus(match.id, 'full time');
        matchState.clearMatchState(match.id);
        assert.strictEqual(matchState.getMatchThreadTail(match.id), null);
    });

    it('threads live events posted by processEvents', async () => {
        await postMatchStatus(match.id, 'kickoff'); // 101
        const count = await processEvents([yellowCard, redCard], match);

        assert.strictEqual(count, 2);
        assert.deepStrictEqual(posted.map((p) => p.inReplyTo), [undefined, '101', '102']);
    });
});
