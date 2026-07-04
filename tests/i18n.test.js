import { describe, it } from 'node:test';
import assert from 'node:assert';
import { translate, translateEventType, initI18n, setLanguage } from '../src/services/i18n.js';

describe('Translation Service', () => {
    // Initialize before tests
    initI18n('pt-BR');

    describe('translate()', () => {
        it('should translate UI strings correctly', () => {
            assert.strictEqual(translate('ui.goal_announcement'), '⚽ GOOOOL!');
            assert.strictEqual(translate('ui.own_goal_announcement'), '⚽ GOOOOL! (Contra)');
            assert.strictEqual(translate('ui.match_start'), '🏁 COMEÇA O JOGO!');
            assert.strictEqual(translate('ui.match_end'), '🏁 FIM DE JOGO!');
            assert.strictEqual(translate('ui.draw'), '🤝 Empate!');
        });

        it('should translate common terms correctly', () => {
            assert.strictEqual(translate('common.unknown_player'), 'Jogador desconhecido');
            assert.strictEqual(translate('common.home'), 'Casa');
            assert.strictEqual(translate('common.away'), 'Visitante');
        });

        it('should replace variables in templates', () => {
            const result = translate('ui.team_wins', { team: 'Flamengo' });
            assert.strictEqual(result, '🏆 Flamengo vence!');
        });

        it('should return key if translation not found', () => {
            const result = translate('non.existent.key');
            assert.strictEqual(result, 'non.existent.key');
        });
    });

    describe('translateEventType()', () => {
        it('should translate goal events', () => {
            assert.strictEqual(translateEventType('Goal'), 'Gol');
            assert.strictEqual(translateEventType('Goal - Header'), 'Gol de Cabeça');
            assert.strictEqual(translateEventType('Penalty - Scored'), 'Gol de Pênalti');
            assert.strictEqual(translateEventType('Own Goal'), 'Gol Contra');
        });

        it('should translate card events', () => {
            assert.strictEqual(translateEventType('Yellow Card'), 'Cartão Amarelo');
            assert.strictEqual(translateEventType('Red Card'), 'Cartão Vermelho');
            assert.strictEqual(translateEventType('Second Yellow'), 'Segundo Cartão Amarelo');
        });

        it('should translate other events', () => {
            assert.strictEqual(translateEventType('Substitution'), 'Substituição');
            assert.strictEqual(translateEventType('VAR'), 'VAR');
            assert.strictEqual(translateEventType('Kickoff'), 'Início de Jogo');
            assert.strictEqual(translateEventType('Halftime'), 'Intervalo');
            assert.strictEqual(translateEventType('Full Time'), 'Fim de Jogo');
        });

        it('should handle case insensitivity', () => {
            assert.strictEqual(translateEventType('GOAL'), 'Gol');
            assert.strictEqual(translateEventType('goal'), 'Gol');
            assert.strictEqual(translateEventType('GoAl'), 'Gol');
        });

        it('should return original if not found', () => {
            const result = translateEventType('Unknown Event Type');
            assert.strictEqual(result, 'Unknown Event Type');
        });

        it('should handle null/undefined gracefully', () => {
            assert.strictEqual(translateEventType(null), 'Desconhecido');
            assert.strictEqual(translateEventType(undefined), 'Desconhecido');
        });
    });

    describe('Language switching', () => {
        it('should use pt-BR by default', () => {
            assert.strictEqual(translate('ui.goal_announcement'), '⚽ GOOOOL!');
        });

        it('should allow language switching', () => {
            setLanguage('en');
            // For now, en dictionary doesn't exist, so it should return key
            setLanguage('pt-BR'); // Switch back
        });
    });
});

