import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeOfficials } from '../src/api/espn.js';

describe('normalizeOfficials', () => {
    it('normalizes summary gameInfo.officials shape', () => {
        const raw = [
            {
                fullName: 'Paulo Cezar Zanovelli Da Silva',
                displayName: 'Paulo Cezar Zanovelli Da Silva',
                position: { name: 'Referee', displayName: 'Referee', id: '1' },
                order: 1,
            },
        ];
        const result = normalizeOfficials(raw);
        assert.strictEqual(result.length, 1);
        assert.deepStrictEqual(result[0], {
            id: undefined,
            name: 'Paulo Cezar Zanovelli Da Silva',
            positionName: 'Referee',
            positionId: '1',
            order: 1,
        });
    });

    it('normalizes core API items shape with id', () => {
        const raw = [
            {
                id: '5720',
                firstName: 'Paulo Cezar',
                lastName: 'Zanovelli Da Silva',
                fullName: 'Paulo Cezar Zanovelli Da Silva',
                displayName: 'Paulo Cezar Zanovelli Da Silva',
                position: { name: 'Referee', displayName: 'Referee', id: '1' },
                order: 1,
            },
        ];
        const result = normalizeOfficials(raw);
        assert.strictEqual(result[0].id, '5720');
        assert.strictEqual(result[0].name, 'Paulo Cezar Zanovelli Da Silva');
        assert.strictEqual(result[0].positionId, '1');
    });

    it('sorts by order and prefers displayName over fullName', () => {
        const raw = [
            {
                displayName: 'Assistant Two',
                position: { displayName: 'Assistant Referee', id: '3' },
                order: 3,
            },
            {
                fullName: 'Only Full',
                position: { name: 'Referee', id: '1' },
                order: 1,
            },
            {
                displayName: 'Assistant One',
                fullName: 'Should Not Use',
                position: { displayName: 'Assistant Referee', id: '2' },
                order: 2,
            },
        ];
        const result = normalizeOfficials(raw);
        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].name, 'Only Full');
        assert.strictEqual(result[0].order, 1);
        assert.strictEqual(result[1].name, 'Assistant One');
        assert.strictEqual(result[2].name, 'Assistant Two');
    });

    it('returns empty array for null, undefined, non-array, and entries without name', () => {
        assert.deepStrictEqual(normalizeOfficials(null), []);
        assert.deepStrictEqual(normalizeOfficials(undefined), []);
        assert.deepStrictEqual(normalizeOfficials({}), []);
        assert.deepStrictEqual(normalizeOfficials([{ position: { id: '1' } }]), []);
    });

    it('fills missing order from index and stringifies ids', () => {
        const raw = [
            { displayName: 'A', position: { id: 1, name: 'Referee' } },
            { displayName: 'B', position: { id: 2, name: 'Assistant' }, order: 5 },
        ];
        const result = normalizeOfficials(raw);
        assert.strictEqual(result[0].order, 1);
        assert.strictEqual(result[0].positionId, '1');
        assert.strictEqual(result[1].order, 5);
        assert.strictEqual(result[1].positionId, '2');
    });
});
