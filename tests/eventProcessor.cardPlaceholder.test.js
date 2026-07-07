import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { processEvents } from '../src/bot/eventProcessor.js';
import { initI18n } from '../src/services/i18n.js';
import { isPlaceholderEventText } from '../src/utils/eventKeywords.js';

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-cardplaceholder-'));
const originalStateDir = process.env.STATE_DIR;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    const matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

const mockMatch = {
    id: '999001',
    homeTeam: { id: '1', name: 'Santos' },
    awayTeam: { id: '2', name: 'Palmeiras' },
    homeScore: 1,
    awayScore: 0,
    league: { hashtags: ['#Brasileirao'] },
};

const yellowCardTemporary = {
    id: 'yc-temp-1',
    typeId: '94',
    type: 'cartão amarelo',
    minute: "45'",
    teamId: '1',
    description: "Neymar (Santos) Cartão amarelo temporário aos 45'",
    player: { name: 'Neymar' },
};

const yellowCardConfirmed = {
    id: 'yc-temp-1',
    typeId: '94',
    type: 'cartão amarelo',
    minute: "45'",
    teamId: '1',
    description: 'Neymar (Santos) recebe cartão amarelo por falta dura.',
    player: { name: 'Neymar' },
};

describe('isPlaceholderEventText — yellow card', () => {
    it('flags ESPN provisional yellow card description with "temporário"', () => {
        assert.strictEqual(
            isPlaceholderEventText("Neymar (Santos) Cartão amarelo temporário aos 45'"),
            true
        );
    });

    it('flags ESPN provisional yellow card description in English', () => {
        assert.strictEqual(
            isPlaceholderEventText("Neymar (Santos) Yellow card at 45'"),
            true
        );
    });

    it('does not flag full narrative yellow card description', () => {
        assert.strictEqual(
            isPlaceholderEventText('Neymar (Santos) recebe cartão amarelo por falta dura.'),
            false
        );
    });
});

describe('processEvents — yellow card placeholder', () => {
    let postedWith = [];
    let origBetweenPosts;
    let origYellowCards;

    beforeEach(() => {
        postedWith = [];
        origBetweenPosts = config.delays.betweenPosts;
        origYellowCards = config.events.yellowCards;
        config.delays.betweenPosts = 0;
        config.events.yellowCards = true;
        __setClient({
            postStatus: async (text) => {
                postedWith.push(text);
                return { data: { id: String(postedWith.length) } };
            },
        });
    });

    afterEach(() => {
        config.delays.betweenPosts = origBetweenPosts;
        config.events.yellowCards = origYellowCards;
    });

    it('does not post yellow card while ESPN description is still provisional', async () => {
        const count = await processEvents([yellowCardTemporary], mockMatch);
        assert.strictEqual(count, 0);
        assert.strictEqual(postedWith.length, 0);
    });

    it('posts yellow card once ESPN replaces provisional description', async () => {
        await processEvents([yellowCardTemporary], mockMatch);
        assert.strictEqual(postedWith.length, 0);

        const count = await processEvents([yellowCardConfirmed], mockMatch);
        assert.strictEqual(count, 1);
        assert.strictEqual(postedWith.length, 1);
        assert.ok(postedWith[0].includes('🟨 CARTÃO AMARELO!'));
        assert.ok(postedWith[0].includes('Neymar'));
        assert.ok(!postedWith[0].toLowerCase().includes('temporário'));
    });
});
