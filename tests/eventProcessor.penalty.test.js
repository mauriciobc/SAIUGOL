import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { categorizeEvent, processEvents } from '../src/bot/eventProcessor.js';
import { formatPenaltyMissed, formatPenaltyMissedProvisional, formatPenaltyMissedConfirmed, formatGoalProvisional, formatGoalConfirmed } from '../src/bot/formatter.js';
import { initI18n } from '../src/services/i18n.js';
import { whenReady } from '../src/state/matchState.js';

await initI18n('pt-BR');
await whenReady();

const argEgyPenaltyEvent = {
    id: '49731038',
    typeId: '114',
    type: 'pênalti - defendido',
    minute: "21'",
    teamId: '202',
    description: 'Pênalti defendido! Lionel Messi (Argentina) perdeu uma oportunidade única, finalização com o pé esquerdo defendido junto ao lado inferior direito do gol.',
    player: { name: 'Lionel Messi' },
};

const argEgyMatch = {
    id: '760509',
    homeTeam: { id: '202', name: 'Argentina' },
    awayTeam: { id: '2620', name: 'Egito' },
    homeScore: 0,
    awayScore: 1,
    league: { hashtags: ['#CopaDoMundo'] },
};

const argEgyPenaltyEventTemporary = {
    id: '49731038',
    typeId: '114',
    type: 'pênalti - defendido',
    minute: "21'",
    teamId: '202',
    description: "Lionel Messi (Argentina) Tentativa temporária aos 21'",
};

describe('categorizeEvent — penalty missed', () => {
    it('classifies ESPN typeId 114 (PT) as PENALTY_MISSED', () => {
        assert.strictEqual(categorizeEvent('pênalti - defendido', '114'), 'PENALTY_MISSED');
    });

    it('classifies ESPN typeId 114 (EN) as PENALTY_MISSED', () => {
        assert.strictEqual(categorizeEvent('penalty - saved', '114'), 'PENALTY_MISSED');
    });

    it('falls back to PENALTY_MISSED by PT text when typeId is missing', () => {
        assert.strictEqual(categorizeEvent('pênalti - defendido'), 'PENALTY_MISSED');
    });

    it('does not classify penalty saved as GOAL', () => {
        assert.notStrictEqual(categorizeEvent('pênalti - defendido', '114'), 'GOAL');
        assert.notStrictEqual(categorizeEvent('penalty - saved', '114'), 'GOAL');
    });

    it('still classifies penalty scored (typeId 98) as GOAL', () => {
        assert.strictEqual(categorizeEvent('gol de pênalti', '98'), 'GOAL');
    });

    it('classifies provisional penalty (typeId 114 + temporary description) as PENALTY_MISSED', () => {
        assert.strictEqual(
            categorizeEvent(
                argEgyPenaltyEventTemporary.type,
                argEgyPenaltyEventTemporary.typeId,
                argEgyPenaltyEventTemporary.description
            ),
            'PENALTY_MISSED'
        );
    });

    it('classifies provisional goal attempt as GOAL (awaiting VAR)', () => {
        assert.strictEqual(
            categorizeEvent(
                'tentativa temporária',
                undefined,
                'Lionel Messi (Argentina) Tentativa temporária aos 21\''
            ),
            'GOAL'
        );
    });

    it('classifies provisional type text when it includes penalty hint', () => {
        assert.strictEqual(categorizeEvent('pênalti - tentativa temporária'), 'PENALTY_MISSED');
    });
});

