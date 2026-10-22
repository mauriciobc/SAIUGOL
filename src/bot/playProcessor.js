import { config } from '../config.js';
import {
    isEventPosted,
    markEventPosted,
    getEnhancedPlayPostCount,
    incrementEnhancedPlayPostCount,
} from '../state/matchState.js';
import { formatEnhancedPlay } from './formatter.js';
import { postMatchStatus } from './matchThread.js';
import { canPost, TIER } from './postPlanner.js';

const TYPE_TO_CATEGORY = {
    '106': 'SHOT_ON_TARGET',
    '117': 'SHOT_OFF_TARGET',
    '77': 'SAVE',
};

/**
 * @param {string|number} matchId
 * @param {string|number} playId
 * @returns {string}
 */
export function getEnhancedPlayEventId(matchId, playId) {
    return `play-${matchId}-${playId}`;
}

/**
 * @param {string} typeId
 * @returns {string|null}
 */
export function categoryFromTypeId(typeId) {
    return TYPE_TO_CATEGORY[String(typeId)] || null;
}

/**
 * Pure filter for enhanced plays eligible to post this tick.
 * @param {Array} plays - Normalized plays
 * @param {{
 *   typeIds: Set<string>,
 *   requirePriority: boolean,
 *   maxPerMatch: number,
 *   isPosted: (eventId: string) => boolean,
 *   postedCountSoFar: number,
 *   matchId?: string,
 * }} opts
 * @returns {Array}
 */
export function filterEnhancedPlays(plays, opts) {
    const {
        typeIds,
        requirePriority,
        maxPerMatch,
        isPosted,
        postedCountSoFar,
        matchId = '',
    } = opts;

    const slots = Math.max(0, maxPerMatch - postedCountSoFar);
    if (slots === 0 || !Array.isArray(plays)) return [];

    const filtered = plays.filter((p) => {
        if (!p?.id || !p.typeId) return false;
        if (!typeIds.has(String(p.typeId))) return false;
        if (requirePriority && !p.priority) return false;
        if (p.scoringPlay) return false;
        if (p.flags?.yellowCard || p.flags?.redCard) return false;
        const eventId = getEnhancedPlayEventId(matchId, p.id);
        if (isPosted(eventId)) return false;
        return true;
    });

    filtered.sort((a, b) => {
        const pa = a.period ?? 0;
        const pb = b.period ?? 0;
        if (pa !== pb) return pa - pb;
        return (a.clockValue ?? 0) - (b.clockValue ?? 0);
    });

    return filtered.slice(0, slots);
}

/**
 * Mark allowlisted (non-scoring) plays as seen so restart does not dump history.
 * @param {string|number} matchId
 * @param {Array} plays - Normalized plays
 * @param {{ typeIds?: Set<string> }} [options]
 */
export function markExistingPlaysAsSeen(matchId, plays, options = {}) {
    const typeIds = options.typeIds || config.enhancedPlays.typeIds;
    if (!Array.isArray(plays)) return;
    for (const p of plays) {
        if (!p?.id || !typeIds.has(String(p.typeId))) continue;
        if (p.scoringPlay) continue;
        if (p.flags?.yellowCard || p.flags?.redCard) continue;
        markEventPosted(getEnhancedPlayEventId(matchId, p.id));
    }
}

/**
 * Process and post enhanced plays for a live match.
 * @param {Array} plays
 * @param {Object} match
 * @param {Object} [deps] - injectable for tests
 * @returns {Promise<number>} Number of posts made
 */
export async function processEnhancedPlays(plays, match, deps = {}) {
    const typeIds = deps.typeIds || config.enhancedPlays.typeIds;
    const requirePriority = deps.requirePriority ?? config.enhancedPlays.requirePriority;
    const maxPerMatch = deps.maxPerMatch ?? config.enhancedPlays.maxPerMatch;
    const matchId = match?.id != null ? String(match.id) : '';
    const postStatus = deps.postStatus || ((text) => postMatchStatus(matchId, text));
    const allowed = deps.canPost || (() => canPost(matchId, TIER.PLAYS));

    const postedCountSoFar = getEnhancedPlayPostCount(matchId);
    const candidates = filterEnhancedPlays(plays, {
        typeIds,
        requirePriority,
        maxPerMatch,
        isPosted: isEventPosted,
        postedCountSoFar,
        matchId,
    });

    let posted = 0;
    for (const play of candidates) {
        const category = categoryFromTypeId(play.typeId);
        if (!category) continue;
        const text = formatEnhancedPlay(category, play, match);
        if (!text) continue;
        if (!allowed()) {
            // Crowded day: drop rather than post late (the cap counter is left alone)
            markEventPosted(getEnhancedPlayEventId(matchId, play.id));
            continue;
        }
        const result = await postStatus(text);
        if (result) {
            markEventPosted(getEnhancedPlayEventId(matchId, play.id));
            incrementEnhancedPlayPostCount(matchId);
            posted += 1;
        }
    }
    return posted;
}
