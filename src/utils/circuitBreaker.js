import { createChild } from './logger.js';

const circuitLogger = createChild({ component: 'circuit-breaker' });

const CircuitState = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
};

const defaultOptions = {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 30000,
    halfOpenMaxCalls: 3,
};

class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.options = { ...defaultOptions, ...options };
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.halfOpenCallCount = 0;
    }

    async execute(fn) {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime >= this.options.timeoutMs) {
                this.transitionTo(CircuitState.HALF_OPEN);
            } else {
                circuitLogger.warn({ breaker: this.name, state: this.state }, 'Circuit breaker is OPEN, rejecting call');
                throw new Error(`Circuit breaker ${this.name} is OPEN`);
            }
        }

        if (this.state === CircuitState.HALF_OPEN) {
            if (this.halfOpenCallCount >= this.options.halfOpenMaxCalls) {
                circuitLogger.warn({ breaker: this.name }, 'Circuit breaker HALF_OPEN max calls reached');
                throw new Error(`Circuit breaker ${this.name} is HALF_OPEN and max calls reached`);
            }
            this.halfOpenCallCount++;
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    onSuccess() {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            circuitLogger.info({ breaker: this.name, successCount: this.successCount }, 'HALF_OPEN success');
            if (this.successCount >= this.options.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
            }
        } else {
            this.failureCount = 0;
        }
    }

    onFailure(error) {
        this.lastFailureTime = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            circuitLogger.error({ breaker: this.name, error: error.message }, 'HALF_OPEN failure, opening circuit');
            this.transitionTo(CircuitState.OPEN);
        } else {
            this.failureCount++;
            circuitLogger.warn({ breaker: this.name, failureCount: this.failureCount, threshold: this.options.failureThreshold }, 'Circuit breaker failure');
            if (this.failureCount >= this.options.failureThreshold) {
                circuitLogger.error({ breaker: this.name }, 'Circuit breaker threshold reached, opening circuit');
                this.transitionTo(CircuitState.OPEN);
            }
        }
    }

    transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenCallCount = 0;

        circuitLogger.info({ breaker: this.name, oldState, newState }, 'Circuit breaker state transition');

        if (newState === CircuitState.CLOSED) {
            circuitLogger.info({ breaker: this.name }, 'Circuit breaker CLOSED - normal operation');
        } else if (newState === CircuitState.OPEN) {
            circuitLogger.warn({ breaker: this.name, timeoutMs: this.options.timeoutMs }, 'Circuit breaker OPEN - rejecting calls');
        } else if (newState === CircuitState.HALF_OPEN) {
            circuitLogger.info({ breaker: this.name, maxCalls: this.options.halfOpenMaxCalls }, 'Circuit breaker HALF_OPEN - testing');
        }
    }

    getState() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
        };
    }

    reset() {
        this.transitionTo(CircuitState.CLOSED);
    }
}

const breakers = new Map();

export function getBreaker(name, options = {}) {
    if (!breakers.has(name)) {
        breakers.set(name, new CircuitBreaker(name, options));
    }
    return breakers.get(name);
}

export function resetAllBreakers() {
    for (const breaker of breakers.values()) {
        breaker.reset();
    }
    circuitLogger.info('All circuit breakers reset');
}

export function getAllBreakersState() {
    const states = {};
    for (const [name, breaker] of breakers) {
        states[name] = breaker.getState();
    }
    return states;
}

export { CircuitBreaker, CircuitState };
