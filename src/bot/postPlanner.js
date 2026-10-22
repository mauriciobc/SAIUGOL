import { config } from '../config.js';
import { getRecentStatusCount, getRecentStatusTimes, STATUS_LIMIT_PER_3H } from '../api/mastodon.js';
import { getActiveMatches } from '../state/matchState.js';
import { getDateStringFor } from '../utils/dateUtils.js';
import { createChild } from '../utils/logger.js';

const plannerLogger = createChild({ component: 'planner' });
import { matchesToSnapshotMap } from '../state/snapshotContract.js';

/**
 * Content levels, most important first. A match planned at level L gets every tier up to L. When the
 * day's overlapping matches would exceed Mastodon's 300 statuses per 3 hours (shared by the whole
 * account), the planner lowers levels one step at a time: commentary goes first, goals never do.
 */
export const TIER = Object.freeze({ ESSENTIAL: 0, STANDARD: 1, MINOR: 2, PLAYS: 3, COMMENTARY: 4 });

const TIER_LABELS = ['só essenciais', 'sem substituições/paralisações', 'completo', 'com lances', 'com comentários'];

const CATEGORY_TIER = {
    GOAL: TIER.ESSENTIAL,
    PENALTY_MISSED: TIER.ESSENTIAL,
    RED_CARD: TIER.ESSENTIAL,
    VAR: TIER.ESSENTIAL,
    MATCH_START: TIER.ESSENTIAL,
    HALF_TIME: TIER.ESSENTIAL,
    MATCH_END: TIER.ESSENTIAL,
    EXTRA_TIME_START: TIER.ESSENTIAL,
    EXTRA_TIME_HALF: TIER.ESSENTIAL,
    EXTRA_TIME_SECOND_HALF: TIER.ESSENTIAL,
    EXTRA_TIME_END: TIER.ESSENTIAL,
    SHOOTOUT_START: TIER.ESSENTIAL,
    YELLOW_CARD: TIER.STANDARD,
    SECOND_HALF_START: TIER.STANDARD,
    END_REGULAR_TIME: TIER.STANDARD,
    SUBSTITUTION: TIER.MINOR,
    MATCH_DELAY_START: TIER.MINOR,
    MATCH_DELAY_END: TIER.MINOR,
};

/**
 * @param {string} category - eventProcessor category (GOAL, SUBSTITUTION…)
 * @returns {number} TIER value; unknown categories are STANDARD
 */
export function tierForCategory(category) {
    return CATEGORY_TIER[category] ?? TIER.STANDARD;
}

/**
 * Average posts per match at each tier, measured on the 20 latest finished bra.1 matches (Oct 2026):
 * essential 5.8 (max 10), standard 10.6 incl. preview/officials/highlights/stats (max 14), minor 18.7 —
 * ~10 substitutions + ~9 injury/hydration stoppage posts (max 28), shots 11.9 (cap 12), commentary 75 (max 89).
 */
const POSTS_PER_TIER = [6, 11, 19, 12, 75];

/**
 * Posts kept free per live match before any non-essential post goes out: the safety net for when reality
 * outruns the plan. Simulated on the 2026 bra.1 calendar with max per-match volumes: 5 never loses an
 * essential post; 3 or less does, and 10 fights the plan on 10-match nights (blocks non-essentials past 200).
 */
const ESSENTIAL_RESERVE_PER_MATCH = 5;

const MINUTE_MS = 60_000;
const WINDOW_MS = 180 * MINUTE_MS;
/** A match posts from its preview (kickoff − 10 min) to its stats (≈ kickoff + 115 min). */
const SPAN_BEFORE_MS = 10 * MINUTE_MS;
const SPAN_AFTER_MS = 115 * MINUTE_MS;
const STEP_MS = 5 * MINUTE_MS;

/**
 * Expected posts for one match at a level. Commentary replaces the shots feed, so level 4 is levels 0–2
 * plus commentary (not plus shots).
 * @param {number} level
 * @returns {number}
 */
export function expectedPosts(level) {
    let total = 0;
    for (let tier = TIER.ESSENTIAL; tier <= Math.min(level, TIER.MINOR); tier += 1) total += POSTS_PER_TIER[tier];
    if (level === TIER.PLAYS) total += POSTS_PER_TIER[TIER.PLAYS];
    if (level >= TIER.COMMENTARY) total += POSTS_PER_TIER[TIER.COMMENTARY];
    return total;
}

/**
 * Pick a content level per match so the busiest 3-hour window of the rest of the day stays within budget.
 * Each match's posts are projected evenly over its span (preview → stats); posts already made come in as
 * timestamps. Greedy: while the busiest window is over budget, lower by one level the match with the most
 * content in that window (favorite teams, higher-priority leagues and earlier kickoffs last).
 * @param {Array<{ id: string, kickoffMs: number, favorite?: boolean, leagueRank?: number }>} matches - Not finished yet
 * @param {{ now: number, recentPostTimes?: number[], maxLevel: number, budget: number }} options
 * @returns {{ levels: Map<string, number>, peak: number, fits: boolean }}
 */
