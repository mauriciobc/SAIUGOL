/**
 * Phase 1 ready-definition guards: dead surface area gone, hot-path logging via pino,
 * event JSON dumps only at LOG_LEVEL=debug.
 */
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { processEvents } from '../src/bot/eventProcessor.js';
import { eventProcessorLogger } from '../src/utils/logger.js';
import { initI18n } from '../src/services/i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const HOT_PATH_FILES = [
    'src/bot/eventProcessor.js',
    'src/bot/matchMonitor.js',
    'src/bot/mentionListener.js',
    'src/state/matchState.js',
    'src/state/persistence.js',
    'src/bot/commentaryProcessor.js',
    'src/bot/postPlanner.js',
    'src/bot/playProcessor.js',
    'src/bot/matchThread.js',
];

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-phase1-'));
const originalStateDir = process.env.STATE_DIR;

before(async () => {
    process.env.STATE_DIR = testDir;
    await initI18n('pt-BR');
    const matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
});

describe('Phase 1 — dead code removed', () => {
    it('matchState no longer exports getLeagueId', async () => {
        const matchState = await import('../src/state/matchState.js');
        assert.strictEqual(typeof matchState.getLeagueId, 'undefined');
    });

    it('getStateStats no longer reports leagueId', async () => {
        const { getStateStats } = await import('../src/state/matchState.js');
        const stats = getStateStats();
        assert.ok(!Object.prototype.hasOwnProperty.call(stats, 'leagueId'));
        assert.ok(Object.prototype.hasOwnProperty.call(stats, 'activeMatchCount'));
    });

    it('mastodon.js does not import Readable from stream', () => {
        const src = readFileSync(join(root, 'src/api/mastodon.js'), 'utf8');
        assert.ok(!/from\s+['"]stream['"]/.test(src), 'unused Readable import must be removed');
        assert.ok(!/\bReadable\b/.test(src), 'Readable must not appear in mastodon.js');
    });

    it('espn.js does not declare unused endpoint catalog constants', () => {
        const src = readFileSync(join(root, 'src/api/espn.js'), 'utf8');
        assert.ok(!/\bESPN_DOCUMENTED_ENDPOINTS\b/.test(src));
        assert.ok(!/\bESPN_CDN_ENDPOINTS\b/.test(src));
    });

    it('matchState.js has no cachedLeagueId', () => {
        const src = readFileSync(join(root, 'src/state/matchState.js'), 'utf8');
        assert.ok(!/\bcachedLeagueId\b/.test(src));
        assert.ok(!/\bgetLeagueId\b/.test(src));
    });
});

describe('Phase 1 — hot path logging', () => {
    it('hot-path modules do not call console.log/error/warn', () => {
        for (const rel of HOT_PATH_FILES) {
            const src = readFileSync(join(root, rel), 'utf8');
            assert.ok(
                !/\bconsole\.(log|error|warn|info|debug)\b/.test(src),
                `${rel} must use pino loggers, not console.*`
            );
        }
    });
});

describe('Phase 1 — per-event dump only at LOG_LEVEL=debug', () => {
    let origBetweenPosts;
    let origGoals;

    beforeEach(() => {
        origBetweenPosts = config.delays.betweenPosts;
        origGoals = config.events.goals;
        config.delays.betweenPosts = 0;
        config.events.goals = true;
        __setClient({
            postStatus: async (text) => ({ data: { id: '1', content: text } }),
        });
    });

    afterEach(() => {
        config.delays.betweenPosts = origBetweenPosts;
        config.events.goals = origGoals;
        mock.restoreAll();
    });

    const goal = (id) => ({
        id,
        typeId: '70',
        type: 'goal',
        minute: "10'",
        description: 'Goal! Team A 1, Team B 0. Player (Team) left footed shot.',
        player: { name: 'Player' },
        teamId: '1',
    });
    const match = (id) => ({
        id,
        homeTeam: { id: '1', name: 'A' },
        awayTeam: { id: '2', name: 'B' },
        homeScore: 1,
        awayScore: 0,
        league: { hashtags: [] },
    });
    const dumps = (debugEnabled) => {
        mock.method(eventProcessorLogger, 'isLevelEnabled', (level) => level === 'debug' && debugEnabled);
        return mock.method(eventProcessorLogger, 'debug', () => {});
    };

    it('dumps every received event when the logger is at debug level', async () => {
        const debug = dumps(true);
        await processEvents([goal('dbg-1'), goal('dbg-2')], match('match-dbg-on'));
        const received = debug.mock.calls.filter((c) => c.arguments[1] === 'Evento recebido');
        assert.strictEqual(received.length, 2);
        assert.strictEqual(received[1].arguments[0].total, 2);
    });

    it('skips the dump entirely at the default level', async () => {
        const debug = dumps(false);
        await processEvents([goal('dbg-3')], match('match-dbg-off'));
        assert.strictEqual(debug.mock.calls.filter((c) => c.arguments[1] === 'Evento recebido').length, 0);
    });
});
