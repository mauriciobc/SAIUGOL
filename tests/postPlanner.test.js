import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { config } from '../src/config.js';
import {
    TIER,
    tierForCategory,
    expectedPosts,
    planDay,
    updateDayPlan,
    getPlannedLevel,
    canPost,
    resetPlanForTesting,
} from '../src/bot/postPlanner.js';

const MIN = 60_000;
// 2026-12-02 19:00 BRT: the final round, traditionally all 10 matches at once
const KICKOFF = Date.parse('2026-12-02T22:00:00Z');
const NOON = Date.parse('2026-12-02T15:00:00Z');

const simultaneous = (n, extra = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kickoffMs: KICKOFF, leagueRank: 0, ...extra }));
const levelsOf = (plan) => [...plan.levels.values()];
const count = (plan, level) => levelsOf(plan).filter((l) => l === level).length;

describe('tiers', () => {
    it('keeps goals, reds and results essential and puts subs and stoppages lowest among events', () => {
        for (const c of ['GOAL', 'RED_CARD', 'PENALTY_MISSED', 'VAR', 'MATCH_START', 'HALF_TIME', 'MATCH_END']) {
            assert.strictEqual(tierForCategory(c), TIER.ESSENTIAL, c);
        }
        for (const c of ['YELLOW_CARD', 'SECOND_HALF_START', 'END_REGULAR_TIME']) assert.strictEqual(tierForCategory(c), TIER.STANDARD, c);
        for (const c of ['SUBSTITUTION', 'MATCH_DELAY_START', 'MATCH_DELAY_END']) assert.strictEqual(tierForCategory(c), TIER.MINOR, c);
    });

    it('projects the measured bra.1 volumes per level (commentary replaces shots)', () => {
        assert.deepStrictEqual([0, 1, 2, 3, 4].map(expectedPosts), [6, 17, 36, 48, 111]);
    });
});

describe('planDay', () => {
    it('gives a lone evening match full commentary', () => {
        const plan = planDay(simultaneous(1), { now: NOON, maxLevel: TIER.COMMENTARY, budget: 270 });
        assert.deepStrictEqual(levelsOf(plan), [TIER.COMMENTARY]);
        assert.strictEqual(plan.fits, true);
    });

    it('drops substitutions and stoppages on part of a 10-match night to stay under budget', () => {
        // 10 × 36 = 360 > 270; level 1 is 17 per match, so 5 matches can keep minor events (5 × 36 + 5 × 17 = 265)
        const plan = planDay(simultaneous(10), { now: NOON, maxLevel: TIER.MINOR, budget: 270 });
        assert.strictEqual(plan.fits, true);
        assert.ok(plan.peak <= 270, String(plan.peak));
        assert.strictEqual(count(plan, TIER.MINOR), 5);
        assert.strictEqual(count(plan, TIER.STANDARD), 5);
    });

    it('lowers favorite teams and higher-priority leagues last', () => {
        const matches = simultaneous(10);
        matches[9].favorite = true;
        matches[8].leagueRank = -1; // listed before the others in LEAGUE_CODES
        const plan = planDay(matches, { now: NOON, maxLevel: TIER.MINOR, budget: 270 });
        assert.strictEqual(plan.levels.get('m9'), TIER.MINOR);
        assert.strictEqual(plan.levels.get('m8'), TIER.MINOR);
    });

    it('degrades commentary to shots across matches before anyone loses more', () => {
        const plan = planDay(simultaneous(6), { now: NOON, maxLevel: TIER.COMMENTARY, budget: 270 });
        const levels = levelsOf(plan);
        assert.ok(Math.max(...levels) - Math.min(...levels) <= 1, levels.join(','));
        assert.ok(plan.fits);
    });

    it('spreads commentary when kickoffs are staggered', () => {
        const staggered = [0, 150, 300].map((offset, i) => ({ id: `s${i}`, kickoffMs: KICKOFF - 300 * MIN + offset * MIN }));
        const plan = planDay(staggered, { now: NOON, maxLevel: TIER.COMMENTARY, budget: 270 });
        assert.deepStrictEqual(levelsOf(plan), [TIER.COMMENTARY, TIER.COMMENTARY, TIER.COMMENTARY]);
    });

    it('counts posts already made in the last 3 hours', () => {
        const now = KICKOFF - 10 * MIN;
        const recentPostTimes = Array.from({ length: 220 }, (_, i) => now - (i + 1) * 30_000);
        const plan = planDay(simultaneous(1), { now, recentPostTimes, maxLevel: TIER.COMMENTARY, budget: 270 });
        assert.ok(plan.levels.get('m0') < TIER.COMMENTARY);
    });

    it('stops at essentials when even those do not fit', () => {
        const plan = planDay(simultaneous(20), { now: NOON, maxLevel: TIER.MINOR, budget: 100 });
        assert.ok(levelsOf(plan).every((l) => l === TIER.ESSENTIAL));
        assert.strictEqual(plan.fits, false);
    });

    it('ignores matches that already ended', () => {
        const plan = planDay(simultaneous(1), { now: KICKOFF + 200 * MIN, maxLevel: TIER.MINOR, budget: 270 });
        assert.strictEqual(plan.levels.size, 0);
    });
});

