import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
    getEnhancedPlayEventId,
    filterEnhancedPlays,
    categoryFromTypeId,
    markExistingPlaysAsSeen,
    processEnhancedPlays,
} from '../src/bot/playProcessor.js';
import { normalizePlay } from '../src/api/espn.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    isEventPosted,
    markEventPosted,
    getEnhancedPlayPostCount,
    clearMatchState,
} from '../src/state/matchState.js';
import { initI18n } from '../src/services/i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleRaw = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/plays-bra1-sample.json'), 'utf8')
);
const samplePlays = sampleRaw.map(normalizePlay).filter((p) => p.id);

const defaultOpts = {
    typeIds: new Set(['106', '117', '77']),
    requirePriority: true,
    maxPerMatch: 12,
    isPosted: () => false,
    postedCountSoFar: 0,
};

describe('getEnhancedPlayEventId', () => {
    it('builds prefixed composite id', () => {
        assert.strictEqual(getEnhancedPlayEventId('123', '456'), 'play-123-456');
    });
});

describe('categoryFromTypeId', () => {
    it('maps known type ids', () => {
        assert.strictEqual(categoryFromTypeId('106'), 'SHOT_ON_TARGET');
        assert.strictEqual(categoryFromTypeId('117'), 'SHOT_OFF_TARGET');
        assert.strictEqual(categoryFromTypeId('77'), 'SAVE');
        assert.strictEqual(categoryFromTypeId('118'), null);
    });
});

describe('filterEnhancedPlays', () => {
    it('keeps only allowlisted typeIds', () => {
        const result = filterEnhancedPlays(samplePlays, {
            ...defaultOpts,
            requirePriority: false,
        });
        const ids = result.map((p) => p.typeId);
        assert.ok(ids.includes('106'));
        assert.ok(ids.includes('117'));
        assert.ok(ids.includes('77'));
        assert.ok(!ids.includes('118'));
        assert.ok(!ids.includes('135'));
        assert.ok(!ids.includes('70'));
    });

    it('filters by priority when requirePriority is true', () => {
        const result = filterEnhancedPlays(samplePlays, defaultOpts);
        const ids = result.map((p) => p.typeId);
        assert.ok(ids.includes('106'));
        assert.ok(ids.includes('117'));
        assert.ok(!ids.includes('77'), 'save has priority=false');
    });

    it('skips scoringPlay', () => {
        const withGoal = filterEnhancedPlays(samplePlays, {
            ...defaultOpts,
            typeIds: new Set(['70', '106', '117', '77']),
            requirePriority: false,
        });
        assert.ok(!withGoal.some((p) => p.typeId === '70'));
    });

    it('skips already posted', () => {
        const posted = new Set(['play-m1-49824812']);
        const result = filterEnhancedPlays(samplePlays, {
            ...defaultOpts,
            requirePriority: false,
            isPosted: (id) => posted.has(id),
            matchId: 'm1',
        });
        assert.ok(!result.some((p) => p.id === '49824812'));
    });

    it('respects maxPerMatch minus postedCountSoFar', () => {
        const result = filterEnhancedPlays(samplePlays, {
            ...defaultOpts,
            requirePriority: false,
            maxPerMatch: 12,
            postedCountSoFar: 11,
        });
        assert.strictEqual(result.length, 1);
    });

    it('returns empty when cap already reached', () => {
        const result = filterEnhancedPlays(samplePlays, {
            ...defaultOpts,
            requirePriority: false,
            postedCountSoFar: 12,
            maxPerMatch: 12,
        });
        assert.strictEqual(result.length, 0);
    });

    it('sorts by period then clock value', () => {
        const shuffled = [
            samplePlays.find((p) => p.typeId === '106'),
            samplePlays.find((p) => p.typeId === '117'),
        ];
        const result = filterEnhancedPlays(shuffled, defaultOpts);
        assert.strictEqual(result[0].typeId, '117');
        assert.strictEqual(result[1].typeId, '106');
    });
});

describe('markExistingPlaysAsSeen', () => {
    beforeEach(() => {
        clearMatchState('m-seen');
    });

    it('marks allowlisted plays without regard to priority', () => {
        // markExisting should mark all that would ever be postable (allowlist, not scoring)
        markExistingPlaysAsSeen('m-seen', samplePlays, {
            typeIds: new Set(['106', '117', '77']),
        });
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-seen', '49824812')));
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-seen', '49825560')));
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-seen', '49824882')));
        assert.ok(!isEventPosted(getEnhancedPlayEventId('m-seen', '49824724'))); // pass
        assert.ok(!isEventPosted(getEnhancedPlayEventId('m-seen', 'goal-play-1'))); // scoring
    });
});

describe('processEnhancedPlays', () => {
    beforeEach(() => {
        initI18n('pt-BR');
        clearMatchState('m-proc');
    });

    it('posts filtered plays and increments counter', async () => {
        const posted = [];
        const postStatus = mock.fn(async (text) => {
            posted.push(text);
            return { id: `status-${posted.length}` };
        });

        const match = {
            id: 'm-proc',
            homeTeam: { name: 'Bahia' },
            awayTeam: { name: 'Chapecoense' },
            homeScore: 1,
            awayScore: 0,
            league: { hashtags: ['#Brasileirao'] },
        };

        const count = await processEnhancedPlays(samplePlays, match, {
            postStatus,
            typeIds: new Set(['106', '117', '77']),
            requirePriority: true,
            maxPerMatch: 12,
            canPost: () => true,
        });

        assert.strictEqual(count, 2); // 117 and 106 priority; 77 not
        assert.strictEqual(posted.length, 2);
        assert.strictEqual(getEnhancedPlayPostCount('m-proc'), 2);
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-proc', '49824812')));
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-proc', '49825560')));
    });

    it('does not mark when postStatus returns null', async () => {
        const postStatus = mock.fn(async () => null);
        const match = {
            id: 'm-proc',
            homeTeam: { name: 'A' },
            awayTeam: { name: 'B' },
            homeScore: 0,
            awayScore: 0,
            league: { hashtags: [] },
        };
        const count = await processEnhancedPlays(samplePlays, match, {
            postStatus,
            typeIds: new Set(['117']),
            requirePriority: true,
            maxPerMatch: 12,
            canPost: () => true,
        });
        assert.strictEqual(count, 0);
        assert.ok(!isEventPosted(getEnhancedPlayEventId('m-proc', '49824812')));
    });

    it('drops plays the day plan has no room for, without posting them late', async () => {
        const postStatus = mock.fn(async () => ({ id: 'x' }));
        const match = { id: 'm-crowded', homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, homeScore: 0, awayScore: 0, league: { hashtags: [] } };
        const deps = { postStatus, typeIds: new Set(['117']), requirePriority: true, maxPerMatch: 12, canPost: () => false };

        assert.strictEqual(await processEnhancedPlays(samplePlays, match, deps), 0);
        assert.strictEqual(postStatus.mock.callCount(), 0);
        assert.ok(isEventPosted(getEnhancedPlayEventId('m-crowded', '49824812')));

        deps.canPost = () => true;
        assert.strictEqual(await processEnhancedPlays(samplePlays, match, deps), 0);
    });
});
