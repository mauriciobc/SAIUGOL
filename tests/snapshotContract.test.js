import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    normalizeStatus,
    espnEventToSnapshot,
    matchesToSnapshotMap,
} from '../src/state/snapshotContract.js';

describe('snapshotContract', () => {
    describe('normalizeStatus', () => {
        it('deve mapear status "finished" / "ft" para post', () => {
            assert.strictEqual(normalizeStatus('finished', ''), 'post');
            assert.strictEqual(normalizeStatus('FT', ''), 'post');
            assert.strictEqual(normalizeStatus('', 'ft'), 'post');
        });

        it('deve mapear status "in play" / "live" / "ht" para in', () => {
            assert.strictEqual(normalizeStatus('in play', ''), 'in');
            assert.strictEqual(normalizeStatus('live', ''), 'in');
            assert.strictEqual(normalizeStatus('', 'ht'), 'in');
        });

        it('deve mapear status ESPN futebol "1st Half" / "2nd Half" / "Halftime" para in', () => {
            assert.strictEqual(normalizeStatus('1st Half', ''), 'in');
            assert.strictEqual(normalizeStatus('2nd Half', ''), 'in');
            assert.strictEqual(normalizeStatus('Halftime', ''), 'in');
            assert.strictEqual(normalizeStatus('First Half', ''), 'in');
            assert.strictEqual(normalizeStatus('Second Half', ''), 'in');
            assert.strictEqual(normalizeStatus('In Progress', ''), 'in');
        });

        it('deve mapear status "scheduled" / "not started" para pre', () => {
            assert.strictEqual(normalizeStatus('scheduled', ''), 'pre');
            assert.strictEqual(normalizeStatus('not started', ''), 'pre');
            assert.strictEqual(normalizeStatus('TBD', ''), 'pre');
        });

        it('não deve confundir "postponed" com "post" (word boundary)', () => {
            assert.strictEqual(normalizeStatus('postponed', ''), 'pre');
        });

        it('deve retornar pre para string vazia ou desconhecida', () => {
            assert.strictEqual(normalizeStatus('', ''), 'pre');
            assert.strictEqual(normalizeStatus('unknown', ''), 'pre');
        });
    });

    describe('espnEventToSnapshot', () => {
        it('deve construir snapshot com id, score, status e gameTime', () => {
            const event = {
                id: 'abc123',
                homeScore: 2,
                awayScore: 1,
                status: 'in play',
                state: 'live',
                minute: "45'",
            };
            const snap = espnEventToSnapshot(event);

            assert.strictEqual(snap.id, 'abc123');
            assert.deepStrictEqual(snap.score, { home: 2, away: 1 });
            assert.strictEqual(snap.status, 'in');
            assert.strictEqual(snap.gameTime, "45'");
        });

        it('deve tratar score ausente ou inválido como 0', () => {
            const snap = espnEventToSnapshot({ id: 'x', status: 'scheduled' });
            assert.deepStrictEqual(snap.score, { home: 0, away: 0 });
        });

        it('deve usar gameTime "-" para status pre', () => {
            const snap = espnEventToSnapshot({ id: 'x', status: 'scheduled' });
            assert.strictEqual(snap.gameTime, '-');
        });

        it('deve usar "0\'" para status in sem minute', () => {
            const snap = espnEventToSnapshot({
                id: 'x',
                homeScore: 0,
                awayScore: 0,
                status: 'live',
            });
            assert.strictEqual(snap.gameTime, "0'");
        });

        it('deve tratar event null/undefined de forma segura', () => {
            const snap = espnEventToSnapshot(null);
            assert.strictEqual(snap.id, '');
            assert.deepStrictEqual(snap.score, { home: 0, away: 0 });
            assert.strictEqual(snap.status, 'pre');
        });
    });

    describe('matchesToSnapshotMap', () => {
        it('deve retornar Map com um snapshot por match id', () => {
            const matches = [
                { id: 'm1', homeScore: 0, awayScore: 0, status: 'scheduled' },
                { id: 'm2', homeScore: 1, awayScore: 1, status: 'in play', minute: "30'" },
            ];
            const map = matchesToSnapshotMap(matches);

            assert.strictEqual(map.size, 2);
            assert.strictEqual(map.get('m1').id, 'm1');
            assert.strictEqual(map.get('m2').score.home, 1);
        });

        it('deve ignorar match sem id', () => {
            const matches = [{ homeScore: 0, awayScore: 0, status: 'scheduled' }];
            const map = matchesToSnapshotMap(matches);
            assert.strictEqual(map.size, 0);
        });

        it('deve retornar Map vazia para input não-array', () => {
            assert.strictEqual(matchesToSnapshotMap(null).size, 0);
            assert.strictEqual(matchesToSnapshotMap(undefined).size, 0);
            assert.strictEqual(matchesToSnapshotMap({}).size, 0);
        });

        it('deve retornar Map vazia para array vazio', () => {
            assert.strictEqual(matchesToSnapshotMap([]).size, 0);
        });
    });
});
