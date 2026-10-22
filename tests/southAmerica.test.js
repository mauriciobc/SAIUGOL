import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/espn-south-america.json'), 'utf8')
);

// espn.js builds its axios instance at import time, so the stub must be installed before importing it.
// Routes are matched by URL substring; anything else fails like an ESPN 404.
const routes = new Map();
const requested = [];
mock.method(axios, 'create', () => ({
    get: async (url) => {
        requested.push(url);
        for (const [fragment, data] of routes) {
            if (url.includes(fragment)) return { data };
        }
        throw Object.assign(new Error(`unexpected url ${url}`), { response: { status: 404 } });
    },
}));

const { getMatchDetails, getMatchPlays, getTodayMatches, parseTie } = await import('../src/api/espn.js');
const { formatMatchEnd, formatMatchStart, formatMatchPreview } = await import('../src/bot/formatter.js');
const { leagues } = await import('../src/data/leagues.js');

const comp = (summary) => summary.header.competitions[0];

describe('South American leagues', () => {
    for (const code of [
        'bra.1', 'bra.2', 'bra.copa_do_brazil', 'bra.supercopa_do_brazil',
        'bra.camp.paulista', 'bra.camp.carioca', 'bra.camp.mineiro', 'bra.camp.gaucho',
        'conmebol.libertadores', 'conmebol.sudamericana',
    ]) {
        it(`supports ${code}`, () => {
            const league = leagues[code];
            assert.ok(league, `${code} missing from leagues.js`);
            assert.ok(league.name);
            assert.ok(league.countryCode);
            assert.ok(league.hashtags.length > 0);
        });
    }
});

describe('parseTie', () => {
    it('reads the scoreboard shape (series object) before a 2nd leg', () => {
        const tie = parseTie(fixture.libertadoresSecondLegScoreboardCompetition);
        assert.deepStrictEqual(tie, {
            leg: 2,
            totalLegs: 2,
            title: 'Semifinals',
            homeAggregate: 0,
            awayAggregate: 0,
            completed: false,
            winnerTeamId: undefined,
        });
    });

    it('reads the summary header shape (series array) after a decided 2nd leg', () => {
        const tie = parseTie(comp(fixture.sudamericanaSecondLegSummary));
        assert.strictEqual(tie.leg, 2);
        assert.strictEqual(tie.homeAggregate, 2);
        assert.strictEqual(tie.awayAggregate, 3);
        assert.strictEqual(tie.completed, true);
        assert.strictEqual(tie.winnerTeamId, '7632');
    });

    it('reads a 1st leg', () => {
        const tie = parseTie(comp(fixture.copaDoBrasilFirstLegSummary));
        assert.strictEqual(tie.leg, 1);
        assert.strictEqual(tie.totalLegs, 2);
        assert.strictEqual(tie.completed, false);
    });

    it('returns undefined for single-match fixtures', () => {
        assert.strictEqual(parseTie(comp(fixture.bra2SummaryWithStandings)), undefined);
        assert.strictEqual(parseTie(undefined), undefined);
    });
});

describe('getMatchDetails with South American summaries', () => {
    routes.set('summary?event=401860397', fixture.bra2SummaryWithStandings);
    routes.set('summary?event=401913956', fixture.sudamericanaSecondLegSummary);
    routes.set('summary?event=401912520', fixture.libertadoresShootoutSummary);
    routes.set('summary?event=401913109', fixture.copaDoBrasilFirstLegSummary);

    it('finds standings whose entries carry the team id beside a team-name string', async () => {
        const details = await getMatchDetails('401860397', 'bra.2');
        assert.deepStrictEqual(
            [details.homeTeam.name, details.homeTeam.standing.rank, details.homeTeam.standing.points],
            ['Londrina', 18, 32]
        );
        assert.deepStrictEqual(
            [details.awayTeam.name, details.awayTeam.standing.rank, details.awayTeam.standing.points],
            ['Cuiabá', 11, 47]
        );
    });

    it('posts the aggregate and the team that goes through when it lost the 2nd leg', async () => {
        const details = await getMatchDetails('401913956', 'conmebol.sudamericana');
        const text = formatMatchEnd({ ...details, league: leagues['conmebol.sudamericana'] });
        assert.ok(text.includes('Montevideo City Torque 2 x 0 Atlético-MG'), text);
        assert.ok(text.includes('🔁 Jogo de volta · Agregado: 2 x 3'), text);
        assert.ok(text.includes('🏆 Montevideo City Torque vence!'), text);
        assert.ok(text.includes('➡️ Atlético-MG se classifica!'), text);
        assert.ok(text.includes('#SulAmericana'), text);
    });

    it('posts the aggregate alongside a shootout that decided the tie', async () => {
        const details = await getMatchDetails('401912520', 'conmebol.libertadores');
        const text = formatMatchEnd({ ...details, league: leagues['conmebol.libertadores'] });
        assert.ok(text.includes('Palmeiras 0 x 1 Fluminense (5 x 3 pênaltis)'), text);
        assert.ok(text.includes('Agregado: 2 x 2'), text);
        assert.ok(text.includes('➡️ Palmeiras se classifica!'), text);
    });

    it('labels a 1st leg without an aggregate', async () => {
        const details = await getMatchDetails('401913109', 'bra.copa_do_brazil');
        const text = formatMatchStart({ ...details, league: leagues['bra.copa_do_brazil'] });
        assert.ok(text.includes('🔁 Jogo de ida\n'), text);
        assert.ok(!text.includes('Agregado'), text);
    });
});