export function planDay(matches, { now, recentPostTimes = [], maxLevel, budget }) {
    const fullSpan = SPAN_BEFORE_MS + SPAN_AFTER_MS;
    const spans = matches
        .map((m) => ({ ...m, start: Math.max(now, m.kickoffMs - SPAN_BEFORE_MS), end: m.kickoffMs + SPAN_AFTER_MS }))
        .filter((m) => m.end > now);
    const levels = new Map(spans.map((m) => [m.id, maxLevel]));
    const lastEnd = Math.max(now, ...spans.map((m) => m.end));

    const projectedIn = (m, windowStart, windowEnd) => {
        const overlap = Math.min(windowEnd, m.end) - Math.max(windowStart, m.start);
        return overlap > 0 ? (expectedPosts(levels.get(m.id)) * overlap) / fullSpan : 0;
    };
    const busiestWindow = () => {
        let best = { count: 0, end: now };
        for (let end = now; end <= lastEnd + STEP_MS; end += STEP_MS) {
            const start = end - WINDOW_MS;
            let count = recentPostTimes.filter((t) => t > start && t <= end).length;
            for (const m of spans) count += projectedIn(m, start, end);
            if (count > best.count) best = { count, end };
        }
        return best;
    };

    let peak = busiestWindow();
    while (peak.count > budget) {
        const windowStart = peak.end - WINDOW_MS;
        const candidates = spans.filter((m) => levels.get(m.id) > TIER.ESSENTIAL && projectedIn(m, windowStart, peak.end) > 0);
        if (candidates.length === 0) break;
        candidates.sort((a, b) =>
            levels.get(b.id) - levels.get(a.id)
            || Number(Boolean(a.favorite)) - Number(Boolean(b.favorite))
            || (b.leagueRank ?? 0) - (a.leagueRank ?? 0)
            || b.kickoffMs - a.kickoffMs
            || String(a.id).localeCompare(String(b.id)));
        levels.set(candidates[0].id, levels.get(candidates[0].id) - 1);
        peak = busiestWindow();
    }
    return { levels, peak: Math.round(peak.count), fits: peak.count <= budget };
}

/** Highest level the configuration asks for: commentary, else shots, else everything up to minor events. */
export function maxLevelFromConfig() {
    if (config.events.commentary) return TIER.COMMENTARY;
    if (config.events.enhancedPlays) return TIER.PLAYS;
    return TIER.MINOR;
}

function isFavoriteMatch(match) {
    const ids = config.bot.favoriteTeamIds || [];
    const names = (config.bot.favoriteTeamNames || []).map((n) => n.toLowerCase());
    return [match.homeTeam, match.awayTeam].some((team) =>
        (team?.id != null && ids.includes(String(team.id)))
        || (team?.name && names.some((n) => team.name.toLowerCase().includes(n))));
}

let currentLevels = new Map();
let plannedDay = null;

/**
 * Plan the day's content levels from the cross-league schedule. Called every poll but computes once per
 * calendar day (the schedule is fixed days ahead), on the first poll that sees the day's matches.
 * @param {Array<{ league: Object, matches: Array }>} leagueMatches - In LEAGUE_CODES order (earlier = higher priority)
 * @param {{ now?: number, recentPostTimes?: number[] }} [options]
 * @returns {ReturnType<typeof planDay>|null} The new plan, or null when already planned today or SMART_SCHEDULE is off
 */
export function updateDayPlan(leagueMatches, { now = Date.now(), recentPostTimes } = {}) {
    if (!config.planner.enabled) return null;
    const day = getDateStringFor(new Date(now), config.timezone);
    if (day === plannedDay) return null;
    const matches = [];
    (leagueMatches || []).forEach(({ matches: list }, leagueRank) => {
        const snapshots = matchesToSnapshotMap(list);
        for (const m of list || []) {
            const kickoffMs = new Date(m.startTime).getTime();
            if (snapshots.get(String(m.id))?.status === 'post' || Number.isNaN(kickoffMs)) continue;
            matches.push({ id: String(m.id), kickoffMs, leagueRank, favorite: isFavoriteMatch(m) });
        }
    });
    if (matches.length === 0) return null;
    const plan = planDay(matches, {
        now,
        recentPostTimes: recentPostTimes ?? getRecentStatusTimes(now),
        maxLevel: maxLevelFromConfig(),
        budget: config.planner.budgetPer3h,
    });
    // A match still running from the previous day (past midnight) keeps its level, so its feed never flips mid-match.
    const carried = [...currentLevels].filter(([id]) => getActiveMatches().has(id) && !plan.levels.has(id));
    currentLevels = new Map([...carried, ...plan.levels]);
    plannedDay = day;

    const byLevel = {};
    for (const level of plan.levels.values()) byLevel[level] = (byLevel[level] || 0) + 1;
    const summary = Object.entries(byLevel)
        .sort(([a], [b]) => b - a)
        .map(([level, n]) => `${n} ${TIER_LABELS[level]}`)
        .join(', ');
    plannerLogger.info({ day, matches: plan.levels.size, peak: plan.peak, budget: config.planner.budgetPer3h, fits: plan.fits, levels: summary }, 'Plano do dia');
    return plan;
}

/**
 * Content level planned for a match (the configured maximum when it is not in today's plan).
 * @param {string|number} matchId
 * @returns {number}
 */
export function getPlannedLevel(matchId) {
    return currentLevels.get(String(matchId)) ?? maxLevelFromConfig();
}

/**
 * Whether a post of this tier may go out for a match: essentials always; the rest only within the
 * match's planned level and while the last 3 hours leave room for every live match's essentials (the
 * safety net for extra time, restarts and posts made outside the bot).
 * @param {string|number} matchId
 * @param {number} tier - TIER value
 * @param {{ recentCount?: number, liveMatches?: number }} [state] - Injectable for tests
 * @returns {boolean}
 */
export function canPost(matchId, tier, state = {}) {
    if (tier === TIER.ESSENTIAL) return true;
    if (tier > getPlannedLevel(matchId)) return false;
    const recentCount = state.recentCount ?? getRecentStatusCount();
    const liveMatches = Math.max(1, state.liveMatches ?? getActiveMatches().size);
    return recentCount + ESSENTIAL_RESERVE_PER_MATCH * liveMatches < STATUS_LIMIT_PER_3H;
}

/** Reset the current plan (tests only). */
export function resetPlanForTesting() {
    currentLevels = new Map();
    plannedDay = null;
}
