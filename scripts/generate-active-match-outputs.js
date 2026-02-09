/**
 * Gera ACTIVE_MATCHES_OUTPUTS.md com saídas do formatter usando dados AO VIVO da ESPN API.
 * Uso: node scripts/generate-active-match-outputs.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config.js';
import { initI18n } from '../src/services/i18n.js';
import { getTodayMatches, getMatchDetails, getLiveEvents } from '../src/api/espn.js';
import { normalizeStatus } from '../src/state/snapshotContract.js';
import {
    formatMatchStart,
    formatGoal,
    formatCard,
    formatSubstitution,
    formatVAR,
    formatHalfTime,
    formatSecondHalfStart,
    formatMatchEnd,
    formatHighlights,
} from '../src/bot/formatter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'ACTIVE_MATCHES_OUTPUTS.md');

const EVENT_TYPES = {
    GOAL: ['goal', 'penalty', 'own goal'],
    YELLOW_CARD: ['yellow card', 'yellowcard'],
    RED_CARD: ['red card', 'redcard', 'second yellow'],
    SUBSTITUTION: ['substitution', 'sub'],
    VAR: ['var', 'video assistant referee'],
    SECOND_HALF_START: ['start 2nd half', 'second half', '2nd half'],
    MATCH_START: ['kickoff', 'kick off', 'match start'],
    MATCH_END: ['full time', 'fulltime', 'match end'],
    HALF_TIME: ['half time', 'halftime'],
};

function categorizeEvent(type) {
    if (!type) return null;
    const lowerType = String(type).toLowerCase();
    for (const [category, keywords] of Object.entries(EVENT_TYPES)) {
        if (keywords.some((kw) => lowerType.includes(kw))) return category;
    }
    return null;
}

function normalizeMatchData(apiMatch, league) {
    return {
        id: apiMatch.id,
        homeTeam: {
            id: apiMatch.homeTeam?.id,
            name: apiMatch.homeTeam?.name || apiMatch.homeName || 'Casa',
        },
        awayTeam: {
            id: apiMatch.awayTeam?.id,
            name: apiMatch.awayTeam?.name || apiMatch.awayName || 'Visitante',
        },
        homeScore: apiMatch.homeScore ?? apiMatch.homeGoals ?? 0,
        awayScore: apiMatch.awayScore ?? apiMatch.awayGoals ?? 0,
        status: apiMatch.status || apiMatch.state,
        venue: apiMatch.venue?.name || apiMatch.stadium || apiMatch.venue,
        minute: apiMatch.minute || apiMatch.clock,
        startTime: apiMatch.startTime || apiMatch.date,
        league: league || apiMatch.league,
    };
}

function isFavoriteTeam(event, match) {
    const ids = config.bot.favoriteTeamIds || [];
    const names = config.bot.favoriteTeamNames || [];
    if (!ids.length && !names.length) return false;
    const teamId = event.teamId || event.team?.id;
    const teamName =
        teamId === match.homeTeam?.id
            ? match.homeTeam?.name
            : teamId === match.awayTeam?.id
                ? match.awayTeam?.name
                : event.team?.name || '';
    if (teamId && ids.includes(String(teamId))) return true;
    if (teamName && names.some((n) => teamName.toLowerCase().includes(n.toLowerCase()))) return true;
    return false;
}

function enrichEventForFormatter(event, match) {
    const teamId = event.teamId;
    const team =
        teamId != null && match.homeTeam?.id === teamId
            ? match.homeTeam
            : teamId != null && match.awayTeam?.id === teamId
                ? match.awayTeam
                : { name: '' };
    return {
        ...event,
        team,
        reason: event.reason ?? event.description ?? event.text ?? '',
        decision: event.decision ?? event.result ?? event.description ?? event.text ?? '',
    };
}

function formatEventByCategory(category, event, match, options = {}) {
    const e = enrichEventForFormatter(event, match);
    const isFavorite = isFavoriteTeam(e, match);
    const opts = { isFavoriteTeam: isFavorite || options.isFavoriteTeam };
    switch (category) {
        case 'GOAL':
            return formatGoal(e, match, opts);
        case 'YELLOW_CARD':
        case 'RED_CARD':
            return formatCard(e, match, opts);
        case 'SUBSTITUTION':
            return formatSubstitution(e, match);
        case 'VAR':
            return formatVAR(e, match);
        case 'MATCH_START':
            return formatMatchStart(match);
        case 'SECOND_HALF_START':
            return formatSecondHalfStart(match, e);
        case 'HALF_TIME':
            return formatHalfTime(match, e);
        case 'MATCH_END':
            return formatMatchEnd(match);
        default:
            return null;
    }
}

function section(title, body) {
    return `## ${title}\n\n${body}\n`;
}

function codeBlock(text) {
    return '```\n' + String(text).trimEnd() + '\n```\n';
}

async function main() {
    initI18n(config.i18n?.defaultLanguage || 'pt-BR');

    const activeLeagues = config.activeLeagues || [];
    if (activeLeagues.length === 0) {
        const doc = `# Saídas para partidas ativas\n\nNenhuma liga configurada (LEAGUE_CODES). Gere com \`node scripts/generate-active-match-outputs.js\`.\n`;
        fs.writeFileSync(OUT_PATH, doc, 'utf8');
        console.log('Escrito:', OUT_PATH, '(sem ligas)');
        return;
    }

    const liveMatches = [];
    for (const league of activeLeagues) {
        const matches = await getTodayMatches(league.code);
        for (const m of matches) {
            const status = normalizeStatus(m.status, m.state);
            if (status !== 'in') continue;
            const details = await getMatchDetails(m.id, league.code);
            if (!details) continue;
            const events = await getLiveEvents(m.id, league.code);
            details.league = league;
            const matchData = normalizeMatchData(details);
            liveMatches.push({
                match: matchData,
                events,
                league: league.name,
            });
        }
    }

    const generatedAt = new Date().toISOString();

    if (liveMatches.length === 0) {
        const doc = `# Saídas para partidas ativas\n\n**Nenhuma partida ao vivo no momento.**\n\nGerado em ${generatedAt} com dados da ESPN API.\n\nLigas consultadas: ${activeLeagues.map((l) => l.name).join(', ')}.\n`;
        fs.writeFileSync(OUT_PATH, doc, 'utf8');
        console.log('Escrito:', OUT_PATH, '(0 partidas ao vivo)');
        return;
    }

    const sections = [];
    sections.push(
        `# Saídas para partidas ativas (dados ESPN ao vivo)\n\nGerado em **${generatedAt}** a partir da API ESPN. Cada seção é uma partida ao vivo e os blocos de código são os textos que o bot postaria no Mastodon.\n\n---\n\n`
    );

    for (let i = 0; i < liveMatches.length; i++) {
        const { match, events, league } = liveMatches[i];
        const header = `${match.homeTeam.name} ${match.homeScore} x ${match.awayTeam.name} ${match.awayScore} — ${league} (${match.minute ?? '?'})`;
        sections.push(section(`Partida ${i + 1}: ${header}`, ''));

        const byCategory = new Map();
        for (const event of events) {
            const category = categorizeEvent(event.type);
            if (!category) continue;
            const text = formatEventByCategory(category, event, match);
            if (!text) continue;
            if (!byCategory.has(category)) byCategory.set(category, []);
            byCategory.get(category).push({ event, text });
        }

        const categoryOrder = [
            'MATCH_START',
            'GOAL',
            'YELLOW_CARD',
            'RED_CARD',
            'SUBSTITUTION',
            'VAR',
            'HALF_TIME',
            'SECOND_HALF_START',
            'MATCH_END',
        ];
        const categoryLabels = {
            MATCH_START: 'Início de jogo',
            GOAL: 'Gol',
            YELLOW_CARD: 'Cartão amarelo',
            RED_CARD: 'Cartão vermelho',
            SUBSTITUTION: 'Substituição',
            VAR: 'VAR',
            HALF_TIME: 'Intervalo',
            SECOND_HALF_START: 'Início do 2º tempo',
            MATCH_END: 'Fim de jogo',
        };

        for (const cat of categoryOrder) {
            const list = byCategory.get(cat);
            if (!list?.length) continue;
            const label = categoryLabels[cat] || cat;
            list.forEach((item, idx) => {
                const subTitle = list.length > 1 ? `${label} (${idx + 1})` : label;
                sections.push(section(subTitle, codeBlock(item.text)));
            });
        }

        if (byCategory.size === 0) {
            sections.push('*Nenhum evento postável ainda (kickoff, gol, cartão, etc.).*\n');
        }

        sections.push('\n---\n\n');
    }

    const doc = sections.join('');
    fs.writeFileSync(OUT_PATH, doc, 'utf8');
    console.log('Escrito:', OUT_PATH, `(${liveMatches.length} partida(s) ao vivo)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
