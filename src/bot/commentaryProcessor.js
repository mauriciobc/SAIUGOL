import { config } from '../config.js';
import { isEventPosted, markEventPosted } from '../state/matchState.js';
import { formatCommentary } from './formatter.js';
import { postMatchStatus } from './matchThread.js';
import { processEvents as defaultProcessEvents, isKeyEventTypeId } from './eventProcessor.js';
import { canPost, TIER } from './postPlanner.js';

/**
 * Dedup key for a commentary entry. Uses the `${matchId}-` prefix so clearMatchState cleans it up.
 * Entries without a play (stoppage-time announcements) fall back to ESPN's sequence number.
 * @param {string|number} matchId
 * @param {{ playId?: string|null, sequence?: number|null }} entry
 * @returns {string}
 */
export function getCommentaryEventId(matchId, entry) {
    return `${matchId}-commentary-${entry.playId ?? `s${entry.sequence}`}`;
}

/**
 * ESPN narrates each foul as two adjacent entries under one play id ("X sofre uma falta…" then
 * "Falta cometida por Y."); join them so the post says both who was fouled and who committed it.
 * @param {Array} entries - Normalized commentary entries in sequence order
 * @returns {Array}
 */
export function mergeSamePlayEntries(entries) {
    const merged = [];
    for (const entry of entries || []) {
        const prev = merged.at(-1);
        if (prev && entry.playId != null && prev.playId === entry.playId) {
            merged[merged.length - 1] = { ...prev, text: `${prev.text} ${entry.text}` };
        } else {
            merged.push(entry);
        }
    }
    return merged;
}

/**
 * Mark the commentary already published for a match as seen, so joining a live match (or restarting)
 * does not dump its history into the thread.
 * @param {string|number} matchId
 * @param {Array} entries - Normalized commentary entries
 */
export function markExistingCommentaryAsSeen(matchId, entries) {
    for (const entry of entries || []) {
        markEventPosted(getCommentaryEventId(matchId, entry));
    }
}

/**
 * Post a live match's key events and ESPN commentary in narrative order. Walks the commentary in ESPN's
 * sequence: an entry that is one of the key events triggers the keyEvents path at that point (so goals,
 * cards and subs keep their own formats and land in the right place in the thread); every other entry
 * with a minute becomes a commentary post. Key events the commentary has not mentioned yet are posted at
 * the end, so nothing waits on ESPN's commentary lag.
 *
 * Commentary is the lowest content tier: it only posts while the day's plan keeps this match at the
 * commentary level and the last 3 hours leave room for every live match's essentials (postPlanner).
 * Otherwise it is dropped, not queued — commentary posted late is noise.
 * @param {Array} commentary - Normalized commentary entries (getMatchCommentary)
 * @param {Array} events - Normalized key events (getLiveEvents)
 * @param {Object} match - Normalized match data
 * @param {Object} [deps] - Injectable for tests
 * @returns {Promise<{ events: number, commentary: number, dropped: number }>}
 */
export async function processCommentaryWithEvents(commentary, events, match, deps = {}) {
    const processEvents = deps.processEvents || defaultProcessEvents;
    const post = deps.post || ((text) => postMatchStatus(match.id, text, { visibility: config.commentary.visibility }));
    const matchId = String(match.id);
    const allowed = deps.canPost || (() => canPost(matchId, TIER.COMMENTARY));
    const keyEventIndex = new Map((events || []).map((event, i) => [String(event.id), i]));
    const counts = { events: 0, commentary: 0, dropped: 0 };

    for (const entry of mergeSamePlayEntries(commentary)) {
        const eventId = getCommentaryEventId(matchId, entry);
        if (!entry.minute || !entry.text || isEventPosted(eventId)) continue;

        const keyIndex = entry.playId != null ? keyEventIndex.get(entry.playId) : undefined;
        if (keyIndex !== undefined) {
            counts.events += await processEvents(events.slice(0, keyIndex + 1), match);
            markEventPosted(eventId);
            continue;
        }
        // A key-event type ESPN has not listed in keyEvents yet: leave it for the keyEvents path.
        if (isKeyEventTypeId(entry.typeId)) continue;

        if (!allowed()) {
            markEventPosted(eventId);
            counts.dropped += 1;
            continue;
        }
        const result = await post(formatCommentary(entry, match));
        if (result) {
            markEventPosted(eventId);
            counts.commentary += 1;
        }
    }

    if (events?.length) {
        counts.events += await processEvents(events, match);
    }
    if (counts.dropped > 0) {
        console.warn(`[Commentary] ${counts.dropped} comentários descartados na partida ${matchId}: agenda do dia cheia`);
    }
    return counts;
}
