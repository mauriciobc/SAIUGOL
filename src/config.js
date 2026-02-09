import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { leagues } from './data/leagues.js';

/**
 * Resolve access token from env var, _FILE path, or Docker secret path.
 * @returns {string|undefined} Token or undefined if not found
 */
function resolveAccessToken() {
    const fromEnv = process.env.MASTODON_ACCESS_TOKEN;
    if (fromEnv && fromEnv.length >= 10) return fromEnv;

    const filePath = process.env.MASTODON_ACCESS_TOKEN_FILE;
    if (filePath && existsSync(filePath)) {
        try {
            const value = readFileSync(filePath, 'utf8').trim();
            if (value.length >= 10) return value;
        } catch {
            // fall through to secret path
        }
    }

    const secretPath = '/run/secrets/mastodon_access_token';
    if (existsSync(secretPath)) {
        try {
            const value = readFileSync(secretPath, 'utf8').trim();
            if (value.length >= 10) return value;
        } catch {
            // fall through
        }
    }

    return undefined;
}

/**
 * Parse and validate a numeric environment variable
 * @param {string} value - The raw environment value
 * @param {number} defaultValue - Default value if parsing fails
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} Validated numeric value
 */
function parseEnvInt(value, defaultValue, min = 0, max = Infinity) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(parsed, max));
}

/** Resolved token for config (validated once). */
let resolvedToken;

/**
 * Validate configuration
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
    const errors = [];

    resolvedToken = resolveAccessToken();
    if (!resolvedToken) {
        errors.push(
            'MASTODON_ACCESS_TOKEN is required. Set the env var, or MASTODON_ACCESS_TOKEN_FILE, ' +
            'or add a Docker secret "mastodon_access_token". See .env.example for local dev.'
        );
    } else if (resolvedToken.length < 10) {
        errors.push('MASTODON_ACCESS_TOKEN appears to be invalid (too short)');
    }

    const pollInterval = parseEnvInt(process.env.POLL_INTERVAL_MS, 60000, 10000);
    if (pollInterval < 10000 || pollInterval > 300000) {
        errors.push('POLL_INTERVAL_MS must be between 10000 and 300000 milliseconds');
    }

    const timeout = parseEnvInt(process.env.REQUEST_TIMEOUT_MS, 10000, 1000, 60000);
    if (timeout < 1000 || timeout > 60000) {
        errors.push('REQUEST_TIMEOUT_MS must be between 1000 and 60000 milliseconds');
    }

    const retryMax = parseEnvInt(process.env.RETRY_MAX_ATTEMPTS, 3, 1, 10);
    if (retryMax < 1 || retryMax > 10) {
        errors.push('RETRY_MAX_ATTEMPTS must be between 1 and 10');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}

// Resolve league configuration
const leagueCodesStr = process.env.LEAGUE_CODES || process.env.LEAGUE_CODE || 'bra.1';
const leagueCodes = leagueCodesStr.split(',').map(s => s.trim()).filter(Boolean);

const activeLeagues = [];
const configErrors = [];

if (leagueCodes.length === 0) {
    configErrors.push(`LEAGUE_CODES must specify at least one valid league; supported: ${Object.keys(leagues).join(', ')}`);
} else {
    for (const code of leagueCodes) {
        const leagueData = leagues[code];
        if (!leagueData) {
            configErrors.push(`Invalid league code: ${code}. Supported: ${Object.keys(leagues).join(', ')}`);
        } else {
            activeLeagues.push({
                code: code,
                ...leagueData
            });
        }
    }
}

if (configErrors.length > 0) {
    throw new Error(`Configuration Validation Failed:\n${configErrors.join('\n')}`);
}

validateConfig();

export const config = {
    mastodon: {
        instance: process.env.MASTODON_INSTANCE || 'https://mastodon.social',
        accessToken: resolvedToken,
    },
    // ESPN API configuration
    espn: {
        baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
        requestTimeoutMs: 10000, // Request timeout
    },
    // Active leagues to monitor
    activeLeagues: activeLeagues,

    // Response caching configuration
    cache: {
        scoreboardTtlMs: parseEnvInt(process.env.CACHE_SCOREBOARD_TTL_MS, 30000, 5000),
        detailsTtlMs: parseEnvInt(process.env.CACHE_DETAILS_TTL_MS, 60000, 5000),
        eventsTtlMs: parseEnvInt(process.env.CACHE_EVENTS_TTL_MS, 30000, 5000),
        highlightsTtlMs: parseEnvInt(process.env.CACHE_HIGHLIGHTS_TTL_MS, 120000, 10000),
    },
    bot: {
        pollIntervalMs: parseEnvInt(process.env.POLL_INTERVAL_MS, 60000, 10000),
        dryRun: process.env.DRY_RUN === 'true',
        pollIntervalLiveMs: parseEnvInt(process.env.POLL_INTERVAL_LIVE_MS, 60000, 10000),
        pollIntervalAlertMs: parseEnvInt(process.env.POLL_INTERVAL_ALERT_MS, 120000, 30000),
        pollIntervalHibernationMs: parseEnvInt(process.env.POLL_INTERVAL_HIBERNATION_MS, 1800000, 300000),
        favoriteTeamIds: (process.env.FAVORITE_TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
        favoriteTeamNames: (process.env.FAVORITE_TEAM_NAMES || '').split(',').map(s => s.trim()).filter(Boolean),
    },
    // Timing delays (milliseconds)
    delays: {
        betweenPosts: parseEnvInt(process.env.DELAY_BETWEEN_POSTS_MS, 2000, 500),
        betweenThreadPosts: parseEnvInt(process.env.DELAY_BETWEEN_THREAD_POSTS_MS, 1000, 500),
        beforeHighlights: parseEnvInt(process.env.DELAY_BEFORE_HIGHLIGHTS_MS, 30000, 5000),
        statePersistence: parseEnvInt(process.env.STATE_SAVE_INTERVAL_MS, 300000, 60000),
    },
    // Retry configuration for API calls
    retry: {
        maxAttempts: parseEnvInt(process.env.RETRY_MAX_ATTEMPTS, 3, 1, 10),
        initialDelayMs: parseEnvInt(process.env.RETRY_INITIAL_DELAY_MS, 1000, 100),
        maxDelayMs: parseEnvInt(process.env.RETRY_MAX_DELAY_MS, 10000, 1000),
    },
    // Event types to post
    events: {
        goals: true,
        yellowCards: true,
        redCards: true,
        substitutions: true,
        varReviews: true,
        matchStart: true,
        matchEnd: true,
    },
    // Internationalization configuration
    i18n: {
        defaultLanguage: process.env.DEFAULT_LANGUAGE || 'pt-BR',
    },
};
