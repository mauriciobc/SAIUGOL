import pino from 'pino';
import { config } from '../config.js';

const isTest = process.env.NODE_ENV === 'test';

export const logger = pino({
    level: isTest ? 'silent' : (process.env.LOG_LEVEL || 'info'),
    transport: isTest ? undefined : {
        target: 'pino/file',
        options: { destination: 1 },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => {
            return { level: label };
        },
    },
    base: {
        service: 'saiugol-bot',
        env: process.env.NODE_ENV || 'development',
    },
});

export function createChild(bindings) {
    return logger.child(bindings);
}

export const espnLogger = createChild({ component: 'espn-api' });
export const mastodonLogger = createChild({ component: 'mastodon-api' });
export const botLogger = createChild({ component: 'bot' });
export const cacheLogger = createChild({ component: 'cache' });
