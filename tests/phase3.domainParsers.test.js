import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    parseSubstitutionFromDescription,
    parseScorerFromGoalDescription,
    parsePlayerFromTemporaryDescription,
    parsePlayerFromEventDescription,
    parseDelayReason,
} from '../src/domain/eventTextParsers.js';
import { parseSubstitutionFromDescription as formatterParseSub } from '../src/bot/formatter.js';
import {
    parseScorerFromGoalDescription as espnParseScorer,
    parsePlayerFromTemporaryDescription as espnParseTemp,
    parsePlayerFromEventDescription as espnParsePlayer,
} from '../src/api/espn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('phase3 domain parsers — single source of truth', () => {
    it('exports substitution parser from domain module', () => {
        const result = parseSubstitutionFromDescription(
            'Substituição, entra em campo João Silva substituindo Pedro Álvares.'
        );
        assert.deepStrictEqual(result, { playerIn: 'João Silva', playerOut: 'Pedro Álvares' });
    });

    it('formatter re-exports the same substitution parser identity', () => {
        assert.strictEqual(formatterParseSub, parseSubstitutionFromDescription);
    });

    it('does not treat bare "Assist for X" as a substitution (no false positive)', () => {
        assert.strictEqual(
            parseSubstitutionFromDescription('Assist for Lionel Messi.'),
            null
        );
    });

    it('stops player-out capture before lowercase injury reason clause', () => {
        const result = parseSubstitutionFromDescription(
            'Substitution, entra em campo Max Aarons substituindo Jordan Bos uma lesão.'
        );
        assert.deepStrictEqual(result, { playerIn: 'Max Aarons', playerOut: 'Jordan Bos' });
    });

    it('parses English "comes on for" with Unicode names', () => {
        assert.deepStrictEqual(
            parseSubstitutionFromDescription('Matheus Çantos comes on for Éder Gomes.'),
            { playerIn: 'Matheus Çantos', playerOut: 'Éder Gomes' }
        );
    });

    it('espn.js must not define a private parseSubstitutionFromText duplicate', () => {
        const src = readFileSync(join(root, 'src/api/espn.js'), 'utf8');
        assert.ok(
            !/function\s+parseSubstitutionFromText\s*\(/.test(src),
            'espn.js still has a private parseSubstitutionFromText — use domain module'
        );
        assert.ok(
            src.includes('eventTextParsers') || src.includes('parseSubstitutionFromDescription'),
            'espn.js should import the shared substitution parser'
        );
    });

    it('goal/temporary/delay parsers live in domain and are re-exported by espn/formatter consumers', () => {
        assert.strictEqual(espnParseScorer, parseScorerFromGoalDescription);
        assert.strictEqual(espnParseTemp, parsePlayerFromTemporaryDescription);
        assert.strictEqual(espnParsePlayer, parsePlayerFromEventDescription);
        assert.strictEqual(
            parseScorerFromGoalDescription("Goal! A 1, B 0. Breno Lopes (Palmeiras) left footed shot."),
            'Breno Lopes'
        );
        assert.strictEqual(
            parsePlayerFromTemporaryDescription("Lionel Messi (Argentina) Tentativa temporária aos 21'"),
            'Lionel Messi'
        );
        assert.strictEqual(parseDelayReason('Drinks break'), 'hydration');
        assert.strictEqual(parseDelayReason('Pausa por lesão'), 'injury');
        assert.strictEqual(parseDelayReason('something else'), 'generic');
    });
});
