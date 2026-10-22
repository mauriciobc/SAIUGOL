import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    normalizePlay,
    parseTeamIdFromRef,
    parsePlayerFromPlayText,
    getPlaysUrl,
} from '../src/api/espn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePlays = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/plays-bra1-sample.json'), 'utf8')
);
// Real plays from Bahia x Flamengo (event 401841269) fetched with lang=pt&region=br
const samplePlaysPt = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/plays-bra1-sample-pt.json'), 'utf8')
);

describe('getPlaysUrl', () => {
    it('requests Portuguese narratives when the bot posts in Portuguese', () => {
        const url = getPlaysUrl('bra.1', '401841269', { page: 2, pageSize: 1000, language: 'pt-BR' });
        assert.strictEqual(
            url,
            'https://sports.core.api.espn.com/v2/sports/soccer/leagues/bra.1/events/401841269/competitions/401841269/plays?limit=1000&page=2&lang=pt&region=br'
        );
    });

    it('leaves the ESPN default (English) for other languages', () => {
        const url = getPlaysUrl('eng.1', '1', { page: 1, pageSize: 1000, language: 'en' });
        assert.ok(!url.includes('lang='));
    });

    it('defaults to the configured bot language (pt-BR)', () => {
        assert.ok(getPlaysUrl('bra.1', '1', { page: 1, pageSize: 10 }).endsWith('&lang=pt&region=br'));
    });
});

describe('parseTeamIdFromRef', () => {
    it('extracts team id from core API $ref', () => {
        const ref = 'http://sports.core.api.espn.com/v2/sports/soccer/leagues/bra.1/seasons/2026/teams/9967?lang=en&region=us';
        assert.strictEqual(parseTeamIdFromRef(ref), '9967');
    });

    it('returns null for invalid input', () => {
        assert.strictEqual(parseTeamIdFromRef(null), null);
        assert.strictEqual(parseTeamIdFromRef(''), null);
        assert.strictEqual(parseTeamIdFromRef('https://example.com/no-team'), null);
    });
});

describe('parsePlayerFromPlayText', () => {
    it('parses Attempt missed. Name (Team) ...', () => {
        assert.strictEqual(
            parsePlayerFromPlayText(
                'Attempt missed. Román Gómez (Bahia) right footed shot from the right side of the box.'
            ),
            'Román Gómez'
        );
    });

    it('parses Attempt saved. Name (Team) ...', () => {
        assert.strictEqual(
            parsePlayerFromPlayText(
                'Attempt saved. Santiago Ramos Mingo (Bahia) left footed shot from outside the box is saved.'
            ),
            'Santiago Ramos Mingo'
        );
    });

    it('parses Attempt blocked. Name (Team) ...', () => {
        assert.strictEqual(
            parsePlayerFromPlayText(
                'Attempt blocked. Marcinho (Chapecoense) right footed shot from outside the box is blocked.'
            ),
            'Marcinho'
        );
    });

    it('parses Name (Team) Save at N\'', () => {
        assert.strictEqual(
            parsePlayerFromPlayText("Santiago Ramos (Bahia) Save at 4'"),
            'Santiago Ramos'
        );
    });

    it('returns null for empty input', () => {
        assert.strictEqual(parsePlayerFromPlayText(null), null);
        assert.strictEqual(parsePlayerFromPlayText(''), null);
    });

    it('parses Portuguese shot, save and offside narratives', () => {
        const cases = [
            ['Finalização defendida no lado esquerdo do gol. Erick Pulga (Bahia) finalização com o pé esquerdo do lado esquerdo da área.', 'Erick Pulga'],
            ['Finalização defendida ao ângulo superior esquerdo. Alejo Veliz (Bahia) de cabeça do meio da área.', 'Alejo Veliz'],
            ['Oportunidade perdida Brandon Thomas-Asante (Coventry City), finalização com o pé direito de um ângulo dificil da direita.', 'Brandon Thomas-Asante'],
            ['Finalização bloqueada, Nicolás Acevedo (Bahia) de cabeça do lado esquerdo da pequena área.', 'Nicolás Acevedo'],
            ["Jája Silva (Mirassol) Defesa temporária aos 45'+2'", 'Jája Silva'],
            ['Impedimento, RB Bragantino. Matheus Fernandes tentou um passe em profundidade que encontrou Wallace Yan em posição irregular.', 'Wallace Yan'],
        ];
        for (const [text, expected] of cases) {
            assert.strictEqual(parsePlayerFromPlayText(text), expected, text);
        }
    });
});

describe('normalizePlay (Portuguese narratives)', () => {
    const byId = (id) => normalizePlay(samplePlaysPt.find((p) => p.id === id));

    it('keeps the Portuguese description and parses the shooter', () => {
        const onTarget = byId('53943135');
        assert.strictEqual(onTarget.typeId, '106');
        assert.strictEqual(onTarget.typeText, 'Chute no gol');
        assert.strictEqual(onTarget.playerName, 'Jorge Carrascal');
        assert.strictEqual(onTarget.teamId, '819');
        assert.ok(onTarget.description.startsWith('Finalização defendida'));

        assert.strictEqual(byId('53943945').playerName, 'Luciano Juba');
        assert.strictEqual(byId('53942347').playerName, 'Pedro');
    });

    it('parses saves, including ESPN\'s "Limpar" mistranslation of type 77', () => {
        assert.strictEqual(byId('53942348').playerName, 'David Duarte');
        assert.strictEqual(byId('53942792').playerName, 'Pedro');
    });

    it('names the offside player, not the passer', () => {
        assert.strictEqual(byId('53942873').playerName, 'Cristian Olivera');
    });

    it('finds a player in every allowlisted fixture play', () => {
        const allowlisted = samplePlaysPt.filter((p) => ['106', '117', '135', '77', '68'].includes(p.type.id));
        assert.ok(allowlisted.length >= 6);
        for (const raw of allowlisted) {
            assert.ok(normalizePlay(raw).playerName, raw.text);
        }
    });
});

describe('normalizePlay', () => {
    it('normalizes shot off target from fixture', () => {
        const raw = samplePlays.find((p) => p.type.id === '117');
        const play = normalizePlay(raw);
        assert.strictEqual(play.id, '49824812');
        assert.strictEqual(play.typeId, '117');
        assert.strictEqual(play.typeText, 'Shot Off Target');
        assert.strictEqual(play.minute, "3'");
        assert.strictEqual(play.period, 1);
        assert.strictEqual(play.priority, true);
        assert.strictEqual(play.scoringPlay, false);
        assert.strictEqual(play.teamId, '9967');
        assert.strictEqual(play.playerName, 'Román Gómez');
        assert.ok(play.description.includes('Attempt missed'));
        assert.deepStrictEqual(play.flags, {
            yellowCard: false,
            redCard: false,
            penaltyKick: false,
            ownGoal: false,
        });
    });

    it('normalizes save with player from Name (Team) Save pattern', () => {
        const raw = samplePlays.find((p) => p.type.id === '77');
        const play = normalizePlay(raw);
        assert.strictEqual(play.typeId, '77');
        assert.strictEqual(play.playerName, 'Santiago Ramos');
        assert.strictEqual(play.priority, false);
    });

    it('normalizes scoring play flag on goal', () => {
        const raw = samplePlays.find((p) => p.type.id === '70');
        const play = normalizePlay(raw);
        assert.strictEqual(play.scoringPlay, true);
        assert.strictEqual(play.flags.penaltyKick, true);
    });

    it('returns empty id for invalid raw', () => {
        assert.strictEqual(normalizePlay({}).id, '');
        assert.strictEqual(normalizePlay(null).id, '');
    });
});
