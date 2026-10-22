import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { __setClient, postStatus, getRecentStatusCount } from '../src/api/mastodon.js';
import { initI18n } from '../src/services/i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Real ESPN PT commentary + key events from Bahia 0 x 3 Flamengo (bra.1, 401841269)
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/commentary-bra1-sample-pt.json'), 'utf8'));

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-commentary-'));
const originalStateDir = process.env.STATE_DIR;

let matchState;
let espn;
let formatCommentary;
let isKeyEventTypeId;
let processCommentaryWithEvents;
let markExistingCommentaryAsSeen;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
    espn = await import('../src/api/espn.js');
    ({ formatCommentary } = await import('../src/bot/formatter.js'));
    ({ isKeyEventTypeId } = await import('../src/bot/eventProcessor.js'));
    ({ processCommentaryWithEvents, markExistingCommentaryAsSeen } = await import('../src/bot/commentaryProcessor.js'));
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

const match = {
    id: fixture.match.id,
    homeTeam: { id: '9967', name: 'Bahia' },
    awayTeam: { id: '819', name: 'Flamengo' },
    homeScore: 0,
    awayScore: 0,
    league: { hashtags: ['#Brasileirão'] },
};

const commentary = () => fixture.commentary.map((raw) => espn.normalizeCommentary(raw));
const keyEvents = () => fixture.keyEvents.map((e) => ({
    id: e.id,
    typeId: e.type.id,
    type: e.type.text.toLowerCase(),
    minute: e.clock.displayValue,
    description: e.text,
}));

describe('normalizeCommentary', () => {
    it('keeps the play link, type, minute and Portuguese text', () => {
        const foul = commentary().find((e) => e.typeId === '66');
        assert.deepStrictEqual(foul, {
            sequence: 3,
            playId: foul.playId,
            typeId: '66',
            minute: "2'",
            text: 'Cristian Olivera (Bahia) sofre uma falta na lateral direita.',
        });
        assert.match(foul.playId, /^\d+$/);
    });

    it('handles entries without a play (stoppage-time announcements)', () => {
        const stoppage = commentary().find((e) => e.sequence === 43);
        assert.strictEqual(stoppage.playId, null);
        assert.strictEqual(stoppage.minute, "45'");
        assert.strictEqual(stoppage.text, 'O quarto árbitro anunciou 3 minutos de acréscimo.');
    });
});

describe('getCommentaryUrl', () => {
    it('asks the web API for Portuguese when the bot posts in Portuguese', () => {
        assert.strictEqual(
            espn.getCommentaryUrl('bra.1', '401841269', { language: 'pt-BR' }),
            'https://site.web.api.espn.com/apis/site/v2/sports/soccer/bra.1/summary?event=401841269&lang=pt&region=br'
        );
    });

    it('uses the default site API otherwise', () => {
        assert.strictEqual(
            espn.getCommentaryUrl('eng.1', '1', { language: 'en' }),
            'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=1'
        );
    });
});

describe('isKeyEventTypeId', () => {
    it('owns goals, cards and subs but not commentary-only plays', () => {
        for (const id of ['70', '98', '94', '76', '81']) assert.strictEqual(isKeyEventTypeId(id), true, id);
        // 106 "Chute no gol" must stay commentary even though categorizeEvent's text fallback calls it a goal
        for (const id of ['106', '117', '135', '66', '95', '68', null]) assert.strictEqual(isKeyEventTypeId(id), false, String(id));
    });
});

describe('formatCommentary', () => {
    it('shows minute and score, without hashtags', () => {
        const text = formatCommentary({ minute: "34'", text: 'Escanteio, Bahia. Cedido por Pedro.' }, { ...match, awayScore: 1 });
        assert.strictEqual(text, "🎙️ 34' · Bahia 0 x 1 Flamengo\n\nEscanteio, Bahia. Cedido por Pedro.");
    });

    it('stays within 500 characters', () => {
        const text = formatCommentary({ minute: "90'+5'", text: 'x'.repeat(800) }, match);
        assert.ok(text.length <= 500, String(text.length));
        assert.ok(text.endsWith('…'));
    });

    it('returns empty for an entry without text', () => {
        assert.strictEqual(formatCommentary({ minute: "1'", text: '' }, match), '');
    });
});

