import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { initI18n } from '../src/services/i18n.js';
import { formatMatchOfficials } from '../src/bot/formatter.js';

const baseMatch = {
    homeTeam: { name: 'Atlético-MG' },
    awayTeam: { name: 'Bahia' },
    venue: 'Arena MRV',
    league: { hashtags: ['#Brasileirao', '#SerieA'] },
};

describe('formatMatchOfficials', () => {
    before(() => {
        initI18n('pt-BR');
    });

    it('formats a single referee post', () => {
        const text = formatMatchOfficials(baseMatch, [
            { name: 'Paulo Cezar Zanovelli Da Silva', positionName: 'Referee', positionId: '1', order: 1 },
        ]);
        assert.ok(text.includes('ARBITRAGEM'));
        assert.ok(text.includes('Atlético-MG x Bahia'));
        assert.ok(text.includes('Arena MRV'));
        assert.ok(text.includes('Árbitro: Paulo Cezar Zanovelli Da Silva'));
        assert.ok(text.includes('#AtleticoMG'));
        assert.ok(text.includes('#Bahia'));
        assert.ok(text.includes('#Brasileirao'));
        assert.ok(text.length <= 500);
    });

    it('labels multiple officials with assistant numbering', () => {
        const text = formatMatchOfficials(baseMatch, [
            { name: 'Main Ref', positionName: 'Referee', positionId: '1', order: 1 },
            { name: 'AR One', positionName: 'Assistant Referee', positionId: '2', order: 2 },
            { name: 'AR Two', positionName: 'Assistant Referee', positionId: '3', order: 3 },
            { name: 'Fourth', positionName: 'Fourth Official', positionId: '4', order: 4 },
            { name: 'Var Ref', positionName: 'VAR', positionId: '5', order: 5 },
        ]);
        assert.ok(text.includes('Árbitro: Main Ref'));
        assert.ok(text.includes('Assistente 1: AR One'));
        assert.ok(text.includes('Assistente 2: AR Two'));
        assert.ok(text.includes('Quarto árbitro: Fourth'));
        assert.ok(text.includes('VAR: Var Ref'));
        assert.ok(text.length <= 500);
    });

    it('omits venue line when missing', () => {
        const match = { ...baseMatch, venue: undefined };
        const text = formatMatchOfficials(match, [
            { name: 'Ref Name', positionName: 'Referee', positionId: '1', order: 1 },
        ]);
        assert.ok(!text.includes('📍'));
        assert.ok(text.includes('Ref Name'));
    });

    it('stays within 500 characters by dropping lower-order officials', () => {
        const longName = 'X'.repeat(80);
        const officials = Array.from({ length: 12 }, (_, i) => ({
            name: `${longName} Official ${i + 1}`,
            positionName: i === 0 ? 'Referee' : 'Assistant Referee',
            positionId: String(i + 1),
            order: i + 1,
        }));
        const text = formatMatchOfficials(baseMatch, officials);
        assert.ok(text.length <= 500, `length ${text.length}`);
        assert.ok(text.includes(`Official 1`));
    });

    it('returns empty string when officials list is empty', () => {
        assert.strictEqual(formatMatchOfficials(baseMatch, []), '');
        assert.strictEqual(formatMatchOfficials(baseMatch, null), '');
    });
});
