/**
 * Parse espn-events-report.md and fetch Mastodon timeline for @saiugol,
 * then compare expected events (from report) vs real posts.
 *
 * Usage: node scripts/compare-report-vs-mastodon.js [espn-events-report.md]
 *        MASTODON_ACCT=saiugol MASTODON_INSTANCE=mastodon.social (optional)
 * Output: comparison report to stdout and optionally compare-report-result.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import axios from 'axios';

const DEFAULT_REPORT_PATH = 'espn-events-report.md';
const DEFAULT_ACCT = 'saiugol';
const DEFAULT_INSTANCE = 'https://mastodon.social';
const MAX_STATUSES = 80;

// Map report event type (raw) to category we use for matching
const TYPE_TO_CATEGORY = {
    'kickoff': 'match_start',
    'goal': 'goal',
    'goal - header': 'goal',
    'penalty - scored': 'goal',
    'halftime': 'half_time',
    'substitution': 'substitution',
    'start 2nd half': 'second_half_start',
    'yellow card': 'yellow_card',
    'red card': 'red_card',
    'full time': 'match_end',
    'match end': 'match_end',
};

// Patterns to detect post type and extract minute/match from Mastodon content (plain text)
const POST_PATTERNS = [
    { type: 'goal', re: /⚽\s*GOOOOL!/i },
    { type: 'substitution', re: /🔄\s*SUBSTITUIÇÃO/i },
    { type: 'yellow_card', re: /🟨\s*CARTÃO AMARELO/i },
    { type: 'red_card', re: /🟥\s*CARTÃO VERMELHO/i },
    { type: 'half_time', re: /⏸️\s*INTERVALO/i },
    { type: 'match_start', re: /🏁\s*COMEÇA O JOGO/i },
    { type: 'second_half_start', re: /🔄\s*INÍCIO DO 2º TEMPO/i },
    { type: 'match_end', re: /🏁\s*FIM DE JOGO/i },
];

function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse espn-events-report.md into list of expected events.
 * @returns {{ eventId: string, matchLabel: string, minute: string, type: string, category: string, description: string }[]}
 */
