import megalodon from 'megalodon';
const generator = megalodon.default;
import { config } from '../config.js';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { mastodonLogger } from '../utils/logger.js';
import { recordMastodonPost } from '../utils/metrics.js';

let client = null;

/**
 * Initialize or get the Mastodon client
 * @returns {Object} Mastodon client instance
 */
function getClient() {
    if (!client) {
        client = generator('mastodon', config.mastodon.instance, config.mastodon.accessToken);
    }
    return client;
}

/**
 * Set a custom client (for testing)
 * @param {Object} customClient 
 */
export function __setClient(customClient) {
    client = customClient;
}

/**
 * Post a status (toot) to Mastodon
 * @param {string} text - The status text
 * @param {Object} options - Optional parameters
 * @param {string} options.visibility - Post visibility (public, unlisted, private, direct)
 * @param {string} options.inReplyToId - ID of status to reply to
 * @returns {Promise<Object|null>} Posted status or null on error
 */
export async function postStatus(text, options = {}) {
    if (config.bot.dryRun) {
        mastodonLogger.debug({ textLength: text.length }, '[DRY RUN] Postaria');
        return { id: 'dry-run', content: text };
    }

    const startTime = Date.now();

    return await retryWithBackoff(
        async () => {
            try {
                const mastodon = getClient();
                const response = await mastodon.postStatus(text, {
                    visibility: options.visibility || 'public',
                    in_reply_to_id: options.inReplyToId,
                });

                const latencyMs = Date.now() - startTime;
                recordMastodonPost(true, latencyMs);
                mastodonLogger.info({ statusId: response.data.id, latencyMs }, 'Status postado com sucesso');
                return response.data;
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                // Don't retry authentication errors
                if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                    recordMastodonPost(false, latencyMs);
                    mastodonLogger.error({ error: error.message }, 'Erro de autenticação');
                    throw error;
                }
                recordMastodonPost(false, latencyMs);
                mastodonLogger.error({ error: error.message }, 'Erro ao postar status');
                throw error;
            }
        },
        {
            shouldRetry: (error) => {
                // Don't retry auth errors
                if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                    return false;
                }
                return isRetryableError(error);
            },
            operationName: 'Mastodon postStatus',
        }
    ).catch(error => {
        mastodonLogger.error({ error: error.message }, 'Todas as tentativas falharam para postStatus');
        return null;
    });
}

/**
 * Post a thread of statuses
 * @param {string[]} texts - Array of status texts
 * @returns {Promise<Object[]>} Array of posted statuses
 */
export async function postThread(texts) {
    const posts = [];
    let lastId = null;

    for (const text of texts) {
        const post = await postStatus(text, { inReplyToId: lastId });
        if (post) {
            posts.push(post);
            lastId = post.id;
        }
        // Small delay between posts to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, config.delays.betweenThreadPosts));
    }

    return posts;
}

/**
 * Verify the bot credentials
 * @returns {Promise<boolean>} True if credentials are valid
 */
export async function verifyCredentials() {
    try {
        const mastodon = getClient();
        const response = await mastodon.verifyAccountCredentials();
        mastodonLogger.info({ username: response.data.username }, 'Autenticado');
        return true;
    } catch (error) {
        mastodonLogger.error({ error: error.message }, 'Erro de autenticação');
        return false;
    }
}

/**
 * Get current account id (for scripts)
 * @returns {Promise<string|null>} Account id or null
 */
export async function getAccountId() {
    try {
        const mastodon = getClient();
        const response = await mastodon.verifyAccountCredentials();
        return response.data?.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Get statuses posted by the account
 * @param {string} accountId - Account ID
 * @param {Object} options - { limit?: number, max_id?: string }
 * @returns {Promise<Array>} Array of status objects
 */
export async function getAccountStatuses(accountId, options = {}) {
    try {
        const mastodon = getClient();
        const response = await mastodon.getAccountStatuses(accountId, {
            limit: options.limit ?? 40,
            max_id: options.max_id,
        });
        return response.data || [];
    } catch (error) {
        mastodonLogger.error({ error: error.message }, 'Erro ao buscar statuses');
        return [];
    }
}
