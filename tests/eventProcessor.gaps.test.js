import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClient } from '../src/api/mastodon.js';
import { config } from '../src/config.js';
import {
    categorizeEvent,
    processEvents,
    getMatchDelayEventId,
} from '../src/bot/eventProcessor.js';
import {
    parseDelayReason,
    formatMatchDelayStart,
    formatMatchDelayEnd,
} from '../src/bot/formatter.js';
import { initI18n } from '../src/services/i18n.js';
import { whenReady, resetStateForTesting } from '../src/state/matchState.js';

await initI18n('pt-BR');
await whenReady();

const snapshot20260707 = JSON.parse(
    readFileSync('data/match-snapshots/20260707.json', 'utf8')
);
const snapshot20260703 = JSON.parse(
    readFileSync('data/match-snapshots/20260703.json', 'utf8')
);

const argEgyMatch = snapshot20260707.matches[0];
const knockoutMatch = snapshot20260703.matches.find((m) =>
    (m.keyEvents || []).some((e) => e.typeId === '84')
);

describe('categorizeEvent — gap coverage', () => {
    it('classifies typeId 129 as MATCH_DELAY_START', () => {
        assert.strictEqual(categorizeEvent('jogo atrasado', '129'), 'MATCH_DELAY_START');
    });

    it('classifies typeId 130 as MATCH_DELAY_END', () => {
        assert.strictEqual(categorizeEvent('fim do atraso', '130'), 'MATCH_DELAY_END');
    });

    it('classifies typeId 93 as RED_CARD even with empty type text', () => {
        assert.strictEqual(categorizeEvent('', '93'), 'RED_CARD');
    });

    it('classifies typeId 138 as GOAL', () => {
        assert.strictEqual(categorizeEvent('goal - free-kick', '138'), 'GOAL');
    });

    it('classifies typeId 167 as VAR', () => {
        assert.strictEqual(categorizeEvent('var - card upgrade', '167'), 'VAR');
    });

    it('classifies typeId 83 as END_REGULAR_TIME', () => {
        assert.strictEqual(categorizeEvent('fim do tempo regulamentar', '83'), 'END_REGULAR_TIME');
    });

    it('returns null for typeId 89 even when type text is fim de jogo', () => {
        assert.strictEqual(categorizeEvent('fim de jogo', '89'), null);
    });

    it('classifies extra-time typeIds from knockout snapshot', () => {
        const byType = Object.fromEntries(
            (knockoutMatch?.keyEvents || [])
                .filter((e) => ['84', '85', '86', '87', '88'].includes(e.typeId))
                .map((e) => [e.typeId, categorizeEvent(e.type, e.typeId)])
        );
        assert.deepStrictEqual(byType, {
            '84': 'EXTRA_TIME_START',
            '85': 'EXTRA_TIME_HALF',
            '86': 'EXTRA_TIME_SECOND_HALF',
            '87': 'EXTRA_TIME_END',
            '88': 'SHOOTOUT_START',
        });
    });
});

describe('processEvents — end of regular time', () => {
    let posted = [];

    beforeEach(async () => {
        resetStateForTesting();
        await whenReady();
        posted = [];
        __setClient({
            postStatus: async (text) => {
                posted.push(text);
                return { data: { id: String(posted.length) } };
            },
        });
    });

    it('posts FIM DO 2º TEMPO for Switzerland x Colombia typeId 83', async () => {
        const match = {
            id: '760508',
            homeTeam: { id: '475', name: 'Suíça' },
            awayTeam: { id: '208', name: 'Colômbia' },
            homeScore: 0,
            awayScore: 0,
            league: { hashtags: ['#CopaDoMundo'] },
        };

        await processEvents([{
            id: '49733915',
            typeId: '83',
            type: 'fim do tempo regulamentar',
            minute: "90'+6'",
            description: 'Fim do segundo tempo, Suíça 0, Colômbia 0.',
        }], match);

        assert.strictEqual(posted.length, 1);
        assert.ok(posted[0].includes('⏱️ FIM DO 2º TEMPO!'));
        assert.ok(posted[0].includes('Suíça 0 x 0 Colômbia'));
        assert.ok(posted[0].includes("90'+6'"));
    });
});

