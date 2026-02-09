import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeDiff } from '../src/state/diffEngine.js';

const leagueCode = 'bra.1';

function snapshot(id, score, status, gameTime = "0'") {
    return { id, score: { home: score.home, away: score.away }, status, gameTime };
}

describe('diffEngine', () => {
    describe('computeDiff', () => {
        it('deve retornar match_start quando status muda de pre para in', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 0, away: 0 }, 'in', "1'")]]);
            const getPrevious = (key) => {
                if (key === 'bra.1:m1') return snapshot('m1', { home: 0, away: 0 }, 'pre', '-');
                return undefined;
            };

            const { actions, snapshotEntries } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].type, 'match_start');
            assert.strictEqual(actions[0].leagueCode, leagueCode);
            assert.strictEqual(actions[0].snapshot.status, 'in');
            assert.strictEqual(snapshotEntries.length, 1);
            assert.strictEqual(snapshotEntries[0][0], 'bra.1:m1');
        });

        it('deve retornar match_end quando status muda de in para post', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 2, away: 1 }, 'post', 'FT')]]);
            const getPrevious = (key) => {
                if (key === 'bra.1:m1') return snapshot('m1', { home: 2, away: 1 }, 'in', "90'");
                return undefined;
            };

            const { actions } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].type, 'match_end');
            assert.strictEqual(actions[0].snapshot.status, 'post');
        });

        it('deve retornar score_changed quando placar muda com status in', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 1, away: 0 }, 'in', "45'")]]);
            const getPrevious = (key) => {
                if (key === 'bra.1:m1') return snapshot('m1', { home: 0, away: 0 }, 'in', "44'");
                return undefined;
            };

            const { actions } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].type, 'score_changed');
            assert.deepStrictEqual(actions[0].snapshot.score, { home: 1, away: 0 });
        });

        it('não deve emitir ação quando placar e status permanecem iguais', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 0, away: 0 }, 'in', "10'")]]);
            const getPrevious = (key) => {
                if (key === 'bra.1:m1') return snapshot('m1', { home: 0, away: 0 }, 'in', "9'");
                return undefined;
            };

            const { actions } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 0);
        });

        it('não deve emitir score_changed para partida pre ou post', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 1, away: 0 }, 'pre', '-')]]);
            const getPrevious = (key) => {
                if (key === 'bra.1:m1') return snapshot('m1', { home: 0, away: 0 }, 'pre', '-');
                return undefined;
            };

            const { actions } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 0);
        });

        it('deve incluir todas as partidas em snapshotEntries', () => {
            const newMap = new Map([
                ['m1', snapshot('m1', { home: 0, away: 0 }, 'pre', '-')],
                ['m2', snapshot('m2', { home: 0, away: 0 }, 'in', "5'")],
            ]);
            const getPrevious = () => undefined;

            const { snapshotEntries } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(snapshotEntries.length, 2);
            const keys = snapshotEntries.map(([k]) => k).sort();
            assert.deepStrictEqual(keys, ['bra.1:m1', 'bra.1:m2']);
        });

        it('emite score_changed para partida nova já in (sem previous)', () => {
            const newMap = new Map([['m1', snapshot('m1', { home: 1, away: 0 }, 'in', "20'")]]);
            const getPrevious = () => undefined;

            const { actions } = computeDiff(leagueCode, newMap, getPrevious);

            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].type, 'score_changed');
        });
    });
});
