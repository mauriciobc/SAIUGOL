import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    recordEspnRequest,
    recordMastodonPost,
    recordMatchProcessed,
    recordEventPosted,
    recordBotError,
    getMetrics,
    resetMetrics,
} from '../src/utils/metrics.js';

describe('metrics', () => {
    beforeEach(() => {
        resetMetrics();
    });

    describe('recordEspnRequest', () => {
        it('deve incrementar requests e cacheMisses quando fromCache é false', () => {
            recordEspnRequest(true, 100, false);
            recordEspnRequest(false, 50, false);
            const m = getMetrics();

            assert.strictEqual(m.espn.requests, 2);
            assert.strictEqual(m.espn.cacheMisses, 2);
            assert.strictEqual(m.espn.cacheHits, 0);
            assert.strictEqual(m.espn.successRate, 50);
            assert.strictEqual(m.espn.avgLatencyMs, 75);
        });

        it('deve incrementar cacheHits quando fromCache é true', () => {
            recordEspnRequest(true, 10, true);
            const m = getMetrics();
            assert.strictEqual(m.espn.cacheHits, 1);
            assert.strictEqual(m.espn.cacheMisses, 0);
        });
    });

    describe('recordMastodonPost', () => {
        it('deve incrementar posts e latência', () => {
            recordMastodonPost(true, 200);
            recordMastodonPost(false, 100);
            const m = getMetrics();

            assert.strictEqual(m.mastodon.posts, 2);
            assert.strictEqual(m.mastodon.successRate, 50);
            assert.strictEqual(m.mastodon.avgLatencyMs, 150);
        });
    });

    describe('recordMatchProcessed / recordEventPosted / recordBotError', () => {
        it('deve incrementar contadores do bot', () => {
            recordMatchProcessed();
            recordMatchProcessed();
            recordEventPosted();
            recordBotError();

            const m = getMetrics();
            assert.strictEqual(m.bot.matchesProcessed, 2);
            assert.strictEqual(m.bot.eventsPosted, 1);
            assert.strictEqual(m.bot.errors, 1);
        });
    });

    describe('getMetrics', () => {
        it('deve retornar successRate 100 quando não há requests', () => {
            const m = getMetrics();
            assert.strictEqual(m.espn.successRate, 100);
            assert.strictEqual(m.mastodon.successRate, 100);
        });

        it('deve retornar avgLatencyMs 0 quando não há requests/posts', () => {
            const m = getMetrics();
            assert.strictEqual(m.espn.avgLatencyMs, 0);
            assert.strictEqual(m.mastodon.avgLatencyMs, 0);
        });
    });

    describe('resetMetrics', () => {
        it('deve zerar todos os contadores', () => {
            recordEspnRequest(true, 100, false);
            recordMastodonPost(true, 50);
            recordMatchProcessed();
            resetMetrics();

            const m = getMetrics();
            assert.strictEqual(m.espn.requests, 0);
            assert.strictEqual(m.espn.cacheHits, 0);
            assert.strictEqual(m.espn.cacheMisses, 0);
            assert.strictEqual(m.mastodon.posts, 0);
            assert.strictEqual(m.bot.matchesProcessed, 0);
            assert.strictEqual(m.bot.eventsPosted, 0);
            assert.strictEqual(m.bot.errors, 0);
        });
    });
});
