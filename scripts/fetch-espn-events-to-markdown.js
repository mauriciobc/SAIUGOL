/**
 * Fetch current games from ESPN and all keyEvents (goals, cards, etc.),
 * then save to a markdown file. Use this to audit and complete EVENT_TYPES
 * in src/bot/eventProcessor.js.
 *
 * Usage: LEAGUE_CODES=bra.1 node scripts/fetch-espn-events-to-markdown.js
 * Output: espn-events-report.md
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import axios from 'axios';
import { leagues } from '../src/data/leagues.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const OUTPUT_FILE = 'espn-events-report.md';

function getTodayDateString() {
    const tz = process.env.TIMEZONE || process.env.TZ || 'UTC';
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        return formatter.format(new Date()).replace(/-/g, '');
    } catch {
        return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }
}

async function getScoreboard(leagueCode) {
    const dateStr = getTodayDateString();
    const url = `${BASE_URL}/${leagueCode}/scoreboard?dates=${dateStr}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    return data.events || [];
}

async function getSummary(leagueCode, eventId) {
    const url = `${BASE_URL}/${leagueCode}/summary?event=${eventId}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
}

function formatMatchHeader(ev) {
    const comp = ev.competitions?.[0];
    if (!comp) return ev.name || ev.shortName || ev.id;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    const h = home ? `${home.team?.displayName ?? '?'} ${home.score ?? '-'}` : '?';
    const a = away ? `${away.team?.displayName ?? '?'} ${away.score ?? '-'}` : '?';
    const clock = comp.status?.displayClock ?? comp.status?.type?.shortDetail ?? '';
    return `${h} x ${a} (${clock})`;
}

function main() {
    const leagueCodesStr = process.env.LEAGUE_CODES || process.env.LEAGUE_CODE || 'bra.1';
    const leagueCodes = leagueCodesStr.split(',').map(s => s.trim()).filter(Boolean);
    const invalid = leagueCodes.filter(c => !leagues[c]);
    if (invalid.length) {
        console.error('Ligas inválidas:', invalid.join(', '), '| Suportadas:', Object.keys(leagues).join(', '));
        process.exit(1);
    }
    return run(leagueCodes);
}

async function run(leagueCodes) {
    const report = [];
    const allTypesMap = new Map(); // key: typeText normalized, value: { raw type object, sample event }

    report.push('# Relatório de eventos ESPN');
    report.push('');
    report.push(`Gerado em: ${new Date().toISOString()}`);
    report.push(`Data da grade (YYYYMMDD): ${getTodayDateString()}`);
    report.push(`Ligas: ${leagueCodes.join(', ')}`);
    report.push('');
    report.push('---');
    report.push('');

    for (const leagueCode of leagueCodes) {
        const leagueName = leagues[leagueCode]?.name || leagueCode;
        report.push(`## Liga: ${leagueName} (\`${leagueCode}\`)`);
        report.push('');

        let events;
        try {
            events = await getScoreboard(leagueCode);
        } catch (err) {
            report.push(`Erro ao buscar scoreboard: ${err.message}`);
            report.push('');
            continue;
        }

        if (events.length === 0) {
            report.push('Nenhuma partida encontrada para hoje.');
            report.push('');
            continue;
        }

        report.push(`Partidas encontradas: ${events.length}`);
        report.push('');

        for (const ev of events) {
            const matchTitle = formatMatchHeader(ev);
            report.push(`### ${matchTitle}`);
            report.push(`- **Event ID:** \`${ev.id}\``);
            report.push('');

            let summary;
            try {
                summary = await getSummary(leagueCode, ev.id);
            } catch (err) {
                report.push(`Erro ao buscar summary: ${err.message}`);
                report.push('');
                continue;
            }

            const keyEvents = summary.keyEvents || [];
            if (keyEvents.length === 0) {
                report.push('*Sem eventos (keyEvents) nesta partida.*');
                report.push('');
                continue;
            }

            report.push('| Minuto | Tipo (raw) | Descrição |');
            report.push('|--------|------------|-----------|');

            for (const ke of keyEvents) {
                const typeObj = ke.type || {};
                const typeText = (typeObj.text || typeObj.abbreviation || '(sem tipo)').trim();
                const typeId = typeObj.id != null ? String(typeObj.id) : '';
                const minute = ke.clock?.displayValue ?? ke.clock?.seconds ?? "—";
                const desc = (ke.text || '').replace(/\n/g, ' ').slice(0, 120);
                report.push(`| ${minute} | \`${typeText}\` ${typeId ? `(id: ${typeId})` : ''} | ${desc} |`);

                const key = typeText.toLowerCase();
                if (!allTypesMap.has(key)) {
                    allTypesMap.set(key, { typeObj: { ...typeObj }, sampleText: typeText, sampleDesc: ke.text });
                }
            }
            report.push('');
        }
    }

    report.push('---');
    report.push('');
    report.push('## Tipos de evento únicos (para o dicionário)');
    report.push('');
    report.push('Estes são todos os `type.text` (ou equivalente) retornados pela API. Use para completar');
    report.push('`EVENT_TYPES` em `src/bot/eventProcessor.js` se algum estiver faltando.');
    report.push('');
    report.push('| Tipo (text) | id | Categoria sugerida (EVENT_TYPES) |');
    report.push('|-------------|-----|-----------------------------------|');

    const suggested = (text) => {
        const t = (text || '').toLowerCase();
        if (t.includes('goal') || t.includes('penalty') || t.includes('own')) return 'GOAL';
        if (t.includes('yellow')) return 'YELLOW_CARD';
        if (t.includes('red') || t.includes('second yellow')) return 'RED_CARD';
        if (t.includes('substitut') || t.includes('sub ')) return 'SUBSTITUTION';
        if (t.includes('var') || t.includes('video assistant')) return 'VAR';
        if (t.includes('2nd half') || t.includes('second half')) return 'SECOND_HALF_START';
        if (t.includes('kickoff') || t.includes('kick off') || t.includes('match start')) return 'MATCH_START';
        if (t.includes('full time') || t.includes('fulltime') || t.includes('match end')) return 'MATCH_END';
        if (t.includes('half time') || t.includes('halftime')) return 'HALF_TIME';
        return '—';
    };

    const sorted = [...allTypesMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, v] of sorted) {
        const id = v.typeObj.id != null ? String(v.typeObj.id) : '—';
        const cat = suggested(v.sampleText);
        report.push(`| ${v.sampleText} | ${id} | ${cat} |`);
    }

    report.push('');
    report.push('---');
    report.push('');
    report.push('### EVENT_TYPES atual (referência)');
    report.push('```js');
    report.push("const EVENT_TYPES = {");
    report.push("  GOAL: ['goal', 'penalty', 'own goal'],");
    report.push("  YELLOW_CARD: ['yellow card', 'yellowcard'],");
    report.push("  RED_CARD: ['red card', 'redcard', 'second yellow'],");
    report.push("  SUBSTITUTION: ['substitution', 'sub'],");
    report.push("  VAR: ['var', 'video assistant referee'],");
    report.push("  SECOND_HALF_START: ['start 2nd half', 'second half', '2nd half'],");
    report.push("  MATCH_START: ['kickoff', 'kick off', 'match start'],");
    report.push("  MATCH_END: ['full time', 'fulltime', 'match end'],");
    report.push("  HALF_TIME: ['half time', 'halftime'],");
    report.push("};");
    report.push('```');

    const out = report.join('\n');
    writeFileSync(OUTPUT_FILE, out, 'utf8');
    console.log(`Relatório salvo em: ${OUTPUT_FILE}`);
    console.log(`Tipos de evento únicos encontrados: ${allTypesMap.size}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
