import { config } from '../config.js';
import { postStatus } from '../api/mastodon.js';
import { getMatchThreadTail, setMatchThreadTail } from '../state/matchState.js';

/**
 * Post a status about a match. With THREAD_MATCH_POSTS enabled, each post replies to the previous
 * one about the same match, so preview → kickoff → events → full time → highlights read as a single
 * thread. An explicit inReplyToId (e.g. a goal confirmation replying to its "pending" post) wins over
 * the thread tail. If the status being replied to was deleted, the post goes out standalone instead
 * of stalling the match coverage.
 * @param {string|number} matchId
 * @param {string} text
 * @param {Object} [options] - Same options as postStatus
 * @returns {Promise<Object|null>} Posted status or null on error
 */
export async function postMatchStatus(matchId, text, options = {}) {
    if (!config.bot.threadMatchPosts) {
        return postStatus(text, options);
    }

    const inReplyToId = options.inReplyToId ?? getMatchThreadTail(matchId) ?? undefined;
    const result = await postStatus(text, { ...options, inReplyToId, fallbackToStandalone: true });
    if (result?.id) {
        setMatchThreadTail(matchId, result.id);
    }
    return result;
}
