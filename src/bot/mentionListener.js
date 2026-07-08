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
    await postStatus(text, { inReplyToId: mention.status.id });
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
 * Process a batch of mention notifications.
 * Skips the bot's own account, bot accounts, and accounts on cooldown.
 * @param {Array} mentions - Megalodon notification objects (type === 'mention')
 * @param {string|null} botAccountId - The bot's own account id
 * @param {Array<{ league: Object, matches: Array }>} leagueMatches
 * @returns {Promise<string|null>} The highest notification id seen, or null
 */
export async function processMentions(mentions, botAccountId, leagueMatches) {
    if (!mentions.length) return null;

    let highestId = null;

    for (const notification of mentions) {
        const id = notification.id;
        // Mastodon IDs are numeric snowflakes; compare as BigInt to avoid lexicographic misordering.
        // Fall back to string comparison for non-numeric IDs (e.g. in tests).
        const isNumeric = /^\d+$/.test(id) && /^\d+$/.test(highestId ?? '0');
        const greater = isNumeric ? BigInt(id) > BigInt(highestId ?? '0') : id > (highestId ?? '');
        if (!highestId || greater) highestId = id;

        const account = notification.account;
        if (!account) continue;

        // Skip own posts
        if (botAccountId && String(account.id) === String(botAccountId)) continue;

        // Skip bot accounts
        if (account.bot) continue;

        const keyword = parseCommand(notification.status?.content || '');
        if (!keyword) continue;

        const handler = COMMANDS[keyword];
        if (!handler) continue;

        // Enforce per-account cooldown
        const last = cooldowns.get(account.id) ?? 0;
        if (Date.now() - last < config.mentions.cooldownMs) {
            continue;
        }

        try {
            await handler(notification, leagueMatches);
            cooldowns.set(account.id, Date.now());
            mentionLogger.info({ keyword, acct: account.acct }, 'Respondido');
        } catch (err) {
            mentionLogger.error({ acct: account.acct, error: err.message }, 'Erro ao responder menção');
        }
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

    const tick = async () => {
        try {
            if (!botAccountId) botAccountId = await getAccountId();
            const leagueMatches = _leagueMatchesProvider ? _leagueMatchesProvider() : [];
            await pollMentions(botAccountId, leagueMatches);
        } catch (err) {
            mentionLogger.error({ error: err.message }, 'Erro no tick');
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
