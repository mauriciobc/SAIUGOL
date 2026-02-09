import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    getBreaker,
    resetAllBreakers,
    getAllBreakersState,
    CircuitState,
} from '../src/utils/circuitBreaker.js';

describe('circuitBreaker', () => {
    beforeEach(() => {
        resetAllBreakers();
    });

    describe('getBreaker', () => {
        it('deve retornar o mesmo breaker para o mesmo nome', () => {
            const b1 = getBreaker('api');
            const b2 = getBreaker('api');
            assert.strictEqual(b1, b2);
        });

        it('deve retornar breakers diferentes para nomes diferentes', () => {
            const b1 = getBreaker('api');
            const b2 = getBreaker('other');
            assert.notStrictEqual(b1, b2);
        });
    });

    describe('execute', () => {
        it('deve executar a função e retornar o resultado em estado CLOSED', async () => {
            const breaker = getBreaker('test');
            const result = await breaker.execute(async () => 42);
            assert.strictEqual(result, 42);
            assert.strictEqual(breaker.getState().state, CircuitState.CLOSED);
        });

        it('deve repassar erro em estado CLOSED', async () => {
            const breaker = getBreaker('test2');
            await assert.rejects(
                () => breaker.execute(async () => { throw new Error('fail'); }),
                /fail/
            );
        });

        it('deve abrir após failureThreshold falhas', async () => {
            const breaker = getBreaker('open-test', { failureThreshold: 2 });
            await breaker.execute(async () => { throw new Error('e1'); }).catch(() => {});
            await breaker.execute(async () => { throw new Error('e2'); }).catch(() => {});

            const state = breaker.getState();
            assert.strictEqual(state.state, CircuitState.OPEN);

            await assert.rejects(
                () => breaker.execute(async () => 1),
                /Circuit breaker open-test is OPEN/
            );
        });

        it('deve rejeitar imediatamente quando OPEN', async () => {
            const breaker = getBreaker('reject', { failureThreshold: 1 });
            await breaker.execute(async () => { throw new Error('x'); }).catch(() => {});

            await assert.rejects(
                () => breaker.execute(async () => 1),
                /is OPEN/
            );
        });
    });

    describe('reset', () => {
        it('deve voltar ao CLOSED após reset', async () => {
            const breaker = getBreaker('reset-test', { failureThreshold: 1 });
            await breaker.execute(async () => { throw new Error('x'); }).catch(() => {});
            assert.strictEqual(breaker.getState().state, CircuitState.OPEN);

            breaker.reset();
            assert.strictEqual(breaker.getState().state, CircuitState.CLOSED);

            const result = await breaker.execute(async () => 99);
            assert.strictEqual(result, 99);
        });
    });

    describe('getAllBreakersState', () => {
        it('deve retornar objeto com estado de cada breaker', () => {
            getBreaker('a');
            getBreaker('b');
            const states = getAllBreakersState();

            assert.ok(typeof states === 'object');
            assert.strictEqual(states.a.state, CircuitState.CLOSED);
            assert.strictEqual(states.b.state, CircuitState.CLOSED);
        });
    });

    describe('resetAllBreakers', () => {
        it('deve deixar todos os breakers em CLOSED', async () => {
            const b1 = getBreaker('r1', { failureThreshold: 1 });
            await b1.execute(async () => { throw new Error('x'); }).catch(() => {});

            resetAllBreakers();

            const states = getAllBreakersState();
            for (const s of Object.values(states)) {
                assert.strictEqual(s.state, CircuitState.CLOSED);
            }
        });
    });
});
