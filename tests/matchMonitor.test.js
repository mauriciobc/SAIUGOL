import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeNextIntervalMs } from '../src/bot/matchMonitor.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const botConfig = {
    pollIntervalLiveMs: 60 * 1000,
    pollIntervalAlertMs: 120 * 1000,
    pollIntervalHibernationMs: 30 * MIN,
    pollWindowBeforeMatchMs: 10 * MIN,
    pollScheduleRefreshMaxMs: 1 * HOUR,
};

describe('computeNextIntervalMs', () => {
    it('retorna pollIntervalLiveMs quando há partida ao vivo', () => {
        const now = Date.now();
        const next = computeNextIntervalMs(true, true, [now + 2 * HOUR], now, botConfig);
        assert.strictEqual(next, botConfig.pollIntervalLiveMs);
    });

    it('retorna pollIntervalAlertMs quando há pre sem startTime', () => {
        const now = Date.now();
        const next = computeNextIntervalMs(false, true, [], now, botConfig);
        assert.strictEqual(next, botConfig.pollIntervalAlertMs);
    });

    it('retorna pollIntervalHibernationMs quando não há live nem pre', () => {
        const now = Date.now();
        const next = computeNextIntervalMs(false, false, [], now, botConfig);
        assert.strictEqual(next, botConfig.pollIntervalHibernationMs);
    });

    it('retorna ~5 min quando partida pre é em 15 min (timeslot 10 min antes)', () => {
        const now = Date.now();
        const matchIn15Min = now + 15 * MIN;
        const next = computeNextIntervalMs(false, true, [matchIn15Min], now, botConfig);
        const expected = 5 * MIN;
        assert.ok(next >= expected - 1000 && next <= expected + 1000, `next=${next} expected ~${expected}`);
    });

    it('retorna pollIntervalAlertMs quando partida pre é em 5 min (já na janela)', () => {
        const now = Date.now();
        const matchIn5Min = now + 5 * MIN;
        const next = computeNextIntervalMs(false, true, [matchIn5Min], now, botConfig);
        assert.strictEqual(next, botConfig.pollIntervalAlertMs);
    });

    it('retorna no máximo min(hibernation, scheduleRefresh) quando partida pre é em 3h', () => {
        const now = Date.now();
        const matchIn3h = now + 3 * HOUR;
        const next = computeNextIntervalMs(false, true, [matchIn3h], now, botConfig);
        const maxCap = Math.min(botConfig.pollIntervalHibernationMs, botConfig.pollScheduleRefreshMaxMs);
        assert.strictEqual(next, maxCap);
        assert.ok(next <= botConfig.pollScheduleRefreshMaxMs, 'nunca ultrapassa refresh de 1h');
    });

    it('retorna wakeInMs quando partida é em 20 min (10 min antes = 10 min, menor que os caps)', () => {
        const now = Date.now();
        const matchIn20Min = now + 20 * MIN;
        const next = computeNextIntervalMs(false, true, [matchIn20Min], now, botConfig);
        const wakeInMs = matchIn20Min - 10 * MIN - now;
        assert.strictEqual(next, wakeInMs);
        assert.strictEqual(next, 10 * MIN);
    });
});
