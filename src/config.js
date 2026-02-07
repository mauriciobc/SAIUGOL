import 'dotenv/config';

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

/**
 * Validate configuration
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
    const errors = [];

    if (!process.env.MASTODON_ACCESS_TOKEN) {
        errors.push(
            'MASTODON_ACCESS_TOKEN environment variable is required. ' +
            'Local: set it in .env (see .env.example). ' +
            'Production/Docker: set it in your deployment platform\'s Environment Variables (e.g. Railway, Render).'
        );
    } else if (process.env.MASTODON_ACCESS_TOKEN.length < 10) {
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

validateConfig();

export const config = {
    mastodon: {
        instance: process.env.MASTODON_INSTANCE || 'https://mastodon.social',
        accessToken: process.env.MASTODON_ACCESS_TOKEN,
    },
    // ESPN API configuration (No key required)
    // Note: Currently hardcoded to Brasileirão Serie A (bra.1)
    espn: {
        baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
        league: 'bra.1', // Brasileirão Serie A
        requestTimeoutMs: 10000, // Request timeout
    },
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
        // Brasileirão Serie A identifiers
        countryCode: 'BR',
        leagueName: 'Serie A',
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
    // Hashtags for posts
    hashtags: ['#Brasileirão', '#SerieA', '#FutebolBrasileiro'],
};
