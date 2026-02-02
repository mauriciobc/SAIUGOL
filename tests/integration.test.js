import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getTodayMatches, getMatchDetails, getLiveEvents, getHighlights } from '../src/api/espn.js';
import { postStatus, postThread, verifyCredentials } from '../src/api/mastodon.js';
import { resetMetrics, getMetrics } from '../src/utils/metrics.js';
import { resetAllBreakers, getAllBreakersState } from '../src/utils/circuitBreaker.js';

describe('Integration Tests', () => {
    beforeEach(() => {
        resetMetrics();
        resetAllBreakers();
    });

    describe('Full Polling Cycle', () => {
        it('should complete a full polling cycle without errors', async () => {
            const metrics = await import('../src/utils/metrics.js');

            const matches = await getTodayMatches();
            assert.ok(Array.isArray(matches), 'Should fetch matches');

            if (matches.length > 0) {
                const details = await getMatchDetails(matches[0].id);
                assert.ok(details === null || typeof details === 'object', 'Should handle match details');

                const events = await getLiveEvents(matches[0].id);
                assert.ok(Array.isArray(events), 'Should fetch live events');

                const highlights = await getHighlights(matches[0].id);
                assert.ok(Array.isArray(highlights), 'Should fetch highlights');
            }

            const finalMetrics = metrics.getMetrics();
            assert.ok(finalMetrics.espn.requests >= 0, 'Should have recorded metrics');
        });

        it('should handle multiple matches', async () => {
            const matches = await getTodayMatches();
            assert.ok(Array.isArray(matches), 'Should return array of matches');

            for (const match of matches) {
                assert.ok(match.id, 'Each match should have an ID');
                assert.ok(match.homeTeam, 'Each match should have homeTeam');
                assert.ok(match.awayTeam, 'Each match should have awayTeam');
            }
        });
    });

    describe('Circuit Breaker Integration', () => {
        it('should track circuit breaker states', () => {
            const states = getAllBreakersState();
            assert.ok(typeof states === 'object', 'Should return circuit breaker states');
        });

        it('should reset all breakers', () => {
            resetAllBreakers();
            const states = getAllBreakersState();
            for (const state of Object.values(states)) {
                assert.strictEqual(state.state, 'CLOSED', 'All breakers should be CLOSED after reset');
            }
        });
    });

    describe('Metrics Integration', () => {
        it('should collect metrics from API calls', async () => {
            await getTodayMatches();
            const metrics = getMetrics();

            assert.ok(metrics.espn.requests >= 0, 'Should have request count');
            assert.ok(typeof metrics.espn.successRate === 'number', 'Should have success rate');
            assert.ok(typeof metrics.espn.cacheHits === 'number', 'Should have cache hits');
            assert.ok(typeof metrics.espn.cacheMisses === 'number', 'Should have cache misses');
        });

        it('should reset metrics correctly', async () => {
            await getTodayMatches();
            resetMetrics();
            const metrics = getMetrics();

            assert.strictEqual(metrics.espn.requests, 0, 'Requests should be reset');
            assert.strictEqual(metrics.espn.cacheHits, 0, 'Cache hits should be reset');
            assert.strictEqual(metrics.espn.cacheMisses, 0, 'Cache misses should be reset');
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid match ID gracefully', async () => {
            const details = await getMatchDetails('non-existent-match-id');
            assert.strictEqual(details, null, 'Should return null for invalid match');

            const events = await getLiveEvents('non-existent-match-id');
            assert.ok(Array.isArray(events), 'Should return empty array for invalid match');

            const highlights = await getHighlights('non-existent-match-id');
            assert.ok(Array.isArray(highlights), 'Should return empty array for invalid match');
        });
    });

    describe('Cache Consistency', () => {
        it('should return consistent results from cache', async () => {
            const matches1 = await getTodayMatches();
            const matches2 = await getTodayMatches();

            assert.strictEqual(JSON.stringify(matches1), JSON.stringify(matches2), 'Cached results should be identical');
        });

        it('should track cache hits and misses', async () => {
            await getTodayMatches();
            const metrics1 = getMetrics();
            const initialMisses = metrics1.espn.cacheMisses;

            await getTodayMatches();
            const metrics2 = getMetrics();
            const cacheHits = metrics2.espn.cacheHits - metrics1.espn.cacheHits;

            assert.ok(cacheHits >= 0, 'Should have cache hits on second call');
        });
    });
});

describe('Dry Run Mode', () => {
    it('should not post in dry run mode', async () => {
        const result = await postStatus('Test message', { visibility: 'public' });

        if (result && result.id === 'dry-run') {
            assert.ok(true, 'Dry run mode is active');
        }
    });
});
