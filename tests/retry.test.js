import { describe, it } from 'node:test';
import assert from 'node:assert';
import { retryWithBackoff, isRetryableError } from '../src/utils/retry.js';

describe('retry', () => {
    describe('retryWithBackoff', () => {
        it('deve retornar o resultado na primeira tentativa bem-sucedida', async () => {
            const result = await retryWithBackoff(async () => 42, {
                maxAttempts: 3,
                initialDelay: 1,
                maxDelay: 10,
            });
            assert.strictEqual(result, 42);
        });

        it('deve repassar erro se shouldRetry retornar false', async () => {
            let attempts = 0;
            await assert.rejects(
                () =>
                    retryWithBackoff(
                        async () => {
                            attempts++;
                            throw new Error('client error');
                        },
                        {
                            maxAttempts: 3,
                            initialDelay: 1,
                            maxDelay: 10,
                            shouldRetry: () => false,
                        }
                    ),
                /client error/
            );
            assert.strictEqual(attempts, 1);
        });

        it('deve tentar até maxAttempts e depois lançar', async () => {
            let attempts = 0;
            await assert.rejects(
                () =>
                    retryWithBackoff(
                        async () => {
                            attempts++;
                            throw new Error('fail');
                        },
                        { maxAttempts: 3, initialDelay: 1, maxDelay: 10 }
                    ),
                /falhou após 3 tentativas/
            );
            assert.strictEqual(attempts, 3);
        });

        it('deve ter sucesso em tentativa posterior', async () => {
            let attempts = 0;
            const result = await retryWithBackoff(
                async () => {
                    attempts++;
                    if (attempts < 2) throw new Error('temp');
                    return 'ok';
                },
                { maxAttempts: 3, initialDelay: 1, maxDelay: 10 }
            );
            assert.strictEqual(result, 'ok');
            assert.strictEqual(attempts, 2);
        });
    });

    describe('isRetryableError', () => {
        it('deve retornar true para erros de rede', () => {
            assert.strictEqual(isRetryableError({ code: 'ECONNREFUSED' }), true);
            assert.strictEqual(isRetryableError({ code: 'ETIMEDOUT' }), true);
            assert.strictEqual(isRetryableError({ code: 'ENOTFOUND' }), true);
            assert.strictEqual(isRetryableError({ code: 'ECONNRESET' }), true);
        });

        it('deve retornar true para HTTP 5xx', () => {
            assert.strictEqual(isRetryableError({ response: { status: 500 } }), true);
            assert.strictEqual(isRetryableError({ response: { status: 503 } }), true);
        });

        it('deve retornar true para HTTP 429', () => {
            assert.strictEqual(isRetryableError({ response: { status: 429 } }), true);
        });

        it('deve retornar false para HTTP 4xx (exceto 429)', () => {
            assert.strictEqual(isRetryableError({ response: { status: 400 } }), false);
            assert.strictEqual(isRetryableError({ response: { status: 404 } }), false);
            assert.strictEqual(isRetryableError({ response: { status: 401 } }), false);
        });

        it('deve retornar true para erro sem response/code (desconhecido)', () => {
            assert.strictEqual(isRetryableError(new Error('unknown')), true);
        });
    });
});
