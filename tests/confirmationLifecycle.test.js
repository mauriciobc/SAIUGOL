import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decideConfirmationStep } from '../src/bot/confirmationLifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('decideConfirmationStep — shared confirmation FSM', () => {
    it('passes when already posted or lifecycle does not apply', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({ alreadyPosted: true, applies: true }),
            { action: 'pass' }
        );
        assert.deepStrictEqual(
            decideConfirmationStep({ alreadyPosted: false, applies: false }),
            { action: 'pass' }
        );
    });

    it('waits while pending and not ready and not timed out', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: { firstSeenAt: 1 },
                isReady: false,
                timedOut: false,
            }),
            { action: 'wait' }
        );
    });

    it('confirms when pending and ready', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: { firstSeenAt: 1, statusId: '9' },
                isReady: true,
                timedOut: false,
            }),
            { action: 'confirm', timedOut: false }
        );
    });

    it('confirms with timedOut flag when pending times out still not ready', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: { firstSeenAt: 1 },
                isReady: false,
                timedOut: true,
            }),
            { action: 'confirm', timedOut: true }
        );
    });

    it('disallows when pending and isDisallowed', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: { firstSeenAt: 1, statusId: '9' },
                isReady: false,
                timedOut: false,
                isDisallowed: true,
            }),
            { action: 'disallow' }
        );
    });

    it('starts pending when first sight shouldStartPending', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: null,
                shouldStartPending: true,
            }),
            { action: 'start_pending' }
        );
    });

    it('passes on first sight when not shouldStartPending (ready text goes to normal path)', () => {
        assert.deepStrictEqual(
            decideConfirmationStep({
                alreadyPosted: false,
                applies: true,
                pending: null,
                shouldStartPending: false,
            }),
            { action: 'pass' }
        );
    });

    it('eventProcessor handlers must call decideConfirmationStep (no duplicated decision trees)', () => {
        const src = readFileSync(join(root, 'src/bot/eventProcessor.js'), 'utf8');
        assert.ok(
            src.includes('decideConfirmationStep'),
            'eventProcessor.js should import/use decideConfirmationStep'
        );
        const goalFn = src.match(/async function handleGoalConfirmationLifecycle[\s\S]*?(?=async function handlePenalty)/);
        const penaltyFn = src.match(/async function handlePenaltyConfirmationLifecycle[\s\S]*?(?=export async function processEvents|async function handleMatchDelay)/);
        const delayFn = src.match(/async function handleMatchDelayStartLifecycle[\s\S]*?(?=async function handleGoal)/);
        for (const [name, block] of [
            ['goal', goalFn?.[0]],
            ['penalty', penaltyFn?.[0]],
            ['delay', delayFn?.[0]],
        ]) {
            assert.ok(block, `expected to find ${name} lifecycle function`);
            assert.ok(
                block.includes('decideConfirmationStep'),
                `${name} lifecycle should delegate decisions to decideConfirmationStep`
            );
        }
    });
});
