import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __setClient, __setUploadFn } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { processEvents } from '../src/bot/eventProcessor.js';
import { initI18n } from '../src/services/i18n.js';
import { isPlaceholderEventText } from '../src/utils/eventKeywords.js';

// Isolate this file's persisted state from the default STATE_DIR ("/app/data"), matching
// persistence.test.js / matchState.init.test.js — avoids interfering with other state and
// permission issues writing to the default dir.
const testDir = mkdtempSync(join(tmpdir(), 'saiugol-goalconfirmation-'));
const originalStateDir = process.env.STATE_DIR;

let getPendingGoal;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    // Dynamic import + resetStateForTesting so matchState re-initializes against testDir
    // instead of whatever STATE_DIR was in effect when it was first (statically) imported.
    const matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    getPendingGoal = matchState.getPendingGoal;
    await matchState.whenReady();
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

const makeMatch = (matchId) => ({
    id: matchId,
    homeTeam: { id: '10', name: 'Inglaterra' },
    awayTeam: { id: '11', name: 'México' },
    homeScore: 1,
    awayScore: 0,
    league: { hashtags: ['#CopaDoMundo'] },
});

describe('isPlaceholderEventText', () => {
    it('flags ESPN short-form templates ending in "at/aos <minute>\'"', () => {
        assert.strictEqual(isPlaceholderEventText("Jude Bellingham (England) Gol temporário aos 36'"), true);
        assert.strictEqual(isPlaceholderEventText("Félix Torres (Internacional) Substitution at 51'"), true);
        assert.strictEqual(isPlaceholderEventText("Player (Team) Goal at 45+2'"), true);
    });

    it('flags the same templates with a curly apostrophe in the minute marker', () => {
        assert.strictEqual(isPlaceholderEventText('Player (Team) Goal at 36’'), true);
        assert.strictEqual(isPlaceholderEventText('Player (Team) Goal at 45+2’'), true);
    });

    it('does not flag full narrative descriptions', () => {
        assert.strictEqual(
            isPlaceholderEventText('Gol! México 0, Inglaterra 1. Jude Bellingham (Inglaterra) de cabeça de muito perto no canto inferior esquerdo.'),
            false
        );
        assert.strictEqual(
            isPlaceholderEventText('Gol contra marcado por Mohamed Hany, Egito. Austrália 1, Egito 1..'),
            false
        );
    });

    it('does not flag missing/empty text', () => {
        assert.strictEqual(isPlaceholderEventText(undefined), false);
        assert.strictEqual(isPlaceholderEventText(''), false);
    });
});

