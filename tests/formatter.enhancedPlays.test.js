import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { initI18n } from '../src/services/i18n.js';
import { formatEnhancedPlay } from '../src/bot/formatter.js';

const match = {
    homeTeam: { name: 'Bahia' },
    awayTeam: { name: 'Chapecoense' },
    homeScore: 1,
    awayScore: 0,
    league: { hashtags: ['#Brasileirao', '#SerieA'] },
};

describe('formatEnhancedPlay', () => {
    before(() => {
        initI18n('pt-BR');
    });

    it('formats shot on target', () => {
        const text = formatEnhancedPlay('SHOT_ON_TARGET', {
            minute: "17'",
            playerName: 'Santiago Ramos Mingo',
            description: 'Attempt saved. Santiago Ramos Mingo (Bahia) left footed shot.',
        }, match);
        assert.ok(text.includes('CHUTE NO GOL'));
        assert.ok(text.includes('Bahia 1 x 0 Chapecoense'));
        assert.ok(text.includes("17'"));
        assert.ok(text.includes('Santiago Ramos Mingo'));
        assert.ok(text.includes('#Bahia'));
        assert.ok(text.length <= 500);
    });

    it('formats shot off target', () => {
        const text = formatEnhancedPlay('SHOT_OFF_TARGET', {
            minute: "3'",
            playerName: 'Román Gómez',
            description: 'Attempt missed.',
        }, match);
        assert.ok(text.includes('CHUTE PARA FORA'));
        assert.ok(text.includes('Román Gómez'));
        assert.ok(text.length <= 500);
    });

    it('formats save', () => {
        const text = formatEnhancedPlay('SAVE', {
            minute: "4'",
            playerName: 'Santiago Ramos',
            description: "Santiago Ramos (Bahia) Save at 4'",
        }, match);
        assert.ok(text.includes('DEFESA'));
        assert.ok(text.includes('Santiago Ramos'));
        assert.ok(text.length <= 500);
    });

    it('truncates long description to stay within 500 chars', () => {
        const text = formatEnhancedPlay('SHOT_ON_TARGET', {
            minute: "45'+2",
            playerName: 'Player With A Very Long Name Indeed',
            description: 'X'.repeat(600),
        }, match);
        assert.ok(text.length <= 500, `length ${text.length}`);
        assert.ok(text.includes('…') || text.includes('...'));
    });

    it('handles missing player and minute', () => {
        const text = formatEnhancedPlay('SAVE', {
            minute: '',
            playerName: null,
            description: '',
        }, match);
        assert.ok(text.includes('DEFESA'));
        assert.ok(text.includes('Jogador desconhecido') || text.includes('👤'));
        assert.ok(text.length <= 500);
    });

    it('returns empty string for unknown category', () => {
        assert.strictEqual(formatEnhancedPlay('UNKNOWN', {}, match), '');
    });
});