describe('parseDelayReason', () => {
    it('detects hydration in PT', () => {
        assert.strictEqual(
            parseDelayReason('Partida interrompida devido a pausa para hidratação.'),
            'hydration'
        );
    });

    it('detects hydration in EN', () => {
        assert.strictEqual(parseDelayReason('Delay in match for a drinks break.'), 'hydration');
    });

    it('detects injury in PT', () => {
        assert.strictEqual(
            parseDelayReason('Partida interrompida devido a uma lesão Michal Sadílek (Tcheca).'),
            'injury'
        );
    });

    it('detects injury in EN', () => {
        assert.strictEqual(
            parseDelayReason('Delay in match because of an injury Michal Sadílek (Czechia).'),
            'injury'
        );
    });

    it('falls back to generic', () => {
        assert.strictEqual(parseDelayReason(''), 'generic');
    });
});

describe('formatMatchDelayStart/End', () => {
    const match = {
        homeTeam: { name: 'Argentina' },
        awayTeam: { name: 'Egito' },
        homeScore: 0,
        awayScore: 1,
        league: { hashtags: ['#CopaDoMundo'] },
    };

    it('formats hydration delay with contextual announcement', () => {
        const event = {
            minute: "23'",
            description: 'Partida interrompida devido a pausa para hidratação.',
        };
        const text = formatMatchDelayStart(event, match);
        assert.ok(text.includes('💧 PAUSA PARA HIDRATAÇÃO!'));
        assert.ok(text.includes('Argentina 0 x 1 Egito'));
        assert.ok(text.includes('23'));
    });

    it('formats injury delay with contextual announcement', () => {
        const event = {
            minute: "45'",
            description: 'Partida interrompida devido a uma lesão Michal Sadílek (Tcheca).',
        };
        const text = formatMatchDelayStart(event, match);
        assert.ok(text.includes('🏥 PARTIDA PARADA — LESÃO'));
    });

    it('formats delay end', () => {
        const event = {
            minute: "26'",
            description: 'Partida recomeça.',
        };
        const text = formatMatchDelayEnd(event, match);
        assert.ok(text.includes('▶️ PARTIDA RETOMA!'));
        assert.ok(text.includes('Argentina 0 x 1 Egito'));
    });
});

describe('getMatchDelayEventId', () => {
    it('builds stable synthetic IDs per minute and phase', () => {
        assert.strictEqual(
            getMatchDelayEventId('760509', 'MATCH_DELAY_START', "23'"),
            '760509-delay-start-23'
        );
        assert.strictEqual(
            getMatchDelayEventId('760509', 'MATCH_DELAY_END', "26'"),
            '760509-delay-end-26'
        );
    });
});