describe('state championship knockouts', () => {
    routes.set('summary?event=401863164', fixture.paulistaFinalSecondLegSummary);
    routes.set('summary?event=401863459', fixture.mineiroSideTrophyFinalSummary);
    routes.set('summary?event=401861658', fixture.cariocaTacaGuanabaraSemiSummary);

    it('crowns the state champion when ESPN titles the round "Finals"', async () => {
        const details = await getMatchDetails('401863164', 'bra.camp.paulista');
        const text = formatMatchEnd({ ...details, league: leagues['bra.camp.paulista'] });
        assert.ok(text.includes('Agregado: 1 x 3'), text);
        assert.ok(text.includes('🏆 Palmeiras é campeão!'), text);
        assert.ok(!text.includes('se classifica'), text);
    });

    it('names a side trophy instead of calling it the state title', async () => {
        const details = await getMatchDetails('401863459', 'bra.camp.mineiro');
        const text = formatMatchEnd({ ...details, league: leagues['bra.camp.mineiro'] });
        assert.ok(text.includes('🏆 North EC conquista Troféu Inconfidência!'), text);
        assert.ok(!text.includes('é campeão'), text);
    });

    it('treats a prefixed semifinal as advancing, not winning a trophy', async () => {
        const details = await getMatchDetails('401861658', 'bra.camp.carioca');
        const text = formatMatchEnd({ ...details, league: leagues['bra.camp.carioca'] });
        assert.ok(text.includes('➡️ Fluminense se classifica!'), text);
    });
});

describe('getTodayMatches', () => {
    it('exposes tie info from the scoreboard for the pre-match preview', async () => {
        const competition = {
            ...fixture.libertadoresSecondLegScoreboardCompetition,
            competitors: fixture.libertadoresSecondLegScoreboardCompetition.competitors.map((c) => ({ ...c, score: '0' })),
            status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        };
        routes.set('conmebol.libertadores/scoreboard', {
            events: [{ id: '401912521', date: '2026-10-23T00:30Z', competitions: [competition] }],
        });
        const [match] = await getTodayMatches('conmebol.libertadores');
        assert.strictEqual(match.tie.leg, 2);
        const text = formatMatchPreview({ ...match, league: leagues['conmebol.libertadores'] });
        assert.ok(text.includes('🔁 Jogo de volta · Agregado: 0 x 0'), text);
    });
});

describe('formatMatchEnd tie outcomes', () => {
    const base = {
        homeTeam: { id: '6273', name: 'Grêmio' },
        awayTeam: { id: '7632', name: 'Atlético-MG' },
        homeScore: 1,
        awayScore: 1,
        league: leagues['bra.copa_do_brazil'],
    };

    it('crowns the champion when the deciding leg is a final', () => {
        const text = formatMatchEnd({
            ...base,
            tie: { leg: 2, totalLegs: 2, title: 'Final', homeAggregate: 1, awayAggregate: 3, completed: true, winnerTeamId: '7632' },
        });
        assert.ok(text.includes('🏆 Atlético-MG é campeão!'), text);
        assert.ok(!text.includes('se classifica'), text);
    });

    it('falls back to the aggregate while ESPN has not flagged the series winner yet', () => {
        const text = formatMatchEnd({
            ...base,
            tie: { leg: 2, totalLegs: 2, title: 'Semifinals', homeAggregate: 1, awayAggregate: 3, completed: false },
        });
        assert.ok(text.includes('➡️ Atlético-MG se classifica!'), text);
    });

    it('does not name a team after a 1st leg', () => {
        const text = formatMatchEnd({
            ...base,
            tie: { leg: 1, totalLegs: 2, title: 'Semifinals', homeAggregate: 0, awayAggregate: 0, completed: false },
        });
        assert.ok(text.includes('🔁 Jogo de ida'), text);
        assert.ok(!text.includes('se classifica'), text);
    });

    it('leaves single-match posts unchanged', () => {
        const text = formatMatchEnd(base);
        assert.ok(!text.includes('🔁'), text);
        assert.ok(!text.includes('se classifica'), text);
    });
});

describe('getMatchPlays pagination', () => {
    const play = (id, minute) => ({ id, type: { id: '117', text: 'Shot Off Target' }, text: 'x', clock: { value: minute * 60, displayValue: `${minute}'` }, period: { number: 1 } });

    it('fetches every page so plays after the first page are not missed', async () => {
        routes.set('events/900001/competitions/900001/plays?limit=1000&page=1', { count: 3, pageCount: 2, items: [play('1', 1), play('2', 2)] });
        routes.set('events/900001/competitions/900001/plays?limit=1000&page=2', { count: 3, pageCount: 2, items: [play('3', 80)] });
        const plays = await getMatchPlays('900001', 'bra.2');
        assert.deepStrictEqual(plays.map((p) => p.id), ['1', '2', '3']);
    });

    it('caps the page size at 1000, above which ESPN falls back to 25 per page', async () => {
        routes.set('events/900002/competitions/900002/plays?limit=1000&page=1', { count: 1, pageCount: 1, items: [play('9', 5)] });
        const plays = await getMatchPlays('900002', 'bra.2', { limit: 5000 });
        assert.strictEqual(plays.length, 1);
        assert.ok(!requested.some((u) => u.includes('900002') && u.includes('limit=5000')));
    });
});
