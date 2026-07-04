import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSubstitutionFromDescription } from '../src/bot/formatter.js';

describe('parseSubstitutionFromDescription - Unicode Fix', () => {
    it('should handle Portuguese names with accents and special characters', () => {
        const testCases = [
            {
                description: 'Substituição, entra em campo João Silva substituindo Pedro Álvares.',
                expected: { playerIn: 'João Silva', playerOut: 'Pedro Álvares' }
            },
            {
                description: 'Sérgio Oliveira replaces Luiz Fernando.',
                expected: { playerIn: 'Sérgio Oliveira', playerOut: 'Luiz Fernando' }
            },
            {
                description: 'André Santos on for Rúben Dias.',
                expected: { playerIn: 'André Santos', playerOut: 'Rúben Dias' }
            },
            {
                description: 'Vitorino Sá sostituisce Ângelo Mendes.',
                expected: { playerIn: 'Vitorino Sá', playerOut: 'Ângelo Mendes' }
            },
            {
                description: 'Francisco Ñeto in per Ícaro Strada.',
                expected: { playerIn: 'Francisco Ñeto', playerOut: 'Ícaro Strada' }
            },
            {
                description: 'Matheus Çantos comes on for Éder Gomes.',
                expected: { playerIn: 'Matheus Çantos', playerOut: 'Éder Gomes' }
            }
        ];

        for (const testCase of testCases) {
            const result = parseSubstitutionFromDescription(testCase.description);
            assert.deepStrictEqual(result, testCase.expected, 
                `Failed to parse: ${testCase.description}`);
        }
    });

    it('should handle names with multiple accents and special characters', () => {
        const description = 'Francisco Ñeto de Ávila replaces Sérgio Luís André.';
        const result = parseSubstitutionFromDescription(description);
        
        assert.deepStrictEqual(result, {
            playerIn: 'Francisco Ñeto de Ávila',
            playerOut: 'Sérgio Luís André'
        });
    });

    it('should handle hyphenated names with accents', () => {
        const description = 'João-Pedro Álvares-Santos on for Luís-Fernando Gómes-Mendes.';
        const result = parseSubstitutionFromDescription(description);
        
        assert.deepStrictEqual(result, {
            playerIn: 'João-Pedro Álvares-Santos',
            playerOut: 'Luís-Fernando Gómes-Mendes'
        });
    });

    it('should return null for invalid input', () => {
        assert.strictEqual(parseSubstitutionFromDescription(''), null);
        assert.strictEqual(parseSubstitutionFromDescription(null), null);
        assert.strictEqual(parseSubstitutionFromDescription(undefined), null);
        assert.strictEqual(parseSubstitutionFromDescription(123), null);
    });

    it('should return null when pattern does not match', () => {
        const result = parseSubstitutionFromDescription('No substitution here.');
        assert.strictEqual(result, null);
    });
});