describe('updateDayPlan', () => {
    const saved = {};
    const schedule = (n, startTime = '2026-12-02T22:00:00Z') => [{
        league: { code: 'bra.1' },
        matches: Array.from({ length: n }, (_, i) => ({
            id: `d${i}`, startTime, status: 'STATUS_SCHEDULED', homeTeam: { id: `h${i}`, name: `H${i}` }, awayTeam: { id: `a${i}`, name: `A${i}` },
        })),
    }];

    beforeEach(() => {
        saved.enabled = config.planner.enabled;
        saved.budget = config.planner.budgetPer3h;
        config.planner.enabled = true;
        config.planner.budgetPer3h = 270;
        resetPlanForTesting();
    });

    afterEach(() => {
        config.planner.enabled = saved.enabled;
        config.planner.budgetPer3h = saved.budget;
        resetPlanForTesting();
    });

    it('plans once per day and keeps that plan for the rest of the day', () => {
        const plan = updateDayPlan(schedule(10), { now: NOON, recentPostTimes: [] });
        assert.strictEqual(plan.levels.size, 10);
        assert.strictEqual(getPlannedLevel('d0'), plan.levels.get('d0'));
        assert.strictEqual(updateDayPlan(schedule(1), { now: NOON + 60 * MIN, recentPostTimes: [] }), null);
        assert.strictEqual(getPlannedLevel('d9'), plan.levels.get('d9'));
    });

    it('plans again the next day', () => {
        updateDayPlan(schedule(10), { now: NOON, recentPostTimes: [] });
        const next = updateDayPlan(schedule(1, '2026-12-03T22:00:00Z'), { now: NOON + 24 * 60 * MIN, recentPostTimes: [] });
        assert.ok(next);
    });

    it('does nothing when SMART_SCHEDULE is off', () => {
        config.planner.enabled = false;
        assert.strictEqual(updateDayPlan(schedule(10), { now: NOON, recentPostTimes: [] }), null);
        assert.strictEqual(getPlannedLevel('d0'), TIER.MINOR);
    });
});

describe('canPost', () => {
    beforeEach(() => resetPlanForTesting());

    it('always lets essentials through', () => {
        assert.strictEqual(canPost('x', TIER.ESSENTIAL, { recentCount: 299, liveMatches: 10 }), true);
    });

    it('blocks tiers above the planned level', () => {
        // Default config: no commentary or shots, so the maximum level is MINOR
        assert.strictEqual(canPost('x', TIER.MINOR, { recentCount: 0, liveMatches: 1 }), true);
        assert.strictEqual(canPost('x', TIER.COMMENTARY, { recentCount: 0, liveMatches: 1 }), false);
    });

    it('keeps 5 posts per live match free for essentials when reality outruns the plan', () => {
        assert.strictEqual(canPost('x', TIER.STANDARD, { recentCount: 274, liveMatches: 5 }), true); // 274 + 25 < 300
        assert.strictEqual(canPost('x', TIER.STANDARD, { recentCount: 275, liveMatches: 5 }), false);
    });
});