describe('Goal confirmation lifecycle', () => {
    let postedWith = [];
    let nextId = 0;
    let origTimeout;
    let origBetweenPosts;

    beforeEach(() => {
        postedWith = [];
        origTimeout = config.delays.goalConfirmationTimeoutMs;
        origBetweenPosts = config.delays.betweenPosts;
        config.delays.betweenPosts = 0;
        __setUploadFn(() => Promise.resolve(null));
        __setClient({
            postStatus: async (text, opts) => {
                nextId += 1;
                postedWith.push({ text, opts, id: String(nextId) });
                return { data: { id: String(nextId) } };
            },
        });
    });

    afterEach(() => {
        config.delays.goalConfirmationTimeoutMs = origTimeout;
        config.delays.betweenPosts = origBetweenPosts;
        __setUploadFn(null);
        __setClient(null);
    });

    it('posts "aguardando confirmação" for a placeholder goal, then the real GOOOOL as a reply once ESPN fills in the text', async () => {
        const match = makeMatch('confirm-m-1');
        const eventId = 'confirm-ev-1';
        const placeholderEvent = {
            id: eventId,
            type: 'Goal - Header',
            typeId: '137',
            minute: '36',
            teamId: '10',
            team: { id: '10', name: 'Inglaterra' },
            player: { name: 'Jude Bellingham' },
            description: "Jude Bellingham (Inglaterra) Gol temporário aos 36'",
        };

        const firstCount = await processEvents([placeholderEvent], match);
        assert.strictEqual(firstCount, 1, 'should post exactly the pending notice');
        assert.strictEqual(postedWith.length, 1);
        assert.ok(postedWith[0].text.includes('⏳'), 'pending post should use the awaiting-confirmation banner');
        assert.ok(postedWith[0].text.includes('Jude Bellingham'));
        assert.ok(!postedWith[0].text.includes('⚽ GOOOOL'), 'must not announce a confirmed goal yet');
        assert.ok(!postedWith[0].opts?.in_reply_to_id, 'first pending post is not a reply');

        const pending = getPendingGoal(`${match.id}-${eventId}`);
        assert.ok(pending, 'goal should be tracked as pending');
        assert.strictEqual(pending.statusId, postedWith[0].id);

        // Same poll again with text still placeholder-shaped must not repost.
        const repollCount = await processEvents([placeholderEvent], match);
        assert.strictEqual(repollCount, 0, 'should not repost the pending notice while still unconfirmed');
        assert.strictEqual(postedWith.length, 1);

        // ESPN fills in the real narrative under the same event id.
        const confirmedEvent = {
            ...placeholderEvent,
            description: 'Gol! México 0, Inglaterra 1. Jude Bellingham (Inglaterra) de cabeça de muito perto no canto inferior esquerdo. Assistência de Bukayo Saka com um cruzamento.',
        };
        const confirmCount = await processEvents([confirmedEvent], match);
        assert.strictEqual(confirmCount, 1, 'should post the confirmation');
        assert.strictEqual(postedWith.length, 2);
        assert.ok(postedWith[1].text.includes('⚽ GOOOOL'), 'confirmation should be the real goal announcement');
        assert.strictEqual(postedWith[1].opts?.in_reply_to_id, postedWith[0].id, 'confirmation should reply to the pending post');
        assert.strictEqual(getPendingGoal(`${match.id}-${eventId}`), null, 'pending state should be cleared once resolved');

        // A third poll for the same (now fully posted) event must be a no-op.
        const finalCount = await processEvents([confirmedEvent], match);
        assert.strictEqual(finalCount, 0);
        assert.strictEqual(postedWith.length, 2);
    });

    it('posts a retraction as a reply when a pending goal is later marked disallowed', async () => {
        const match = makeMatch('confirm-m-2');
        const eventId = 'confirm-ev-2';
        const placeholderEvent = {
            id: eventId,
            type: 'Goal',
            typeId: '70',
            minute: '52',
            teamId: '10',
            team: { id: '10', name: 'Inglaterra' },
            player: { name: 'Harry Kane' },
            description: "Harry Kane (Inglaterra) Gol temporário aos 52'",
        };

        await processEvents([placeholderEvent], match);
        assert.strictEqual(postedWith.length, 1);

        const disallowedEvent = { ...placeholderEvent, type: 'Goal - Disallowed', description: undefined };
        const count = await processEvents([disallowedEvent], match);

        assert.strictEqual(count, 1);
        assert.strictEqual(postedWith.length, 2);
        assert.ok(postedWith[1].text.includes('🚫'), 'should post the disallowed-goal retraction');
        assert.strictEqual(postedWith[1].opts?.in_reply_to_id, postedWith[0].id);
        assert.strictEqual(getPendingGoal(`${match.id}-${eventId}`), null);
    });

    it('keeps a goal pending for retry when the confirmation postStatus fails (e.g. Mastodon outage)', async () => {
        const match = makeMatch('confirm-m-5');
        const eventId = 'confirm-ev-5';
        const placeholderEvent = {
            id: eventId,
            type: 'Goal',
            typeId: '70',
            minute: '64',
            teamId: '10',
            team: { id: '10', name: 'Inglaterra' },
            player: { name: 'Phil Foden' },
            description: "Phil Foden (Inglaterra) Gol temporário aos 64'",
        };

        await processEvents([placeholderEvent], match);
        assert.strictEqual(postedWith.length, 1, 'pending notice should have posted');
        const pendingKey = `${match.id}-${eventId}`;
        const pendingBefore = getPendingGoal(pendingKey);
        assert.ok(pendingBefore, 'goal should still be pending');

        // Simulate a transient Mastodon outage: the confirmation reply fails (postStatus -> null,
        // as postStatus itself returns after exhausting retries).
        __setClient({ postStatus: async () => null });
        const confirmedEvent = {
            ...placeholderEvent,
            description: 'Gol! Inglaterra 1, México 0. Phil Foden (Inglaterra) finalização com o pé direito.',
        };
        const failedCount = await processEvents([confirmedEvent], match);

        assert.strictEqual(failedCount, 0, 'a failed post must not count as posted');
        assert.strictEqual(postedWith.length, 1, 'no new toot should be recorded on failure');
        const pendingAfterFailure = getPendingGoal(pendingKey);
        assert.ok(pendingAfterFailure, 'goal must remain pending so it is retried on the next poll, not lost');
        assert.strictEqual(pendingAfterFailure.statusId, pendingBefore.statusId);

        // Mastodon recovers on the next poll — same (still unresolved) event should now succeed.
        __setClient({
            postStatus: async (text, opts) => {
                nextId += 1;
                postedWith.push({ text, opts, id: String(nextId) });
                return { data: { id: String(nextId) } };
            },
        });
        const retryCount = await processEvents([confirmedEvent], match);

        assert.strictEqual(retryCount, 1, 'retry should succeed once Mastodon is back');
        assert.strictEqual(postedWith.length, 2);
        assert.ok(postedWith[1].text.includes('⚽ GOOOOL'));
        assert.strictEqual(getPendingGoal(pendingKey), null);
    });

    it('force-posts the goal after the confirmation timeout even if ESPN never fills in the text', async () => {
        const match = makeMatch('confirm-m-3');
        const eventId = 'confirm-ev-3';
        const placeholderEvent = {
            id: eventId,
            type: 'Goal',
            typeId: '70',
            minute: '80',
            teamId: '10',
            team: { id: '10', name: 'Inglaterra' },
            player: { name: 'Bukayo Saka' },
            description: "Bukayo Saka (Inglaterra) Gol temporário aos 80'",
        };

        await processEvents([placeholderEvent], match);
        assert.strictEqual(postedWith.length, 1);

        config.delays.goalConfirmationTimeoutMs = 0;
        const count = await processEvents([placeholderEvent], match);

        assert.strictEqual(count, 1, 'should force-post once the timeout has elapsed');
        assert.strictEqual(postedWith.length, 2);
        assert.ok(postedWith[1].text.includes('⚽ GOOOOL'));
        assert.strictEqual(postedWith[1].opts?.in_reply_to_id, postedWith[0].id);
        assert.strictEqual(getPendingGoal(`${match.id}-${eventId}`), null);
    });

    it('does not divert an already-confirmed goal (no description at all) through the pending flow', async () => {
        const match = makeMatch('confirm-m-4');
        const event = {
            id: 'confirm-ev-4',
            type: 'Goal',
            typeId: '70',
            minute: '23',
            teamId: '10',
            team: { id: '10', name: 'Inglaterra' },
            player: { name: 'Jogador Teste' },
        };

        const count = await processEvents([event], match);
        assert.strictEqual(count, 1);
        assert.strictEqual(postedWith.length, 1);
        assert.ok(postedWith[0].text.includes('⚽ GOOOOL'), 'should post the final goal directly, not a pending notice');
    });
});