describe('processCommentaryWithEvents', () => {
    let actions;
    let deps;

    beforeEach(() => {
        matchState.resetStateForTesting();
        actions = [];
        deps = {
            post: async (text) => {
                actions.push(`c ${text.split(' ')[1]}`);
                return { id: String(actions.length) };
            },
            processEvents: async (events) => {
                actions.push(`ev ${events.map((e) => e.typeId).join(',')}`);
                return 0;
            },
            canPost: () => true,
        };
    });

    it('posts commentary and key events in ESPN narrative order', async () => {
        const counts = await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);

        assert.deepStrictEqual(actions, [
            "c 2'",          // foul
            'ev 94',         // yellow card, at its place in the narration
            "c 4'",          // corner
            "c 10'",         // shot on target stays commentary
            "c 45'",         // stoppage-time announcement (no play)
            'ev 94,98',      // penalty goal
            'ev 94,98',      // final sweep for key events the commentary has not reached
        ]);
        assert.strictEqual(counts.commentary, 4);
        assert.strictEqual(counts.dropped, 0);
    });

    it('posts a foul ESPN narrates twice as one post naming both players', async () => {
        const texts = [];
        deps.post = async (text) => {
            texts.push(text);
            return { id: String(texts.length) };
        };
        await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        assert.strictEqual(
            texts[0],
            "🎙️ 2' · Bahia 0 x 0 Flamengo\n\nCristian Olivera (Bahia) sofre uma falta na lateral direita. Falta cometida por Emerson Royal (Flamengo)."
        );
    });

    it('does not repeat commentary on the next poll', async () => {
        await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        actions = [];
        await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        assert.deepStrictEqual(actions, ['ev 94,98']);
    });

    it('leaves a key-event type to the keyEvents path until ESPN lists it', async () => {
        await processCommentaryWithEvents(commentary(), [], match, deps);
        assert.ok(!actions.some((a) => a.startsWith("c 3'") || a.startsWith("c 64'")), actions.join(' | '));

        actions = [];
        await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        assert.deepStrictEqual(actions, ['ev 94', 'ev 94,98', 'ev 94,98']);
    });

    it('drops commentary when the day plan has no room for it, but still posts key events', async () => {
        deps.canPost = () => false;
        const counts = await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);

        assert.strictEqual(counts.commentary, 0);
        assert.strictEqual(counts.dropped, 4);
        assert.deepStrictEqual(actions, ['ev 94', 'ev 94,98', 'ev 94,98']);

        // Dropped lines are not posted late once the budget frees up
        deps.canPost = () => true;
        actions = [];
        await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        assert.deepStrictEqual(actions, ['ev 94,98']);
    });

    it('does not dump existing commentary when joining a live match', async () => {
        markExistingCommentaryAsSeen(match.id, commentary());
        const counts = await processCommentaryWithEvents(commentary(), keyEvents(), match, deps);
        assert.strictEqual(counts.commentary, 0);
        assert.deepStrictEqual(actions, ['ev 94,98']);
    });
});

describe('getRecentStatusCount', () => {
    const saved = {};

    beforeEach(() => {
        saved.dryRun = config.bot.dryRun;
        saved.betweenPosts = config.delays.betweenPosts;
        config.bot.dryRun = false;
        config.delays.betweenPosts = 0;
        __setClient({ postStatus: async () => ({ data: { id: '1' } }) });
    });

    afterEach(() => {
        config.bot.dryRun = saved.dryRun;
        config.delays.betweenPosts = saved.betweenPosts;
        __setClient(null);
    });

    it('counts statuses created in the last 3 hours', async () => {
        const before = getRecentStatusCount();
        await postStatus('a');
        await postStatus('b');
        assert.strictEqual(getRecentStatusCount(), before + 2);
        assert.strictEqual(getRecentStatusCount(Date.now() + 3 * 60 * 60 * 1000 + 1), 0);
    });
});