describe('Formatter Integration', async () => {
    const { formatGoal, formatCard, formatSubstitution, formatVAR, formatHighlights, formatMatchStart, formatMatchEnd, formatSecondHalfStart, formatMatchStats, formatDailyDigest, formatMatchPreview } =
        await import('../src/bot/formatter.js');

    initI18n('pt-BR');

    const mockMatch = {
        id: '12345',
        homeTeam: { id: '1', name: 'Flamengo' },
        awayTeam: { id: '2', name: 'Palmeiras' },
        homeScore: 2,
        awayScore: 1,
        venue: 'Maracanã'
    };

    it('should format goal with Portuguese text', () => {
        const event = {
            player: { name: 'Gabigol' },
            minute: "45'",
            type: 'Goal',
            team: { name: 'Flamengo' }
        };

        const result = formatGoal(event, mockMatch);

        assert.ok(result.includes('⚽ GOOOOL!'));
        assert.ok(result.includes('Gabigol'));
        assert.ok(result.includes('Flamengo 2 x 1 Palmeiras'));
    });

    it('should format own goal with Portuguese text', () => {
        const event = {
            player: { name: 'Zagueiro' },
            minute: "30'",
            type: 'Own Goal',
            team: { name: 'Palmeiras' }
        };

        const result = formatGoal(event, mockMatch);

        assert.ok(result.includes('⚽ GOOOOL! (Contra)'));
        assert.ok(result.includes('Zagueiro'));
    });

    it('should format card with Portuguese text', () => {
        const event = {
            player: { name: 'Jogador' },
            minute: "60'",
            type: 'Yellow Card'
        };

        const result = formatCard(event, mockMatch);

        assert.ok(result.includes('🟨 CARTÃO AMARELO!'));
        assert.ok(result.includes('Jogador'));
    });

    it('should format substitution with Portuguese text', () => {
        const event = {
            playerIn: { name: 'Pedro' },
            playerOut: { name: 'Gabigol' },
            minute: "70'"
        };

        const result = formatSubstitution(event, mockMatch);

        assert.ok(result.includes('🔄 SUBSTITUIÇÃO'));
        assert.ok(result.includes('Entra: Pedro'));
        assert.ok(result.includes('Sai: Gabigol'));
    });

    it('should parse substitution names from description when playerIn/playerOut missing', () => {
        const event = {
            minute: "59'",
            description: 'Rafael Tolói sostituisce Berat Djimsiti.'
        };

        const result = formatSubstitution(event, mockMatch);

        assert.ok(result.includes('🔄 SUBSTITUIÇÃO'));
        assert.ok(result.includes('Rafael Tolói'), 'player in from Italian "sostituisce"');
        assert.ok(result.includes('Berat Djimsiti'), 'player out from description');
        assert.ok(!result.includes('Jogador desconhecido'));
    });

    it('should parse Portuguese names with accents from substitution descriptions', () => {
        const event = {
            minute: "65'",
            description: 'Substituição, entra em campo João Silva substituindo Pedro Álvares.'
        };

        const result = formatSubstitution(event, mockMatch);

        assert.ok(result.includes('🔄 SUBSTITUIÇÃO'));
        assert.ok(result.includes('João Silva'), 'player in with Portuguese accents');
        assert.ok(result.includes('Pedro Álvares'), 'player out with Portuguese accents');
        assert.ok(!result.includes('Jogador desconhecido'));
    });

    it('should handle multiple accented characters in substitution names', () => {
        const event = {
            minute: "72'",
            description: 'Sérgio Oliveira replaces Luiz Fernando.'
        };

        const result = formatSubstitution(event, mockMatch);

        assert.ok(result.includes('🔄 SUBSTITUIÇÃO'));
        assert.ok(result.includes('Sérgio Oliveira'), 'player in with multiple accents');
        assert.ok(result.includes('Luiz Fernando'), 'player out');
        assert.ok(!result.includes('Jogador desconhecido'));
    });

    it('should format match start with Portuguese text', () => {
        const result = formatMatchStart(mockMatch);

        assert.ok(result.includes('🏁 COMEÇA O JOGO!'));
        assert.ok(result.includes('Flamengo x Palmeiras'));
        assert.ok(result.includes('Maracanã'));
    });

    it('should format match end with Portuguese text', () => {
        const result = formatMatchEnd(mockMatch);

        assert.ok(result.includes('🏁 FIM DE JOGO!'));
        assert.ok(result.includes('Flamengo 2 x 1 Palmeiras'));
        assert.ok(result.includes('🏆 Flamengo vence!'));
    });

    it('should handle missing player names with Portuguese default', () => {
        const event = {
            minute: "45'",
            type: 'Goal'
        };

        const result = formatGoal(event, mockMatch);

        assert.ok(result.includes('Jogador desconhecido'));
    });

    it('should format VAR event with Portuguese text', () => {
        const event = {
            minute: "70'",
            decision: 'Penalty confirmed'
        };

        const result = formatVAR(event, mockMatch);

        assert.ok(result.includes('VAR'));
        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Penalty confirmed'));
    });

    it('should format highlights with links', () => {
        const highlights = [
            { title: 'Gol', url: 'https://example.com/1' },
            { title: 'Pênalti', embedUrl: 'https://example.com/2' },
        ];

        const result = formatHighlights(mockMatch, highlights);

        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Gol'));
        assert.ok(result.includes('https://example.com/1'));
        assert.ok(result.includes('https://example.com/2'));
    });

    it('should format second half start with teams, score and minute', () => {
        const result = formatSecondHalfStart(mockMatch, { minute: '46' });

        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Palmeiras'));
        assert.ok(result.includes('2 x 1'));
        assert.ok(result.includes('46'));
    });

    it('should include favorite team goal alert using config nickname and emoji', () => {
        const event = {
            player: { name: 'Hulk' },
            minute: '10',
            type: 'Goal',
            team: { name: 'Flamengo' }
        };
        const result = formatGoal(event, mockMatch, { isFavoriteTeam: true });
        assert.ok(result.includes('⚫🔴'));
        assert.ok(result.includes('Galo'));
        assert.ok(result.startsWith('⚫🔴 Gol do Galo!'));
    });

    it('should include favorite team red card alert using config nickname and emoji', () => {
        const event = {
            player: { name: 'Jogador' },
            minute: '55',
            type: 'Red Card'
        };
        const result = formatCard(event, mockMatch, { isFavoriteTeam: true });
        assert.ok(result.includes('⚫🔴'));
        assert.ok(result.includes('Galo'));
        assert.ok(result.startsWith('⚫🔴 Cartão vermelho - Galo!'));
    });

    it('should not include favorite team alert for yellow card even with isFavoriteTeam', () => {
        const event = {
            player: { name: 'Jogador' },
            minute: '30',
            type: 'Yellow Card'
        };
        const result = formatCard(event, mockMatch, { isFavoriteTeam: true });
        assert.ok(!result.includes('Galo'));
    });

    it('should include standing annotation in formatMatchStart when standing present', () => {
        const matchWithStanding = {
            ...mockMatch,
            homeTeam: { ...mockMatch.homeTeam, standing: { rank: 1, points: 41 } },
            awayTeam: { ...mockMatch.awayTeam, standing: { rank: 5, points: 30 } },
        };
        const result = formatMatchStart(matchWithStanding);
        assert.ok(result.includes('(1º · 41pts)'), `expected standing annotation, got: ${result}`);
        assert.ok(result.includes('(5º · 30pts)'));
    });

    it('should omit standing annotation in formatMatchStart when standing absent', () => {
        const result = formatMatchStart(mockMatch);
        assert.ok(!result.includes('pts'));
    });

    it('should include standing annotation in formatMatchEnd when standing present', () => {
        const matchWithStanding = {
            ...mockMatch,
            homeTeam: { ...mockMatch.homeTeam, standing: { rank: 2, points: 38 } },
            awayTeam: { ...mockMatch.awayTeam, standing: undefined },
        };
        const result = formatMatchEnd(matchWithStanding);
        assert.ok(result.includes('(2º · 38pts)'));
    });

    it('formatMatchStats returns null when no boxscore', () => {
        const result = formatMatchStats(mockMatch);
        assert.strictEqual(result, null);
    });

    it('formatMatchStats formats available stats', () => {
        const matchWithStats = {
            ...mockMatch,
            boxscore: {
                home: { possessionPct: '55.0', totalShots: '12', shotsOnTarget: '5', wonCorners: '6', yellowCards: '1', redCards: '0', saves: '3' },
                away: { possessionPct: '45.0', totalShots: '8', shotsOnTarget: '2', wonCorners: '3', yellowCards: '2', redCards: '0', saves: '7' },
            },
        };
        const result = formatMatchStats(matchWithStats);
        assert.ok(result !== null);
        assert.ok(result.includes('📊 ESTATÍSTICAS'));
        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Palmeiras'));
        assert.ok(result.includes('55.0'));
        assert.ok(result.includes('12'));
        assert.ok(result.includes('5 no gol'));
    });

    it('formatMatchStats handles partial stats gracefully', () => {
        const matchWithPartialStats = {
            ...mockMatch,
            boxscore: {
                home: { possessionPct: undefined, totalShots: undefined, shotsOnTarget: undefined, wonCorners: undefined, yellowCards: '1', redCards: '0', saves: undefined },
                away: undefined,
            },
        };
        const result = formatMatchStats(matchWithPartialStats);
        assert.ok(result !== null);
        assert.ok(result.includes('🟨 1'));
    });

    it('formatDailyDigest lists fixtures grouped by league', () => {
        const league = { name: 'Brasileirão', hashtags: ['#Brasileirao'] };
        const leagueMatches = [{
            league,
            matches: [
                { homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Palmeiras' }, startTime: '2026-07-04T18:00:00Z' },
                { homeTeam: { name: 'Atlético-MG' }, awayTeam: { name: 'Grêmio' }, startTime: '2026-07-04T21:00:00Z' },
            ],
        }];
        const result = formatDailyDigest(leagueMatches);
        assert.ok(result.includes('📅 JOGOS DE HOJE'));
        assert.ok(result.includes('Brasileirão'));
        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Palmeiras'));
        assert.ok(result.includes('Atlético-MG'));
        assert.ok(result.includes('#Brasileirao'));
    });

    it('formatDailyDigest skips leagues with no matches', () => {
        const leagueMatches = [
            { league: { name: 'Liga A', hashtags: [] }, matches: [] },
            { league: { name: 'Liga B', hashtags: [] }, matches: [
                { homeTeam: { name: 'Time1' }, awayTeam: { name: 'Time2' }, startTime: null },
            ]},
        ];
        const result = formatDailyDigest(leagueMatches);
        assert.ok(!result.includes('Liga A'));
        assert.ok(result.includes('Liga B'));
        assert.ok(result.includes('Time1'));
    });

    it('formatMatchPreview shows form and record when present', () => {
        const matchWithPreviewData = {
            ...mockMatch,
            homeTeam: { ...mockMatch.homeTeam, form: 'WWDLW', record: '9-2-7' },
            awayTeam: { ...mockMatch.awayTeam, form: 'WLLWW', record: '8-3-7' },
            venueCity: 'Rio de Janeiro',
            startTime: '2026-07-04T21:00:00Z',
        };
        const result = formatMatchPreview(matchWithPreviewData);
        assert.ok(result.includes('🔜 PRÉ-JOGO'));
        assert.ok(result.includes('Flamengo'));
        assert.ok(result.includes('Palmeiras'));
        assert.ok(result.includes('WWDLW'));
        assert.ok(result.includes('9-2-7'));
        assert.ok(result.includes('Rio de Janeiro'));
    });

    it('formatMatchPreview omits sections when data absent', () => {
        const minimalMatch = {
            ...mockMatch,
            homeTeam: { ...mockMatch.homeTeam, form: undefined, record: undefined },
            awayTeam: { ...mockMatch.awayTeam, form: undefined, record: undefined },
            venueCity: undefined,
            startTime: null,
        };
        const result = formatMatchPreview(minimalMatch);
        assert.ok(result.includes('🔜 PRÉ-JOGO'));
        assert.ok(result.includes('Flamengo'));
        assert.ok(!result.includes('Forma:'));
        assert.ok(!result.includes('Campeonato:'));
    });
});