describe('formatPenaltyMissed', () => {
    it('formats Argentina x Egypt penalty from snapshot payload', () => {
        const text = formatPenaltyMissed(argEgyPenaltyEvent, argEgyMatch);
        assert.ok(text.includes('❌ Pênalti defendido!'));
        assert.ok(text.includes('Argentina 0 x 1 Egito'));
        assert.ok(text.includes('Lionel Messi'));
        assert.ok(text.includes('Pênalti defendido!'));
    });

    it('extracts player from provisional ESPN temporary description', () => {
        const text = formatPenaltyMissedProvisional(argEgyPenaltyEventTemporary, argEgyMatch);
        assert.ok(text.includes('aguardando confirmação do VAR'));
        assert.ok(text.includes('Lionel Messi'));
        assert.ok(text.includes('Tentativa temporária'));
    });

    it('formats confirmed penalty follow-up', () => {
        const text = formatPenaltyMissedConfirmed(argEgyPenaltyEvent, argEgyMatch);
        assert.ok(text.includes('Pênalti defendido confirmado'));
        assert.ok(text.includes('Lionel Messi'));
    });
});

describe('processEvents — penalty missed', () => {
    let posted = [];
    let origGoals;

    beforeEach(() => {
        origGoals = config.events.goals;
        config.events.goals = true;
        posted = [];
        __setClient({
            postStatus: async (text) => {
                posted.push(text);
                return { data: { id: String(posted.length) } };
            },
        });
    });

    afterEach(() => {
        config.events.goals = origGoals;
        __setClient(null);
    });

    it('posts penalty missed event for match 760509 payload', async () => {
        const count = await processEvents([argEgyPenaltyEvent], argEgyMatch);
        assert.strictEqual(count, 1);
        assert.ok(posted[0].includes('❌ Pênalti defendido!'));
        assert.ok(posted[0].includes('Lionel Messi'));
    });

    it('posts provisional penalty with VAR-pending announcement', async () => {
        const provisionalMatch = { ...argEgyMatch, id: '760509-prov' };
        const count = await processEvents([argEgyPenaltyEventTemporary], provisionalMatch);
        assert.strictEqual(count, 1);
        assert.ok(posted[0].includes('aguardando confirmação do VAR'));
        assert.ok(posted[0].includes('Lionel Messi'));
    });

    it('posts provisional then confirmed penalty as two updates', async () => {
        const match = { ...argEgyMatch, id: '760509-var' };
        const provCount = await processEvents([argEgyPenaltyEventTemporary], match);
        assert.strictEqual(provCount, 1);
        assert.ok(posted[0].includes('aguardando confirmação do VAR'));

        const confCount = await processEvents([argEgyPenaltyEvent], match);
        assert.strictEqual(confCount, 1);
        assert.ok(posted[1].includes('Pênalti defendido confirmado'));
    });

    it('posts provisional then confirmed goal as two updates', async () => {
        const match = {
            id: '760510-var',
            homeTeam: { id: '1', name: 'Brasil' },
            awayTeam: { id: '2', name: 'França' },
            homeScore: 1,
            awayScore: 0,
            league: { hashtags: [] },
        };
        const provisionalGoal = {
            id: 'g1',
            typeId: '70',
            type: 'gol',
            minute: "55'",
            teamId: '1',
            description: 'Neymar (Brasil) Tentativa temporária aos 55\'',
        };
        const confirmedGoal = {
            ...provisionalGoal,
            description: 'Gol! Brasil 1, França 0. Neymar (Brasil) finalização com o pé direito.',
            player: { name: 'Neymar' },
        };

        const provCount = await processEvents([provisionalGoal], match);
        assert.strictEqual(provCount, 1);
        assert.ok(posted[0].includes('aguardando análise do VAR'));

        const confCount = await processEvents([confirmedGoal], match);
        assert.strictEqual(confCount, 1);
        assert.ok(posted[1].includes('GOL VALIDADO'));
    });

    it('matches snapshot event from 20260707.json', () => {
        const snapshot = JSON.parse(readFileSync('data/match-snapshots/20260707.json', 'utf8'));
        const match = snapshot.matches.find((m) => m.id === '760509');
        assert.ok(match, 'snapshot should contain match 760509');
        const event = match.keyEvents.find((e) => e.id === '49731038');
        assert.ok(event, 'snapshot should contain penalty event 49731038');
        assert.strictEqual(categorizeEvent(event.type, event.typeId), 'PENALTY_MISSED');
    });
});
