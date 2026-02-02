import { createChild } from './logger.js';

const metricsLogger = createChild({ component: 'metrics' });

const metrics = {
    espn: {
        requests: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        cacheHits: 0,
        cacheMisses: 0,
    },
    mastodon: {
        posts: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
    },
    bot: {
        matchesProcessed: 0,
        eventsPosted: 0,
        errors: 0,
    },
};

export function recordEspnRequest(success, latencyMs, fromCache = false) {
    metrics.espn.requests++;
    metrics.espn.totalLatencyMs += latencyMs;
    if (fromCache) {
        metrics.espn.cacheHits++;
    } else {
        metrics.espn.cacheMisses++;
    }
    if (success) {
        metrics.espn.successes++;
    } else {
        metrics.espn.failures++;
    }
}

export function recordMastodonPost(success, latencyMs) {
    metrics.mastodon.posts++;
    metrics.mastodon.totalLatencyMs += latencyMs;
    if (success) {
        metrics.mastodon.successes++;
    } else {
        metrics.mastodon.failures++;
    }
}

export function recordMatchProcessed() {
    metrics.bot.matchesProcessed++;
}

export function recordEventPosted() {
    metrics.bot.eventsPosted++;
}

export function recordBotError() {
    metrics.bot.errors++;
}

export function getMetrics() {
    const espnAvgLatency = metrics.espn.requests > 0
        ? Math.round(metrics.espn.totalLatencyMs / metrics.espn.requests)
        : 0;
    const mastodonAvgLatency = metrics.mastodon.posts > 0
        ? Math.round(metrics.mastodon.totalLatencyMs / metrics.mastodon.posts)
        : 0;
    const espnSuccessRate = metrics.espn.requests > 0
        ? Math.round((metrics.espn.successes / metrics.espn.requests) * 100)
        : 100;
    const mastodonSuccessRate = metrics.mastodon.posts > 0
        ? Math.round((metrics.mastodon.successes / metrics.mastodon.posts) * 100)
        : 100;

    return {
        espn: {
            requests: metrics.espn.requests,
            cacheHits: metrics.espn.cacheHits,
            cacheMisses: metrics.espn.cacheMisses,
            successRate: espnSuccessRate,
            avgLatencyMs: espnAvgLatency,
        },
        mastodon: {
            posts: metrics.mastodon.posts,
            successRate: mastodonSuccessRate,
            avgLatencyMs: mastodonAvgLatency,
        },
        bot: {
            matchesProcessed: metrics.bot.matchesProcessed,
            eventsPosted: metrics.bot.eventsPosted,
            errors: metrics.bot.errors,
        },
    };
}

export function logMetrics() {
    const currentMetrics = getMetrics();
    metricsLogger.info(currentMetrics, 'Métricas do bot');
}

export function resetMetrics() {
    metrics.espn.requests = 0;
    metrics.espn.successes = 0;
    metrics.espn.failures = 0;
    metrics.espn.totalLatencyMs = 0;
    metrics.espn.cacheHits = 0;
    metrics.espn.cacheMisses = 0;
    metrics.mastodon.posts = 0;
    metrics.mastodon.successes = 0;
    metrics.mastodon.failures = 0;
    metrics.mastodon.totalLatencyMs = 0;
    metrics.bot.matchesProcessed = 0;
    metrics.bot.eventsPosted = 0;
    metrics.bot.errors = 0;
}

export function getApiMetrics() {
    return { ...metrics };
}
