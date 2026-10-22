import { config } from '../config.js';
import { getMentions, postStatus, getAccountId } from '../api/mastodon.js';
import { getLastNotificationId, setLastNotificationId } from '../state/matchState.js';
import { formatDailyDigest } from './formatter.js';
import { createChild } from '../utils/logger.js';

const mentionLogger = createChild({ component: 'mentionListener' });

/**
 * Per-account cooldown: Map<accountId, lastReplyTimestampMs>
 * In-memory only — resets on restart, which is acceptable (documented behaviour).
 */
const cooldowns = new Map();

/** A reply that keeps failing is retried on later ticks this many times before the mention is skipped. */
const MAX_REPLY_ATTEMPTS = 3;
/** Failed reply attempts per notification id (in memory). */
const failedReplies = new Map();

/** Keywords and the handler they invoke. Keys are lowercased. */
const COMMANDS = {
    jogos: handleScheduleCommand,
    hoje: handleScheduleCommand,
    agenda: handleScheduleCommand,
};

/** League schedule data injected by the caller so this module stays stateless w.r.t. ESPN. */
let _leagueMatchesProvider = null;

/**
 * Register a provider function that returns the current league match list.
 * Must be called before startMentionListener().
 * @param {() => Array<{ league: Object, matches: Array }>} fn
 */
export function setLeagueMatchesProvider(fn) {
    _leagueMatchesProvider = fn;
}

async function handleScheduleCommand(mention, leagueMatches) {
    const text = formatDailyDigest(leagueMatches);
    return postStatus(text, { inReplyToId: mention.status.id });
}

/** Mastodon ids are numeric snowflakes: compare as BigInt (string fallback for non-numeric ids in tests). */
function compareIds(a, b) {
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        const diff = BigInt(a) - BigInt(b);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    }
    return a > b ? 1 : a < b ? -1 : 0;
}

/**
 * Parse the first recognised command keyword from a mention's content.
 * Strips HTML tags before matching.
 * @param {string} html
 * @returns {string|null}
 */
export function parseCommand(html) {
    const plain = (html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
    for (const keyword of Object.keys(COMMANDS)) {
        const re = new RegExp(`\\b${keyword}\\b`);
        if (re.test(plain)) return keyword;
    }
    return null;
}

/**
 * Whether a mention still needs a reply, and the handler for it. Skips the bot's own account, bot
 * accounts, unrecognised commands and accounts on cooldown.
 */
function pendingCommand(notification, botAccountId) {
    const account = notification.account;
    if (!account) return null;
    if (botAccountId && String(account.id) === String(botAccountId)) return null;
    if (account.bot) return null;

    const keyword = parseCommand(notification.status?.content || '');
    const handler = keyword ? COMMANDS[keyword] : null;
    if (!handler) return null;

    const last = cooldowns.get(account.id) ?? 0;
    if (Date.now() - last < config.mentions.cooldownMs) return null;
    return { keyword, handler, account };
}

/**
 * Process a batch of mention notifications, oldest first.
 * A reply that fails stops the batch, so the returned cursor stays just before that mention and the next
 * tick retries it; after MAX_REPLY_ATTEMPTS failures the mention is skipped so it cannot block the rest.
 * @param {Array} mentions - Megalodon notification objects (type === 'mention')
 * @param {string|null} botAccountId - The bot's own account id
 * @param {Array<{ league: Object, matches: Array }>} leagueMatches
 * @returns {Promise<string|null>} The highest notification id fully handled, or null
 */
export async function processMentions(mentions, botAccountId, leagueMatches) {
    let highestId = null;

    for (const notification of [...mentions].sort((a, b) => compareIds(a.id, b.id))) {
        const id = notification.id;
        const command = pendingCommand(notification, botAccountId);
        if (command) {
            const { keyword, handler, account } = command;
            try {
                // postStatus resolves to null when every attempt failed instead of throwing
                if (!(await handler(notification, leagueMatches))) throw new Error('resposta não publicada');
                cooldowns.set(account.id, Date.now());
                failedReplies.delete(id);
                mentionLogger.info({ keyword, acct: account.acct }, 'Respondido');
            } catch (err) {
                const attempts = (failedReplies.get(id) ?? 0) + 1;
                if (attempts < MAX_REPLY_ATTEMPTS) {
                    failedReplies.set(id, attempts);
                    mentionLogger.error({ acct: account.acct, attempt: attempts, maxAttempts: MAX_REPLY_ATTEMPTS, error: err.message }, 'Erro ao responder menção; nova tentativa no próximo ciclo');
                    break;
                }
                failedReplies.delete(id);
                mentionLogger.error({ acct: account.acct, attempts: MAX_REPLY_ATTEMPTS, error: err.message }, 'Menção ignorada após várias tentativas');
            }
        }
        highestId = id;
    }

    return highestId;
}

/**
 * Single poll tick: fetch new mentions and process them.
 * @param {string|null} botAccountId
 * @param {Array<{ league: Object, matches: Array }>} leagueMatches
 */
export async function pollMentions(botAccountId, leagueMatches) {
    const sinceId = getLastNotificationId();
    const mentions = await getMentions(sinceId);
    if (!mentions.length) return;

    const highestId = await processMentions(mentions, botAccountId, leagueMatches);
    if (highestId && highestId !== sinceId) {
        setLastNotificationId(highestId);
    }
}

/**
 * Start the mention polling loop on a fixed interval (independent of the match monitor's elastic loop).
 * Runs until process exit; does not block — returns immediately.
 * @param {() => Array<{ league: Object, matches: Array }>} leagueMatchesProvider
 * @returns {{ stop: () => void }}
 */
export function startMentionListener(leagueMatchesProvider) {
    if (!config.mentions.enabled) {
        mentionLogger.info('Desativado pela configuração');
        return { stop: () => {} };
    }

    _leagueMatchesProvider = leagueMatchesProvider;

    let botAccountId = null;
    let timer = null;
    let ticking = false;

    const tick = async () => {
        // A slow batch (replies wait between posts) must not overlap the next tick, which would read the
        // same cursor and answer the same mentions twice.
        if (ticking) return;
        ticking = true;
        try {
            if (!botAccountId) botAccountId = await getAccountId();
            const leagueMatches = _leagueMatchesProvider ? _leagueMatchesProvider() : [];
            await pollMentions(botAccountId, leagueMatches);
        } catch (err) {
            mentionLogger.error({ error: err.message }, 'Erro no tick');
        } finally {
            ticking = false;
        }
    };

    timer = setInterval(tick, config.mentions.pollIntervalMs);
    mentionLogger.info({ pollIntervalMs: config.mentions.pollIntervalMs }, 'Iniciado');

    return {
        stop: () => {
            if (timer) { clearInterval(timer); timer = null; }
            mentionLogger.info('Parado');
        },
    };
}
