import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDateStringFor } from '../src/utils/dateUtils.js';
import {
    espnEventToSnapshot,
    matchesToSnapshotMap,
} from '../src/state/snapshotContract.js';
import { matchScheduleFixture } from './fixtures/matchScheduleFixture.js';

describe('timezone and match state detection', () => {
    describe('getDateStringFor - date boundary in UTC', () => {
        it('retorna 20260212 para 23:59 UTC em timezone UTC', () => {
            const date = new Date('2026-02-12T23:59:00.000Z');
            assert.strictEqual(getDateStringFor(date, 'UTC'), '20260212');
        });

        it('retorna 20260213 para 00:01 UTC em timezone UTC', () => {
            const date = new Date('2026-02-13T00:01:00.000Z');
            assert.strictEqual(getDateStringFor(date, 'UTC'), '20260213');
        });

        it('retorna 20260212 para 23:59 UTC em America/Sao_Paulo', () => {
            const date = new Date('2026-02-12T23:59:00.000Z');
            assert.strictEqual(getDateStringFor(date, 'America/Sao_Paulo'), '20260212');
        });

        it('retorna 20260213 para 03:00 UTC em America/Sao_Paulo (meia-noite BRT)', () => {
            const date = new Date('2026-02-13T03:00:00.000Z');
            assert.strictEqual(getDateStringFor(date, 'America/Sao_Paulo'), '20260213');
        });
    });

    describe('match state detection - espnEventToSnapshot', () => {
        it('detecta status pre para partida scheduled', () => {
            const match = matchScheduleFixture[0];
            const snap = espnEventToSnapshot(match);
            assert.strictEqual(snap.status, 'pre');
            assert.strictEqual(snap.id, '1');
        });

        it('detecta status in para partida em andamento', () => {
            const match = matchScheduleFixture[1];
            const snap = espnEventToSnapshot(match);
            assert.strictEqual(snap.status, 'in');
            assert.strictEqual(snap.id, '2');
        });

        it('detecta status post para partida finalizada', () => {
            const match = matchScheduleFixture[2];
            const snap = espnEventToSnapshot(match);
            assert.strictEqual(snap.status, 'post');
            assert.strictEqual(snap.id, '3');
        });
    });

    describe('matchesToSnapshotMap - fixture completo', () => {
        it('produz 3 snapshots com status pre, in, post corretos', () => {
            const map = matchesToSnapshotMap(matchScheduleFixture);
            assert.strictEqual(map.size, 3);
            assert.strictEqual(map.get('1').status, 'pre');
            assert.strictEqual(map.get('2').status, 'in');
            assert.strictEqual(map.get('3').status, 'post');
        });
    });

    describe('invariância - estado independente de timezone', () => {
        it('mesmo fixture produz mesmos snapshots em múltiplas chamadas', () => {
            const map1 = matchesToSnapshotMap(matchScheduleFixture);
            const map2 = matchesToSnapshotMap(matchScheduleFixture);

            for (const id of ['1', '2', '3']) {
                assert.deepStrictEqual(map1.get(id), map2.get(id));
            }
        });

        it('status de cada partida não depende de contexto temporal', () => {
            for (const match of matchScheduleFixture) {
                const snap = espnEventToSnapshot(match);
                const expected =
                    match.status === 'scheduled' ? 'pre' :
                    match.status === '1st Half' ? 'in' :
                    'post';
                assert.strictEqual(snap.status, expected);
            }
        });
    });
});
