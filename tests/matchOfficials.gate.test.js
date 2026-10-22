import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldPostMatchOfficials } from '../src/bot/matchMonitor.js';

describe('shouldPostMatchOfficials', () => {
    it('returns true when in window, flag on, not posted, and has officials', () => {
        assert.strictEqual(
            shouldPostMatchOfficials({
                inWindow: true,
                enabled: true,
                alreadyPosted: false,
                officialsCount: 1,
            }),
            true
        );
    });

    it('returns false when outside window', () => {
        assert.strictEqual(
            shouldPostMatchOfficials({
                inWindow: false,
                enabled: true,
                alreadyPosted: false,
                officialsCount: 1,
            }),
            false
        );
    });

    it('returns false when feature disabled', () => {
        assert.strictEqual(
            shouldPostMatchOfficials({
                inWindow: true,
                enabled: false,
                alreadyPosted: false,
                officialsCount: 1,
            }),
            false
        );
    });

    it('returns false when already posted', () => {
        assert.strictEqual(
            shouldPostMatchOfficials({
                inWindow: true,
                enabled: true,
                alreadyPosted: true,
                officialsCount: 1,
            }),
            false
        );
    });

    it('returns false when officials list empty', () => {
        assert.strictEqual(
            shouldPostMatchOfficials({
                inWindow: true,
                enabled: true,
                alreadyPosted: false,
                officialsCount: 0,
            }),
            false
        );
    });
});
