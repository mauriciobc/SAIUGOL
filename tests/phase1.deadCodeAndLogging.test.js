/**
 * Phase 1 ready-definition guards: dead surface area gone, hot-path logging via pino,
 * event JSON dumps gated by DEBUG_EVENTS.
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import { processEvents, isEventDebugEnabled } from '../src/bot/eventProcessor.js';
import { initI18n } from '../src/services/i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const HOT_PATH_FILES = [
    'src/bot/eventProcessor.js',
    'src/bot/matchMonitor.js',
    'src/bot/mentionListener.js',
    'src/state/matchState.js',
    'src/state/persistence.js',
];

const testDir = mkdtempSync(join(tmpdir(), 'saiugol-phase1-'));
const originalStateDir = process.env.STATE_DIR;
const originalDebugEvents = process.env.DEBUG_EVENTS;

before(async () => {
    process.env.STATE_DIR = testDir;
    delete process.env.DEBUG_EVENTS;
    await initI18n('pt-BR');
    const matchState = await import('../src/state/matchState.js');
    matchState.resetStateForTesting();
    await matchState.whenReady();
});

after(() => {
    if (originalStateDir !== undefined) process.env.STATE_DIR = originalStateDir;
    else delete process.env.STATE_DIR;
    if (originalDebugEvents !== undefined) process.env.DEBUG_EVENTS = originalDebugEvents;
    else delete process.env.DEBUG_EVENTS;
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

    it('isEventDebugEnabled is true only when DEBUG_EVENTS=true', () => {
        assert.strictEqual(isEventDebugEnabled({}), false);
        assert.strictEqual(isEventDebugEnabled({ DEBUG_EVENTS: 'false' }), false);
        assert.strictEqual(isEventDebugEnabled({ DEBUG_EVENTS: 'true' }), true);
    });
});

describe('Phase 1 — processEvents does not spam console', () => {
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
        delete process.env.DEBUG_EVENTS;
    });

    it('processEvents does not write to console.log by default', async () => {
        let consoleCalls = 0;
        const origLog = console.log;
        console.log = () => {
            consoleCalls++;
        };
        try {
            await processEvents(
                [{
                    id: 'dbg-1',
                    typeId: '70',
                    type: 'goal',
                    minute: "10'",
                    description: 'Goal! Team A 1, Team B 0. Player (Team) left footed shot.',
                    player: { name: 'Player' },
                    teamId: '1',
                }],
                {
                    id: 'match-dbg',
                    homeTeam: { id: '1', name: 'A' },
                    awayTeam: { id: '2', name: 'B' },
                    homeScore: 1,
                    awayScore: 0,
                    league: { hashtags: [] },
                }
            );
        } finally {
            console.log = origLog;
        }
        assert.strictEqual(consoleCalls, 0, 'event dumps must not use console.log');
    });
});
