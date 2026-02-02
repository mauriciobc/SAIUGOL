import { config } from '../config.js';
import { createChild } from './logger.js';

const retryLogger = createChild({ component: 'retry' });

/**
 * Sleep for a given duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts
 * @param {number} options.initialDelay - Initial delay in ms
 * @param {number} options.maxDelay - Maximum delay in ms
 * @param {Function} options.shouldRetry - Function to determine if error is retryable
 * @param {string} options.operationName - Name for logging
 * @returns {Promise<any>} Result of successful function call
 */
export async function retryWithBackoff(fn, options = {}) {
    const {
        maxAttempts = config.retry.maxAttempts,
        initialDelay = config.retry.initialDelayMs,
        maxDelay = config.retry.maxDelayMs,
        shouldRetry = () => true,
        operationName = 'operation',
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry on last attempt
            if (attempt === maxAttempts) {
                break;
            }

            // Check if error is retryable
            if (!shouldRetry(error)) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                initialDelay * Math.pow(2, attempt - 1),
                maxDelay
            );

            retryLogger.warn(
                { operationName, attempt, maxAttempts, delayMs: delay, error: error.message },
                `${operationName} falhou, retrying`
            );

            await sleep(delay);
        }
    }

    // All attempts failed
    retryLogger.error({ operationName, maxAttempts, error: lastError.message }, `${operationName} falhou após ${maxAttempts} tentativas`);
    throw new Error(
        `${operationName} falhou após ${maxAttempts} tentativas: ${lastError.message}`
    );
}

/**
 * Determine if an HTTP error is retryable
 * @param {Error} error - Error to check
 * @returns {boolean} True if retryable
 */
export function isRetryableError(error) {
    // Network errors are retryable
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET') {
        return true;
    }

    // HTTP 5xx errors are retryable
    if (error.response && error.response.status >= 500) {
        return true;
    }

    // HTTP 429 (rate limit) is retryable
    if (error.response && error.response.status === 429) {
        return true;
    }

    // HTTP 4xx errors (except 429) are not retryable - client errors
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
        return false;
    }

    // Unknown errors - retry
    return true;
}
