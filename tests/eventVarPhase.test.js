import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    getEventVarPhase,
    resolveVarPhasedPost,
    isConfirmedGoalDescription,
    isConfirmedPenaltyMissedDescription,
} from '../src/utils/eventVarPhase.js';

describe('eventVarPhase', () => {
    it('detects provisional penalty from temporary description', () => {
        const event = {
            description: "Lionel Messi (Argentina) Tentativa temporária aos 21'",
        };
        assert.strictEqual(getEventVarPhase(event, 'PENALTY_MISSED'), 'provisional');
    });

    it('detects confirmed goal from Gol! description', () => {
        const event = {
            description: 'Gol! Argentina 1, Egito 0. Lionel Messi (Argentina) finalização...',
        };
        assert.strictEqual(getEventVarPhase(event, 'GOAL'), 'confirmed');
    });

    it('detects confirmed penalty from final description', () => {
        const event = {
            description: 'Pênalti defendido! Lionel Messi (Argentina) perdeu uma oportunidade única...',
        };
        assert.strictEqual(getEventVarPhase(event, 'PENALTY_MISSED'), 'confirmed');
    });

    it('resolves provisional then confirmed posts with distinct ids', () => {
        const posted = new Set();
        const baseEventId = '760509-49731038';
        const provisionalEvent = {
            description: "Lionel Messi (Argentina) Tentativa temporária aos 21'",
        };
        const confirmedEvent = {
            description: 'Pênalti defendido! Lionel Messi (Argentina) perdeu uma oportunidade única...',
        };

        const first = resolveVarPhasedPost({
            baseEventId,
            baseCategory: 'PENALTY_MISSED',
            event: provisionalEvent,
            isEventPosted: (id) => posted.has(id),
        });
        assert.strictEqual(first.postCategory, 'PENALTY_MISSED_PROVISIONAL');
        assert.strictEqual(first.eventId, `${baseEventId}-provisional`);
        posted.add(first.eventId);

        const second = resolveVarPhasedPost({
            baseEventId,
            baseCategory: 'PENALTY_MISSED',
            event: confirmedEvent,
            isEventPosted: (id) => posted.has(id),
        });
        assert.strictEqual(second.postCategory, 'PENALTY_MISSED_CONFIRMED');
        assert.strictEqual(second.eventId, `${baseEventId}-confirmed`);
        posted.add(second.eventId);

        const third = resolveVarPhasedPost({
            baseEventId,
            baseCategory: 'PENALTY_MISSED',
            event: confirmedEvent,
            isEventPosted: (id) => posted.has(id),
        });
        assert.strictEqual(third, null);
    });

    it('posts single final goal when provisional was missed', () => {
        const posted = new Set();
        const baseEventId = 'm1-ev1';
        const confirmedEvent = {
            description: 'Gol! Time A 1, Time B 0. Jogador (Time A) chute...',
        };

        const result = resolveVarPhasedPost({
            baseEventId,
            baseCategory: 'GOAL',
            event: confirmedEvent,
            isEventPosted: (id) => posted.has(id),
        });
        assert.strictEqual(result.postCategory, 'GOAL');
        assert.strictEqual(result.eventId, baseEventId);
    });

    it('isConfirmedGoalDescription matches Goal! and Gol!', () => {
        assert.strictEqual(isConfirmedGoalDescription('Goal! Team 0, Team 1. Player'), true);
        assert.strictEqual(isConfirmedGoalDescription('Gol! Time 1, Time 0. Jogador'), true);
        assert.strictEqual(isConfirmedGoalDescription('Tentativa temporária'), false);
    });

    it('isConfirmedPenaltyMissedDescription ignores temporary text', () => {
        assert.strictEqual(
            isConfirmedPenaltyMissedDescription("Lionel Messi (Argentina) Tentativa temporária aos 21'"),
            false
        );
        assert.strictEqual(
            isConfirmedPenaltyMissedDescription('Pênalti defendido! Lionel Messi...'),
            true
        );
    });
});
