import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBreaker, resetAllBreakers, CircuitState } from '../src/utils/circuitBreaker.js';
import { resetMetrics, getMetrics, recordMatchProcessed, recordEventPosted, recordBotError } from '../src/utils/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('phase7 — wire metrics bot counters and ESPN circuit breaker', () => {
    beforeEach(() => {
        resetMetrics();
        resetAllBreakers();
    });

    it('espn.js must use getBreaker("espn") around outbound API calls', () => {
        const src = readFileSync(join(root, 'src/api/espn.js'), 'utf8');
        assert.ok(src.includes('circuitBreaker'), 'espn.js should import circuitBreaker');
        assert.ok(/getBreaker\(\s*['"]espn['"]/.test(src), 'espn.js should create an espn breaker');
        assert.ok(src.includes('.execute('), 'espn.js should execute calls through the breaker');
    });

    it('matchMonitor must record bot metrics and logMetrics on poll', () => {
        const src = readFileSync(join(root, 'src/bot/matchMonitor.js'), 'utf8');
        assert.ok(src.includes('recordMatchProcessed') || src.includes('recordBotError'), 'matchMonitor should record bot metrics');
        assert.ok(src.includes('logMetrics'), 'matchMonitor should call logMetrics');
        assert.ok(src.includes('recordBotError'), 'matchMonitor should record bot errors');
    });

    it('eventProcessor must recordEventPosted when a toot is posted', () => {
        const src = readFileSync(join(root, 'src/bot/eventProcessor.js'), 'utf8');
        assert.ok(src.includes('recordEventPosted'), 'eventProcessor should call recordEventPosted');
    });

    it('ESPN breaker opens after threshold failures and rejects further calls', async () => {
        // Ensure production wiring uses a shared named breaker; exercise the same registry.
        const breaker = getBreaker('espn', { failureThreshold: 2, timeoutMs: 60_000 });
        await breaker.execute(async () => { throw new Error('down'); }).catch(() => {});
        await breaker.execute(async () => { throw new Error('down'); }).catch(() => {});
        assert.strictEqual(breaker.getState().state, CircuitState.OPEN);
        await assert.rejects(
            () => breaker.execute(async () => 'ok'),
            /Circuit breaker espn is OPEN/
        );
    });

    it('bot metric helpers remain available for wired call sites', () => {
        recordMatchProcessed();
        recordEventPosted();
        recordBotError();
        const m = getMetrics();
        assert.strictEqual(m.bot.matchesProcessed, 1);
        assert.strictEqual(m.bot.eventsPosted, 1);
        assert.strictEqual(m.bot.errors, 1);
    });
});
