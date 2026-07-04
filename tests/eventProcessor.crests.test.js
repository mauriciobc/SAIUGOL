import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { __setClient, __setUploadFn } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { processEvents } from '../src/bot/eventProcessor.js';
import { initI18n } from '../src/services/i18n.js';
import { whenReady } from '../src/state/matchState.js';

await initI18n('pt-BR');
await whenReady();

const makGoalEvent = (id) => ({
    id,
    type: 'Goal',
    typeId: '70',
    minute: '23',
    teamId: '10',
    player: { name: 'Jogador Teste' },
    team: { id: '10', name: 'Flamengo' },
});

const makeMatch = (matchId, withLogo = true) => ({
    id: matchId,
    homeTeam: {
        id: '10',
        name: 'Flamengo',
        logo: withLogo ? 'https://a.espncdn.com/i/teamlogos/soccer/500/119.png' : undefined,
    },
    awayTeam: {
        id: '11',
        name: 'Palmeiras',
        logo: withLogo ? 'https://a.espncdn.com/i/teamlogos/soccer/500/1963.png' : undefined,
    },
    homeScore: 1,
    awayScore: 0,
    league: { hashtags: ['#Brasileirao'] },
});

describe('Goal crest attachment', () => {
    let postedWith = [];
    let uploadedUrls = [];
    let origAttachCrests;

    beforeEach(() => {
        origAttachCrests = config.media.attachCrests;
        config.media.attachCrests = true;
        postedWith = [];
        uploadedUrls = [];

        __setUploadFn((url, opts) => {
            uploadedUrls.push({ url, opts });
            return Promise.resolve('fake-media-id-123');
        });

        __setClient({
            postStatus: async (text, opts) => {
                postedWith.push({ text, opts });
                return { data: { id: String(postedWith.length) } };
            },
        });
    });

    afterEach(() => {
        config.media.attachCrests = origAttachCrests;
        __setUploadFn(null);
        __setClient(null);
    });

    it('uploads scoring team crest and attaches mediaId to goal post', async () => {
        const match = makeMatch('crest-m-1', true);
        const count = await processEvents([makGoalEvent('crest-ev-1')], match);

        assert.strictEqual(count, 1, 'should post exactly one event');
        assert.strictEqual(uploadedUrls.length, 1, 'should upload exactly one image');
        assert.ok(uploadedUrls[0].url.includes('espncdn.com'), 'uploaded URL should be the ESPN crest URL');
        assert.strictEqual(uploadedUrls[0].opts.type, 'image');

        assert.strictEqual(postedWith.length, 1, 'postStatus should be called once');
        assert.deepStrictEqual(postedWith[0].opts.media_ids, ['fake-media-id-123'], 'goal post should carry crest mediaId');
    });

    it('posts goal without crest when ATTACH_CRESTS is disabled', async () => {
        config.media.attachCrests = false;
        const match = makeMatch('crest-m-2', true);
        const count = await processEvents([makGoalEvent('crest-ev-2')], match);

        assert.strictEqual(count, 1);
        assert.strictEqual(uploadedUrls.length, 0, 'no upload when attachCrests is false');
        assert.strictEqual(postedWith.length, 1);
        assert.ok(!postedWith[0].opts?.media_ids?.length, 'no mediaIds when attachCrests disabled');
    });

    it('posts goal without attachment when team logo is absent', async () => {
        const match = makeMatch('crest-m-3', false);
        const count = await processEvents([makGoalEvent('crest-ev-3')], match);

        assert.strictEqual(count, 1);
        assert.strictEqual(uploadedUrls.length, 0, 'no upload when logo is absent');
        assert.ok(!postedWith[0].opts?.media_ids?.length, 'no mediaIds when logo absent');
    });

    it('posts goal as text-only when upload returns null (upload failure fallback)', async () => {
        __setUploadFn(() => Promise.resolve(null));
        const match = makeMatch('crest-m-4', true);
        const count = await processEvents([makGoalEvent('crest-ev-4')], match);

        assert.strictEqual(count, 1, 'event should still be posted even if upload fails');
        assert.ok(!postedWith[0].opts?.media_ids?.length, 'no mediaIds when upload failed');
    });
});
