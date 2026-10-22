import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { formatGoal, formatPenaltyMissed } from '../src/bot/formatter.js';
import { initI18n } from '../src/services/i18n.js';

before(async () => {
    await initI18n('pt-BR');
});

// Real Bahia 0 x 3 Flamengo (bra.1, 401841269) shape: live events carry only teamId, never a team object.
const match = {
    id: '401841269',
    homeTeam: { id: '9967', name: 'Bahia' },
    awayTeam: { id: '819', name: 'Flamengo' },
    homeScore: 0,
    awayScore: 1,
    league: { hashtags: ['#Brasileirão'] },
};

const hashtagLine = (text) => text.trim().split('\n').at(-1);

describe('team hashtag on goal and penalty posts', () => {
    it('tags the away team when the away team scores', () => {
        const text = formatGoal({ type: 'penalty - scored', teamId: '819', minute: "64'", player: { name: 'Jorginho' } }, match);
        assert.strictEqual(hashtagLine(text), '#Flamengo #Brasileirão');
    });

    it('tags the home team when the home team scores', () => {
        const text = formatGoal({ type: 'goal', teamId: '9967', minute: "10'", player: { name: 'Erick Pulga' } }, match);
        assert.strictEqual(hashtagLine(text), '#Bahia #Brasileirão');
    });

    it('tags the team that missed the penalty', () => {
        const text = formatPenaltyMissed({ type: 'penalty - missed', teamId: '819', minute: "30'", player: { name: 'Pedro' } }, match);
        assert.strictEqual(hashtagLine(text), '#Flamengo #Brasileirão');
    });

    it('falls back to the home team when ESPN gives no team', () => {
        const text = formatGoal({ type: 'goal', minute: "10'", player: { name: 'X' } }, match);
        assert.strictEqual(hashtagLine(text), '#Bahia #Brasileirão');
    });
});
