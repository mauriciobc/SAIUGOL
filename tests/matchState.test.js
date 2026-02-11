import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    getLastTootId,
    setLastTootId,
    clearMatchState,
} from '../src/state/matchState.js';

describe('matchState thread (last toot per match)', () => {
    const testMatchId = 'thread-test-match-' + Date.now();

    it('getLastTootId retorna null quando não há toot para a partida', () => {
        assert.strictEqual(getLastTootId(testMatchId), null);
    });

    it('setLastTootId e getLastTootId persistem o id por partida', () => {
        setLastTootId(testMatchId, 'mastodon-status-123');
        assert.strictEqual(getLastTootId(testMatchId), 'mastodon-status-123');
    });

    it('clearMatchState remove o last toot id da partida', () => {
        setLastTootId(testMatchId, 'mastodon-status-456');
        assert.strictEqual(getLastTootId(testMatchId), 'mastodon-status-456');
        clearMatchState(testMatchId);
        assert.strictEqual(getLastTootId(testMatchId), null);
    });
});
