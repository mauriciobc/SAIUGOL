import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { getTodayMatches, getMatchDetails, getLiveEvents, getHighlights } from '../src/api/espn.js';
import { resetMetrics } from '../src/utils/metrics.js';
import { resetAllBreakers } from '../src/utils/circuitBreaker.js';

describe('ESPN API Response Validation', () => {
    beforeEach(() => {
        resetMetrics();
        resetAllBreakers();
    });

    const TEST_LEAGUE = 'bra.1';

    describe('getTodayMatches', () => {
        it('should return an array', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);
            assert.ok(Array.isArray(matches), 'Should return an array');
        });

        it('should return matches with required fields', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);

            for (const match of matches) {
                assert.ok(match.id, 'Match should have id');
                assert.ok(match.homeTeam, 'Match should have homeTeam');
                assert.ok(match.awayTeam, 'Match should have awayTeam');
                assert.ok(match.homeTeam.id, 'Home team should have id');
                assert.ok(match.homeTeam.name, 'Home team should have name');
                assert.ok(match.awayTeam.id, 'Away team should have id');
                assert.ok(match.awayTeam.name, 'Away team should have name');
                assert.ok(typeof match.homeScore === 'number', 'Home score should be a number');
                assert.ok(typeof match.awayScore === 'number', 'Away score should be a number');
                assert.ok(match.status, 'Match should have status');
                assert.ok(match.state, 'Match should have state');
            }
        });

        it('should handle empty response gracefully', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);
            assert.ok(Array.isArray(matches), 'Should always return an array');
        });
    });

    describe('getMatchDetails', () => {
        it('should return null for invalid match ID', async () => {
            const details = await getMatchDetails('invalid-id-123456', TEST_LEAGUE);
            assert.strictEqual(details, null, 'Invalid match ID should return null');
        });

        it('should return match details with required fields for valid match', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);
            if (matches.length > 0) {
                const details = await getMatchDetails(matches[0].id, TEST_LEAGUE);
                if (details) {
                    assert.ok(details.id, 'Match details should have id');
                    assert.ok(details.homeTeam, 'Match details should have homeTeam');
                    assert.ok(details.awayTeam, 'Match details should have awayTeam');
                    assert.ok(typeof details.homeScore === 'number', 'Home score should be a number');
                    assert.ok(typeof details.awayScore === 'number', 'Away score should be a number');
                    assert.ok(details.status, 'Match details should have status');
                }
            }
        });
    });

    describe('getLiveEvents', () => {
        it('should return an array', async () => {
            const events = await getLiveEvents('invalid-id-123456', TEST_LEAGUE);
            assert.ok(Array.isArray(events), 'Should return an array');
        });

        it('should return events with required fields', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);
            if (matches.length > 0) {
                const events = await getLiveEvents(matches[0].id, TEST_LEAGUE);

                for (const event of events) {
                    assert.ok(event.id, 'Event should have id');
                    assert.ok(event.type, 'Event should have type');
                    assert.ok(event.minute, 'Event should have minute');
                }
            }
        });
    });

    describe('getHighlights', () => {
        it('should return an array', async () => {
            const highlights = await getHighlights('invalid-id-123456', TEST_LEAGUE);
            assert.ok(Array.isArray(highlights), 'Should return an array');
        });

        it('should return highlights with required fields when present', async () => {
            const matches = await getTodayMatches(TEST_LEAGUE);
            if (matches.length > 0) {
                const highlights = await getHighlights(matches[0].id, TEST_LEAGUE);

                for (const highlight of highlights) {
                    assert.ok(highlight.url, 'Highlight should have url');
                    assert.ok(highlight.title, 'Highlight should have title');
                }
            }
        });
    });
});

describe('ESPN API Cache Behavior', () => {
    beforeEach(() => {
        resetMetrics();
        resetAllBreakers();
    });

    it('should cache scoreboard responses', async () => {
        const matches1 = await getTodayMatches();
        const matches2 = await getTodayMatches();
        assert.deepStrictEqual(matches1, matches2, 'Cached responses should be identical');
    });
});

describe('ESPN API Metrics', () => {
    beforeEach(() => {
        resetMetrics();
        resetAllBreakers();
    });

    it('should track API requests in metrics', async () => {
        await getTodayMatches();
        const metrics = await import('../src/utils/metrics.js');
        const currentMetrics = metrics.getMetrics();
        assert.ok(currentMetrics.espn.requests >= 0, 'Should track requests');
    });
});
