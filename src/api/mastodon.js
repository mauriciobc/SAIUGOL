import megalodon from 'megalodon';
const generator = megalodon.default;
import { config } from '../config.js';

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
        console.log('[Mastodon] [DRY RUN] Postaria:', text);
        return { id: 'dry-run', content: text };
    }

    try {
        const mastodon = getClient();
        const response = await mastodon.postStatus(text, {
            visibility: options.visibility || 'public',
            in_reply_to_id: options.inReplyToId,
        });

        console.log('[Mastodon] Status postado com sucesso:', response.data.id);
        return response.data;
    } catch (error) {
        console.error('[Mastodon] Erro ao postar status:', error.message);
        return null;
    }
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
        console.log('[Mastodon] Autenticado como:', response.data.username);
        return true;
    } catch (error) {
        console.error('[Mastodon] Erro de autenticação:', error.message);
        return false;
    }
}
