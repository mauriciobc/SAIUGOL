import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { parseCommand, processMentions } from '../src/bot/mentionListener.js';
import { initI18n } from '../src/services/i18n.js';
import { whenReady } from '../src/state/matchState.js';

await initI18n('pt-BR');
await whenReady();

const LEAGUE_MATCHES = [{
    league: { name: 'Brasileirão', hashtags: ['#Brasileirao'] },
    matches: [
        { homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Palmeiras' }, startTime: null },
    ],
}];

const BOT_ID = 'bot-account-42';

function makeMention(id, accountId, content, isBot = false) {
    return {
        id,
        type: 'mention',
        account: { id: accountId, acct: `user${accountId}@social.example`, bot: isBot },
        status: { id: `status-${id}`, content },
    };
}

describe('parseCommand', () => {
    it('recognises "jogos" keyword', () => {
        assert.strictEqual(parseCommand('<p>@bot jogos</p>'), 'jogos');
    });

    it('recognises "hoje" keyword', () => {
        assert.strictEqual(parseCommand('<p>@bot hoje?</p>'), 'hoje');
    });

    it('recognises "agenda" keyword', () => {
        assert.strictEqual(parseCommand('<p>@bot agenda por favor</p>'), 'agenda');
    });

    it('returns null for unrecognised content', () => {
        assert.strictEqual(parseCommand('<p>@bot olá!</p>'), null);
    });

    it('strips HTML before matching', () => {
        assert.strictEqual(parseCommand('<p><span>@bot</span> jogos de hoje</p>'), 'jogos');
    });
});

describe('processMentions', () => {
    let postedReplies = [];
    let origCooldown;

    beforeEach(() => {
        origCooldown = config.mentions.cooldownMs;
        config.mentions.cooldownMs = 300000;
        postedReplies = [];

        __setClient({
            postStatus: async (text, opts) => {
                postedReplies.push({ text, opts });
                return { data: { id: String(postedReplies.length) } };
            },
        });
    });

    afterEach(() => {
        config.mentions.cooldownMs = origCooldown;
        __setClient(null);
    });

    it('replies to "jogos" mention with daily digest', async () => {
        const mentions = [makeMention('notif-1', 'user-1', '<p>@bot jogos</p>')];
        const highestId = await processMentions(mentions, BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(highestId, 'notif-1');
        assert.strictEqual(postedReplies.length, 1);
        assert.ok(postedReplies[0].text.includes('JOGOS DE HOJE'));
        assert.strictEqual(postedReplies[0].opts.in_reply_to_id, 'status-notif-1');
    });

    it('skips mentions from the bot itself', async () => {
        const mentions = [makeMention('notif-2', BOT_ID, '<p>jogos</p>')];
        await processMentions(mentions, BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(postedReplies.length, 0);
    });

    it('skips mentions from bot accounts', async () => {
        const mentions = [makeMention('notif-3', 'another-bot', '<p>jogos</p>', true)];
        await processMentions(mentions, BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(postedReplies.length, 0);
    });

    it('skips unrecognised commands', async () => {
        const mentions = [makeMention('notif-4', 'user-2', '<p>@bot olá!</p>')];
        await processMentions(mentions, BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(postedReplies.length, 0);
    });

    it('enforces per-account cooldown', async () => {
        config.mentions.cooldownMs = 999999;
        const m1 = makeMention('notif-5', 'user-3', '<p>@bot jogos</p>');
        const m2 = makeMention('notif-6', 'user-3', '<p>@bot hoje</p>');
        // Process first mention, then second from same account
        await processMentions([m1], BOT_ID, LEAGUE_MATCHES);
        await processMentions([m2], BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(postedReplies.length, 1, 'second mention within cooldown should be skipped');
    });

    it('returns null for empty mention list', async () => {
        const highestId = await processMentions([], BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(highestId, null);
    });

    it('returns the highest notification id seen', async () => {
        const mentions = [
            makeMention('notif-10', 'user-4', '<p>@bot jogos</p>'),
            makeMention('notif-20', 'user-5', '<p>@bot hoje</p>'),
        ];
        const highestId = await processMentions(mentions, BOT_ID, LEAGUE_MATCHES);
        assert.strictEqual(highestId, 'notif-20');
    });
});

describe('persistence: lastNotificationId', () => {
    it('getLastNotificationId and setLastNotificationId round-trip', async () => {
        const { getLastNotificationId, setLastNotificationId } = await import('../src/state/matchState.js');
        const original = getLastNotificationId();
        setLastNotificationId('test-notif-999');
        assert.strictEqual(getLastNotificationId(), 'test-notif-999');
        setLastNotificationId(original); // restore
    });
});