function parseReport(content) {
    const expected = [];
    const sections = content.split(/^### /m);
    for (let i = 1; i < sections.length; i++) {
        const section = sections[i];
        const matchLabelMatch = section.match(/^([^\n]+)/);
        const eventIdMatch = section.match(/\*\*Event ID:\*\*\s*`(\d+)`/);
        if (!matchLabelMatch || !eventIdMatch) continue;
        const matchLabel = matchLabelMatch[1].replace(/\s*\(\d+'\+\d+'?\)\s*$/, '').trim(); // "Chapecoense 3 x Coritiba 3 (90'+3')" -> "Chapecoense 3 x Coritiba 3"
        const eventId = eventIdMatch[1];
        if (section.includes('*Sem eventos (keyEvents)')) continue;
        const tableMatch = section.match(/\|\s*Minuto\s*\|\s*Tipo[^|]*\|[^\n]+\n\|[-\s|]+\n([\s\S]*?)(?=\n\n|\n---|$)/);
        if (!tableMatch) continue;
        const rows = tableMatch[1].trim().split('\n').filter(Boolean);
        for (const row of rows) {
            const cells = row.split('|').map(s => s.trim()).filter(Boolean);
            if (cells.length < 3) continue;
            const minute = (cells[0] || '').trim();
            const typeRaw = (cells[1] || '').replace(/`/g, '').replace(/\s*\(id:\s*\d+\)\s*/, '').trim().toLowerCase();
            const description = (cells[2] || '').trim();
            const category = TYPE_TO_CATEGORY[typeRaw] || typeRaw.replace(/\s+/g, '_').slice(0, 20);
            expected.push({
                eventId,
                matchLabel: normalizeMatchLabel(matchLabel),
                minute: normalizeMinute(minute),
                typeRaw,
                category,
                description,
            });
        }
    }
    return expected;
}

function normalizeMatchLabel(s) {
    if (!s || typeof s !== 'string') return '';
    return s
        .replace(/\s*\([^)]*\)\s*$/, '')               // remove trailing (90'+3')
        .replace(/\s*\d+\s*x\s*\d+\s*/g, ' x ')       // " 2 x 3 " -> " x "
        .replace(/\s*x\s*/gi, ' x ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function matchLabelsSame(a, b) {
    if (!a || !b) return false;
    const na = normalizeMatchLabel(a);
    const nb = normalizeMatchLabel(b);
    if (na === nb) return true;
    const partsA = na.split(/\s+x\s+/).map((p) => p.trim()).filter(Boolean);
    const partsB = nb.split(/\s+x\s+/).map((p) => p.trim()).filter(Boolean);
    if (partsA.length < 2 || partsB.length < 2) return na.includes(nb) || nb.includes(na);
    const leftOk = nb.includes(partsA[0]) || (partsB[0] && partsA[0].includes(partsB[0]));
    const rightOk = nb.includes(partsA[1]) || (partsB[1] && partsA[1].includes(partsB[1]));
    return leftOk && rightOk;
}

function normalizeMinute(m) {
    if (!m) return "0'";
    return m.replace(/\s+/g, '').trim();
}

/**
 * Fetch account id from instance, then fetch statuses.
 * @returns {{ type: string, minute: string, matchLabel: string, player?: string, raw: string }[]}
 */
async function fetchMastodonTimeline(instanceUrl, acct) {
    const instance = instanceUrl.replace(/\/$/, '');
    const lookupRes = await axios.get(`${instance}/api/v1/accounts/lookup`, {
        params: { acct },
        timeout: 10000,
    });
    const accountId = lookupRes.data?.id;
    if (!accountId) throw new Error(`Account not found: ${acct}`);
    const statusRes = await axios.get(`${instance}/api/v1/accounts/${accountId}/statuses`, {
        params: { limit: MAX_STATUSES, exclude_replies: true },
        timeout: 10000,
    });
    const statuses = statusRes.data || [];
    const real = [];
    for (const s of statuses) {
        const text = stripHtml(s.content || '');
        let type = null;
        for (const { type: t, re } of POST_PATTERNS) {
            if (re.test(text)) {
                type = t;
                break;
            }
        }
        if (!type) continue;
        const minuteMatch = text.match(/⏱️\s*(\d+'(?:\+\d+')?)/);
        const minute = minuteMatch ? normalizeMinute(minuteMatch[1]) : '';
        const scoreBlock = text.match(/[\w\sÀ-ÿ]+?\d+\s*x\s*\d+[\w\sÀ-ÿ]+?(?=\s*⏱️|\n|$)/);
        const matchLabel = scoreBlock ? normalizeMatchLabel(scoreBlock[0].trim()) : '';
        const playerMatch = text.match(/👤\s*([^\n#]+?)(?:\s*\(|$)/);
        const player = playerMatch ? playerMatch[1].trim() : undefined;
        real.push({
            type,
            minute,
            matchLabel,
            player,
            raw: text.slice(0, 200),
        });
    }
    return real;
}

/**
 * Build a match key for expected event (for grouping and matching).
 */
function expectedKey(ev) {
    return `${ev.eventId}|${ev.matchLabel}|${ev.minute}|${ev.category}`;
}

/**
 * Try to find a real post that matches this expected event.
 * Same match (fuzzy), same minute, same category. For goals/subs/cards we can also match by player name.
 */
function findMatchingReal(expectedEv, realList, used) {
    for (let i = 0; i < realList.length; i++) {
        if (used.has(i)) continue;
        const r = realList[i];
        if (r.type !== expectedEv.category) continue;
        const minuteMatch = r.minute === expectedEv.minute;
        const matchLabelMatch = matchLabelsSame(r.matchLabel, expectedEv.matchLabel);
        if (!minuteMatch || !matchLabelMatch) continue;
        used.add(i);
        return { real: r, index: i };
    }
    return null;
}

function run() {
    const reportPath = process.argv[2] || DEFAULT_REPORT_PATH;
    const acct = process.env.MASTODON_ACCT || DEFAULT_ACCT;
    const instance = process.env.MASTODON_INSTANCE || DEFAULT_INSTANCE;
    let reportContent;
    try {
        reportContent = readFileSync(reportPath, 'utf8');
    } catch (e) {
        console.error('Erro ao ler relatório:', e.message);
        process.exit(1);
    }
    const expected = parseReport(reportContent);
    return fetchMastodonTimeline(instance, acct)
        .then((real) => {
            const used = new Set();
            const matched = [];
            const unmatchedExpected = [];
            for (const ev of expected) {
                const m = findMatchingReal(ev, real, used);
                if (m) {
                    matched.push({ expected: ev, real: m.real });
                } else {
                    unmatchedExpected.push(ev);
                }
            }
            const unmatchedReal = real.filter((_, i) => !used.has(i));
            const out = buildReport(expected, real, matched, unmatchedExpected, unmatchedReal, acct, instance);
            console.log(out.console);
            try {
                writeFileSync('compare-report-result.md', out.markdown, 'utf8');
                console.log('\nResultado detalhado salvo em: compare-report-result.md');
            } catch {
                // ignore
            }
        })
        .catch((err) => {
            console.error('Erro ao buscar Mastodon:', err.message);
            if (err.response?.status) console.error('Status:', err.response.status);
            process.exit(1);
        });
}

function buildReport(expected, real, matched, unmatchedExpected, unmatchedReal, acct, instance) {
    const postableCategories = new Set(['goal', 'yellow_card', 'red_card', 'substitution', 'match_start', 'second_half_start', 'half_time', 'match_end']);
    const expectedPostable = expected.filter((e) => postableCategories.has(e.category));
    const matchedPostable = matched.filter((m) => postableCategories.has(m.expected.category));
    const unmatchedPostable = unmatchedExpected.filter((e) => postableCategories.has(e.category));

    let consoleOut = '';
    consoleOut += '=== Comparação: relatório ESPN vs timeline Mastodon ===\n\n';
    consoleOut += `Conta: @${acct}@${new URL(instance).host}\n`;
    consoleOut += `Eventos esperados (no relatório): ${expected.length} (postáveis: ${expectedPostable.length})\n`;
    consoleOut += `Posts na timeline (reconhecidos): ${real.length}\n`;
    consoleOut += `Casados: ${matched.length} (postáveis: ${matchedPostable.length})\n`;
    consoleOut += `Esperados mas não encontrados: ${unmatchedExpected.length} (postáveis: ${unmatchedPostable.length})\n`;
    consoleOut += `Posts sem evento correspondente (fantasmas): ${unmatchedReal.length}\n\n`;

    if (unmatchedPostable.length) {
        consoleOut += '--- Esperados e NÃO encontrados na timeline ---\n';
        for (const e of unmatchedPostable.slice(0, 20)) {
            consoleOut += `  [${e.category}] ${e.matchLabel} ${e.minute} | ${e.description.slice(0, 60)}...\n`;
        }
        if (unmatchedPostable.length > 20) consoleOut += `  ... e mais ${unmatchedPostable.length - 20}\n`;
        consoleOut += '\n';
    }

    if (unmatchedReal.length) {
        consoleOut += '--- Posts na timeline SEM evento no relatório (fantasmas) ---\n';
        for (const r of unmatchedReal.slice(0, 15)) {
            consoleOut += `  [${r.type}] ${r.matchLabel} ${r.minute} | ${(r.player || r.raw).slice(0, 50)}\n`;
        }
        if (unmatchedReal.length > 15) consoleOut += `  ... e mais ${unmatchedReal.length - 15}\n`;
    }

    const md = [];
    md.push('# Comparação: relatório ESPN vs timeline Mastodon');
    md.push('');
    md.push(`- **Conta:** @${acct}@${new URL(instance).host}`);
    md.push(`- **Eventos esperados (relatório):** ${expected.length} (postáveis: ${expectedPostable.length})`);
    md.push(`- **Posts reconhecidos na timeline:** ${real.length}`);
    md.push(`- **Casados:** ${matched.length} (postáveis: ${matchedPostable.length})`);
    md.push(`- **Esperados não encontrados:** ${unmatchedExpected.length} (postáveis: ${unmatchedPostable.length})`);
    md.push(`- **Fantasmas (post sem evento no relatório):** ${unmatchedReal.length}`);
    md.push('');
    md.push('## Esperados não encontrados');
    md.push('');
    md.push('| Partida | Minuto | Tipo | Descrição (resumo) |');
    md.push('|---------|--------|------|--------------------|');
    for (const e of unmatchedPostable) {
        md.push(`| ${e.matchLabel} | ${e.minute} | ${e.category} | ${e.description.slice(0, 70).replace(/\|/g, ' ') } |`);
    }
    md.push('');
    md.push('## Posts fantasmas (sem evento no relatório)');
    md.push('');
    md.push('| Tipo | Partida | Minuto | Jogador/Texto |');
    md.push('|------|---------|--------|---------------|');
    for (const r of unmatchedReal) {
        md.push(`| ${r.type} | ${r.matchLabel} | ${r.minute} | ${(r.player || r.raw.slice(0, 50)).replace(/\|/g, ' ')} |`);
    }
    md.push('');
    md.push('## Amostra de casamentos (esperado ↔ timeline)');
    md.push('');
    md.push('| Esperado (min, tipo) | Timeline (min, jogador) |');
    md.push('|----------------------|-------------------------|');
    for (const { expected: e, real: r } of matchedPostable.slice(0, 25)) {
        md.push(`| ${e.minute} ${e.category} ${e.matchLabel.slice(0, 25)} | ${r.minute} ${r.player || '-'} |`);
    }
    md.push('');

    return { console: consoleOut, markdown: md.join('\n') };
}

run();
