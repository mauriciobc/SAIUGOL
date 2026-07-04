import megalodon from 'megalodon';
const generator = megalodon.default;
import { config } from '../config.js';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { mastodonLogger } from '../utils/logger.js';
import { recordMastodonPost } from '../utils/metrics.js';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let client = null;
let lastPostTime = 0;

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

let _uploadFn = null;
/** Override uploadMediaFromUrl for testing. Pass null to restore the real implementation. */
export function __setUploadFn(fn) { _uploadFn = fn; }

/**
 * Helper to download a file using native curl (to bypass Node.js WAF blocking)
 */
function downloadWithCurl(url, destPath) {
    return new Promise((resolve, reject) => {
        // Skip Akamai 403 blocks for standard curl by adding a more complex header set
        const curl = spawn('curl', [
            '-s', '-L',
            '-w', '%{http_code}',
            '-o', destPath,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-H', 'Accept: */*',
            '-H', 'Accept-Language: en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            '-H', 'Connection: keep-alive',
            '-H', 'Referer: https://www.espn.com.br/',
            url
        ]);

        let output = '';
        curl.stdout.on('data', (data) => {
            output += data.toString();
        });

        let stderr = '';
        curl.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        curl.on('close', (code) => {
            if (code === 0) {
                const httpCode = parseInt(output.trim(), 10);
                if (httpCode >= 200 && httpCode < 300) {
                    resolve();
                } else {
                    reject(new Error(`curl HTTP error: ${httpCode}`));
                }
            } else {
                reject(new Error(`curl exited with code ${code}. Stderr: ${stderr}`));
            }
        });

        curl.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Upload media from a URL to Mastodon
 * @param {string} url - The URL of the media to upload
 * @param {Object} options - Optional parameters
 * @param {string} options.description - Media description
 * @param {string} options.type - Media type ('image' or 'video')
 * @returns {Promise<string|null>} Media ID or null on error
 */
export async function uploadMediaFromUrl(url, options = {}) {
    if (_uploadFn) return _uploadFn(url, options);
    if (config.bot.dryRun) {
        mastodonLogger.debug({ url }, '[DRY RUN] Upload de mídia');
        return 'dry-run-media-id';
    }

    let lastError = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            mastodonLogger.info({ attempt, url }, 'Tentando baixar mídia via curl');
            
            const tempFileName = `saiugol-media-${crypto.randomBytes(8).toString('hex')}${options.type === 'video' ? '.mp4' : '.jpg'}`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);
            
            await downloadWithCurl(url, tempFilePath);

            // verify the file was created and has size
            const stats = fs.statSync(tempFilePath);
            if (stats.size === 0) {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                throw new Error('Downloaded file is empty');
            }

            // Check if video file is too large for reliable upload via proxy (e.g. mastodon.social 503 error)
            const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20 MB
            if (options.type === 'video' && stats.size > MAX_VIDEO_SIZE) {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                mastodonLogger.warn({ url, size: stats.size, max: MAX_VIDEO_SIZE }, 'Vídeo excede limite seguro de tamanho. Cancelando envio para usar fallback.');
                return null; // Force null return to trigger thumbnail fallback
            }

            const mediaType = options.type === 'video' ? 'video/mp4' : 'image/jpeg';
            const mastodon = getClient();

            const fileStream = fs.createReadStream(tempFilePath);

            let uploadResponse;
            try {
                uploadResponse = await mastodon.uploadMedia(
                    fileStream,
                    {
                        description: options.description || 'Highlight video',
                        mime_type: mediaType,
                    }
                );
            } finally {
                // Ensure temp file is removed after upload attempt
                try {
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (err) {
                    mastodonLogger.warn({ error: err.message }, 'Falha ao remover arquivo temporário');
                }
            }

            const mediaId = uploadResponse.data.id;
            mastodonLogger.info({ mediaId, url }, 'Mídia enviada, verificando processamento');

            // Poll for media processing completion (especially for videos)
            let mediaInfo = uploadResponse.data;
            let pollCount = 0;
            const maxPolls = 30;
            
            while (pollCount < maxPolls) {
                if (mediaInfo.url || mediaInfo.type === 'image') {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                pollCount++;
                
                try {
                    const statusResponse = await mastodon.getMedia(mediaId);
                    mediaInfo = statusResponse.data;
                    mastodonLogger.debug({ mediaId, pollCount, url: mediaInfo.url }, 'Verificando status da mídia');
                } catch (pollError) {
                    mastodonLogger.warn({ error: pollError.message }, 'Erro ao verificar status da mídia');
                    break;
                }
            }

            mastodonLogger.info({ mediaId, url, processed: !!mediaInfo.url }, 'Mídia carregada com sucesso');
            return mediaId;
            
        } catch (error) {
            lastError = error;
            mastodonLogger.warn({ attempt, error: error.message, data: error.response?.data, url }, 'Tentativa falhou');
            
            if (error.message?.includes('503') || error.message?.includes('429') || error.message?.includes('rate', 429)) {
                await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
                continue;
            }
            break;
        }
    }
    
    mastodonLogger.error({ error: lastError?.message, url }, 'Erro ao carregar mídia após todas as tentativas');
    return null;
}

/**
 * Post a status (toot) to Mastodon
 * @param {string} text - The status text
 * @param {Object} options - Optional parameters
 * @param {string} options.visibility - Post visibility (public, unlisted, private, direct)
 * @param {string} options.inReplyToId - ID of status to reply to
 * @param {string[]} options.mediaIds - Array of media IDs to attach
 * @returns {Promise<Object|null>} Posted status or null on error
 */
export async function postStatus(text, options = {}) {
    if (config.bot.dryRun) {
        mastodonLogger.debug({ textLength: text.length }, '[DRY RUN] Postaria');
        return { id: 'dry-run', content: text };
    }

    const minIntervalMs = config.delays.betweenPosts ?? 0;
    const now = Date.now();
    if (lastPostTime > 0) {
        const elapsed = now - lastPostTime;
        if (elapsed < minIntervalMs) {
            await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
        }
    }

    const startTime = Date.now();

    const result = await retryWithBackoff(
        async () => {
            try {
                const mastodon = getClient();
                const postOptions = {
                    visibility: options.visibility || 'public',
                    in_reply_to_id: options.inReplyToId,
                    language: config.i18n.defaultLanguage.split('-')[0],
                };

                if (options.mediaIds && options.mediaIds.length > 0) {
                    postOptions.media_ids = options.mediaIds;
                }

                const response = await mastodon.postStatus(text, postOptions);

                lastPostTime = Date.now();
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
    ).catch((error) => {
        mastodonLogger.error({ error: error.message }, 'Todas as tentativas falharam para postStatus');
        return null;
    });

    return result;
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
    } catch (error) {
        mastodonLogger.error({ err: error }, 'Erro ao obter ID da conta');
        return null;
    }
}

/**
 * Get mention notifications since a given notification id.
 * Requires the token to have read:notifications scope.
 * @param {string|null} sinceId - Only return notifications newer than this id
 * @returns {Promise<Array>} Array of megalodon notification objects (type === 'mention')
 */
export async function getMentions(sinceId = null) {
    try {
        const mastodon = getClient();
        const params = { types: ['mention'], limit: 30 };
        if (sinceId) params.since_id = sinceId;
        const response = await mastodon.getNotifications(params);
        return response.data || [];
    } catch (error) {
        mastodonLogger.error({ error: error.message }, 'Erro ao buscar menções');
        return [];
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