describe('processEvents — delay deduplication and posting', () => {
    let posted = [];
    let origMatchDelay;

    beforeEach(() => {
        origMatchDelay = config.events.matchDelay;
        config.events.matchDelay = true;
        posted = [];
        __setClient({
            postStatus: async (text) => {
                posted.push(text);
                return { data: { id: String(posted.length) } };
            },
        });
    });

    afterEach(() => {
        config.events.matchDelay = origMatchDelay;
    });

    it('posts only one hydration delay per minute from Argentina x Egypt snapshot', async () => {
        const delayEvents = argEgyMatch.keyEvents.filter((e) =>
            ['129', '130'].includes(e.typeId)
        );
        await processEvents(delayEvents, {
            id: argEgyMatch.id,
            homeTeam: argEgyMatch.homeTeam,
            awayTeam: argEgyMatch.awayTeam,
            homeScore: argEgyMatch.homeScore,
            awayScore: argEgyMatch.awayScore,
            league: { hashtags: argEgyMatch.leagueHashtags },
        });

        const hydrationPosts = posted.filter((t) => t.includes('💧'));
        const resumePosts = posted.filter((t) => t.includes('▶️'));
        assert.strictEqual(hydrationPosts.length, 1);
        assert.strictEqual(resumePosts.length, 2);

        // 31' delay has no ESPN description — deferred until timeout on a later poll
        const origTimeout = config.delays.delayReasonTimeoutMs;
        config.delays.delayReasonTimeoutMs = 0;
        await processEvents(
            delayEvents.filter((e) => e.minute === "31'"),
            {
                id: argEgyMatch.id,
                homeTeam: argEgyMatch.homeTeam,
                awayTeam: argEgyMatch.awayTeam,
                homeScore: argEgyMatch.homeScore,
                awayScore: argEgyMatch.awayScore,
                league: { hashtags: argEgyMatch.leagueHashtags },
            }
        );
        config.delays.delayReasonTimeoutMs = origTimeout;

        const genericDelayPosts = posted.filter((t) => t.includes('⏸️ PARTIDA PARADA'));
        assert.strictEqual(genericDelayPosts.length, 1);
        assert.ok(posted.length >= 4);
    });

    it('prefers event with description when deduplicating duplicate delay events', async () => {
        const events = [
            {
                id: 'dup-a',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "22'",
                teamId: '202',
                description: '',
            },
            {
                id: 'dup-b',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "22'",
                teamId: '2620',
                description: 'Partida interrompida devido a pausa para hidratação.',
            },
        ];

        await processEvents(events, {
            id: 'test-match',
            homeTeam: { name: 'A' },
            awayTeam: { name: 'B' },
            homeScore: 0,
            awayScore: 0,
            league: { hashtags: [] },
        });

        assert.strictEqual(posted.length, 1);
        assert.ok(posted[0].includes('💧 PAUSA PARA HIDRATAÇÃO!'));
    });

    it('waits for ESPN description when first poll only has empty delay event (Switzerland x Colombia race)', async () => {
        resetStateForTesting();
        await whenReady();

        const match = {
            id: '760508',
            homeTeam: { id: '208', name: 'Suíça' },
            awayTeam: { id: '475', name: 'Colômbia' },
            homeScore: 0,
            awayScore: 0,
            league: { hashtags: ['#CopaDoMundo'] },
        };

        await processEvents([{
            id: '49732854',
            typeId: '129',
            type: 'jogo atrasado',
            minute: "23'",
            teamId: '475',
            description: '',
        }], match);

        assert.strictEqual(posted.length, 0, 'should not post generic pause before ESPN description arrives');

        await processEvents([
            {
                id: '49732854',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "23'",
                teamId: '475',
                description: '',
            },
            {
                id: '49732853',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "23'",
                teamId: '208',
                description: 'Partida interrompida devido a pausa para hidratação.',
            },
        ], match);

        assert.strictEqual(posted.length, 1);
        assert.ok(posted[0].includes('💧 PAUSA PARA HIDRATAÇÃO!'));
        assert.ok(!posted[0].includes('⏸️ PARTIDA PARADA'));
    });

    it('posts generic delay after timeout when ESPN never sends description', async () => {
        resetStateForTesting();
        await whenReady();

        const origTimeout = config.delays.delayReasonTimeoutMs;
        config.delays.delayReasonTimeoutMs = 0;

        try {
            const match = {
                id: '760508',
                homeTeam: { name: 'Suíça' },
                awayTeam: { name: 'Colômbia' },
                homeScore: 0,
                awayScore: 0,
                league: { hashtags: [] },
            };

            await processEvents([{
                id: '49733104',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "40'",
                teamId: '208',
                description: '',
            }], match);

            assert.strictEqual(posted.length, 0, 'first poll defers posting without description');

            await processEvents([{
                id: '49733104',
                typeId: '129',
                type: 'jogo atrasado',
                minute: "40'",
                teamId: '208',
                description: '',
            }], match);

            assert.strictEqual(posted.length, 1);
            assert.ok(posted[0].includes('⏸️ PARTIDA PARADA'));
        } finally {
            config.delays.delayReasonTimeoutMs = origTimeout;
        }
    });
});

describe('snapshot typeId coverage', () => {
    it('every typeId in 20260703 and 20260707 snapshots is categorized or explicitly skipped', () => {
        const skip = new Set(['89']);
        const snapshots = [snapshot20260703, snapshot20260707];
        const typeIds = new Set();

        for (const snap of snapshots) {
            for (const m of snap.matches || []) {
                for (const ev of m.keyEvents || []) {
                    typeIds.add(String(ev.typeId));
                }
            }
        }

        for (const typeId of typeIds) {
            if (skip.has(typeId)) continue;
            const sample = snapshots
                .flatMap((s) => s.matches)
                .flatMap((m) => m.keyEvents)
                .find((e) => String(e.typeId) === typeId);
            const category = categorizeEvent(sample.type, sample.typeId);
            assert.ok(category, `typeId ${typeId} should be categorized`);
        }
    });
});
