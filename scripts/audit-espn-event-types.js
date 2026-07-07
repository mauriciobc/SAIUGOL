/**
 * Audit ESPN keyEvents typeIds across a random sample of past matches.
 *
 * Usage:
 *   SAMPLE_SIZE=50 YEAR=2026 SAMPLE_SEED=42 node scripts/audit-espn-event-types.js
 *
 * Output (data/event-type-audit/):
 *   sample-2026.json       — sampled matches + normalized keyEvents (EN + PT)
 *   type-catalog-2026.json — aggregation by typeId with gaps vs categorizeEvent()
 *   type-catalog-2026.md   — human-readable report
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { leagues } from '../src/data/leagues.js';

// Loaded in main() after NODE_ENV/STATE_DIR are set — avoids matchState auto-save
// and persistence trying to mkdir /app/data (Docker path) outside containers.
let categorizeEvent;

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB_BASE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '50', 10);
const YEAR = parseInt(process.env.YEAR || '2026', 10);
const SAMPLE_SEED = parseInt(process.env.SAMPLE_SEED || '42', 10);
const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '300', 10);
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'event-type-audit');

/** Seeded PRNG (mulberry32) for reproducible sampling. */
function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSummaryUrl(leagueCode, eventId, usePt) {
    const base = usePt ? WEB_BASE_URL : BASE_URL;
    const qs = usePt ? '&lang=pt&region=br' : '';
    return `${base}/${leagueCode}/summary?event=${eventId}${qs}`;
}

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInYear(y) {
    return isLeapYear(y) ? 366 : 365;
}

function dayOfYearToDateStr(year, dayOfYear) {
    const date = new Date(Date.UTC(year, 0, dayOfYear));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function generateRandomDates(year, count, rng, endDayOfYear) {
    const dates = new Set();
    const max = Math.min(endDayOfYear, daysInYear(year));
    let attempts = 0;
    while (dates.size < count && attempts < count * 10) {
        const day = 1 + Math.floor(rng() * max);
        dates.add(dayOfYearToDateStr(year, day));
        attempts++;
    }
    return [...dates];
}

function resolveLeagueCodes() {
    const raw = process.env.LEAGUE_CODES || process.env.LEAGUE_CODE || '';
    const codes = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : Object.keys(leagues);
    const invalid = codes.filter((c) => !leagues[c]);
    if (invalid.length) {
        console.error(`Invalid league codes: ${invalid.join(', ')}`);
        process.exit(1);
    }
    return codes;
}

function isMatchFinished(ev) {
    const comp = ev.competitions?.[0];
    if (!comp) return false;
    const status = comp.status?.type;
    if (status?.completed === true) return true;
    if (status?.state === 'post') return true;
    const name = (status?.name || '').toLowerCase();
    return name.includes('final') || name.includes('full time') || name === 'status_final';
}

function parseMatchCandidate(ev, leagueCode, dateStr) {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) return null;
    return {
        matchId: String(ev.id),
        leagueCode,
        date: dateStr,
        homeTeam: home.team?.displayName || 'Home',
        awayTeam: away.team?.displayName || 'Away',
        finalScore: `${home.score ?? 0}-${away.score ?? 0}`,
    };
}

async function getScoreboard(leagueCode, dateStr) {
    const url = `${BASE_URL}/${leagueCode}/scoreboard?dates=${dateStr}`;
    const { data } = await axios.get(url, { timeout: 20000 });
    return data.events || [];
}

async function getSummary(leagueCode, eventId, usePt) {
    const url = getSummaryUrl(leagueCode, eventId, usePt);
    const { data } = await axios.get(url, { timeout: 20000 });
    return data;
}

function extractKeyEvents(summary) {
    const raw = summary.keyEvents;
    if (!Array.isArray(raw)) return [];
    return raw.map((event) => ({
        id: event.id != null ? String(event.id) : undefined,
        typeId: event.type?.id != null ? String(event.type.id) : undefined,
        typeText: (event.type?.text || '').trim(),
        minute: event.clock?.displayValue || "0'",
        description: event.text || '',
        teamId: event.team?.id != null ? String(event.team.id) : undefined,
    }));
}

function mergeKeyEvents(enEvents, ptEvents) {
    const byId = new Map();
    for (const ev of enEvents) {
        const key = ev.id || `${ev.typeId}-${ev.minute}`;
        byId.set(key, {
            id: ev.id,
            typeId: ev.typeId,
            typeEN: ev.typeText,
            typePT: '',
            minute: ev.minute,
            descriptionEN: ev.description,
            descriptionPT: '',
            teamId: ev.teamId,
        });
    }
    for (const ev of ptEvents) {
        const key = ev.id || `${ev.typeId}-${ev.minute}`;
        const existing = byId.get(key);
        if (existing) {
            existing.typePT = ev.typeText || existing.typePT;
            existing.descriptionPT = ev.description || existing.descriptionPT;
            if (!existing.typeId && ev.typeId) existing.typeId = ev.typeId;
        } else {
            byId.set(key, {
                id: ev.id,
                typeId: ev.typeId,
                typeEN: '',
                typePT: ev.typeText,
                minute: ev.minute,
                descriptionEN: '',
                descriptionPT: ev.description,
                teamId: ev.teamId,
            });
        }
    }
    return [...byId.values()].filter((e) => e.typeId);
}

const RECOMMENDED_CATEGORY = {
    '70': 'GOAL',
    '76': 'SUBSTITUTION',
    '80': 'MATCH_START',
    '81': 'HALF_TIME',
    '82': 'SECOND_HALF_START',
    '83': 'SKIP',
    '84': 'EXTRA_TIME_START',
    '85': 'EXTRA_TIME_HALF',
    '86': 'EXTRA_TIME_SECOND_HALF',
    '87': 'EXTRA_TIME_END',
    '88': 'SHOOTOUT_START',
    '89': 'SKIP',
    '93': 'RED_CARD',
    '94': 'YELLOW_CARD',
    '97': 'GOAL',
    '98': 'GOAL',
    '114': 'PENALTY_MISSED',
    '129': 'MATCH_DELAY_START',
    '130': 'MATCH_DELAY_END',
    '137': 'GOAL',
    '138': 'GOAL',
    '173': 'GOAL',
    '167': 'VAR',
};

function recommendCategory(typeId, typeEN, typePT) {
    if (RECOMMENDED_CATEGORY[typeId]) return RECOMMENDED_CATEGORY[typeId];
    const t = `${typeEN} ${typePT}`.toLowerCase();
    if (t.includes('goal') || t.includes('gol')) return 'GOAL';
    if (t.includes('red') || t.includes('vermelho')) return 'RED_CARD';
    if (t.includes('yellow') || t.includes('amarelo')) return 'YELLOW_CARD';
    if (t.includes('substitut') || t.includes('substitui')) return 'SUBSTITUTION';
    if (t.includes('var')) return 'VAR';
    if (t.includes('delay') || t.includes('atrasad')) return 'MATCH_DELAY_START';
    return 'UNKNOWN';
}

function aggregateTypes(sampledMatches, classify) {
    const catalog = new Map();

    for (const match of sampledMatches) {
        for (const ev of match.keyEvents) {
            const typeId = ev.typeId;
            if (!typeId) continue;

            if (!catalog.has(typeId)) {
                catalog.set(typeId, {
                    typeId,
                    typeEN: ev.typeEN,
                    typePT: ev.typePT,
                    typeENVariants: new Set(),
                    typePTVariants: new Set(),
                    count: 0,
                    leagues: new Set(),
                    sampleDescriptions: [],
                });
            }
            const entry = catalog.get(typeId);
            entry.count++;
            entry.leagues.add(match.leagueCode);
            if (ev.typeEN) entry.typeENVariants.add(ev.typeEN);
            if (ev.typePT) entry.typePTVariants.add(ev.typePT);
            if (!entry.typeEN && ev.typeEN) entry.typeEN = ev.typeEN;
            if (!entry.typePT && ev.typePT) entry.typePT = ev.typePT;

            if (entry.sampleDescriptions.length < 3) {
                const dup = entry.sampleDescriptions.some(
                    (s) => s.descriptionEN === ev.descriptionEN && s.descriptionPT === ev.descriptionPT
                );
                if (!dup) {
                    entry.sampleDescriptions.push({
                        matchId: match.matchId,
                        leagueCode: match.leagueCode,
                        minute: ev.minute,
                        descriptionEN: (ev.descriptionEN || '').slice(0, 150),
                        descriptionPT: (ev.descriptionPT || '').slice(0, 150),
                    });
                }
            }
        }
    }

    const result = [...catalog.values()]
        .sort((a, b) => Number(a.typeId) - Number(b.typeId))
        .map((entry) => {
            const typePTLower = (entry.typePT || '').toLowerCase();
            const currentMapping = classify(typePTLower, entry.typeId);
            const recommended = recommendCategory(entry.typeId, entry.typeEN, entry.typePT);
            const isGap = currentMapping == null && recommended !== 'SKIP' && recommended !== 'UNKNOWN';

            return {
                typeId: entry.typeId,
                typeEN: entry.typeEN,
                typePT: entry.typePT,
                typeENVariants: [...entry.typeENVariants].sort(),
                typePTVariants: [...entry.typePTVariants].sort(),
                count: entry.count,
                leagues: [...entry.leagues].sort(),
                sampleDescriptions: entry.sampleDescriptions,
                currentMapping,
                recommendedCategory: recommended,
                isGap,
            };
        });

    return result;
}

function buildMarkdown(catalog, sampledMatches, meta) {
    const lines = [];
    const gaps = catalog.filter((c) => c.isGap);
    const hydration = catalog.filter((c) => c.typeId === '129' || c.typeId === '130');

    lines.push('# Catálogo de tipos de evento ESPN (2026)');
    lines.push('');
    lines.push(`Gerado em: ${meta.generatedAt}`);
    lines.push(`Amostra: ${sampledMatches.length} partidas | ${catalog.length} typeIds únicos | ${gaps.length} gaps`);
    lines.push(`Seed: ${meta.seed} | Ano: ${meta.year}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Resumo executivo');
    lines.push('');
    lines.push(`- **Partidas amostradas:** ${sampledMatches.length}`);
    lines.push(`- **Ligas com partidas:** ${meta.leaguesUsed.join(', ')}`);
    lines.push(`- **TypeIds únicos:** ${catalog.length}`);
    lines.push(`- **Gaps (sem mapeamento no bot):** ${gaps.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Catálogo completo');
    lines.push('');
    lines.push('| typeId | EN | PT | Freq | Mapeamento atual | Recomendado |');
    lines.push('|--------|----|----|------|------------------|-------------|');
    for (const c of catalog) {
        const cur = c.currentMapping ?? '—';
        lines.push(`| ${c.typeId} | ${c.typeEN || '—'} | ${c.typePT || '—'} | ${c.count} | ${cur} | ${c.recommendedCategory} |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Gaps prioritários');
    lines.push('');
    if (gaps.length === 0) {
        lines.push('*Nenhum gap prioritário encontrado na amostra.*');
    } else {
        lines.push('| typeId | EN | PT | Freq | Recomendado |');
        lines.push('|--------|----|----|------|-------------|');
        for (const c of gaps) {
            lines.push(`| ${c.typeId} | ${c.typeEN || '—'} | ${c.typePT || '—'} | ${c.count} | ${c.recommendedCategory} |`);
        }
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Hidratação / pausas (typeId 129 e 130)');
    lines.push('');
    if (hydration.length === 0) {
        lines.push('*Nenhum evento de hidratação na amostra. Tente aumentar SAMPLE_SIZE ou priorizar fifa.world.*');
    } else {
        for (const c of hydration) {
            lines.push(`### typeId ${c.typeId} — ${c.typeEN} / ${c.typePT}`);
            lines.push('');
            lines.push(`- Frequência na amostra: ${c.count}`);
            lines.push(`- Ligas: ${c.leagues.join(', ')}`);
            lines.push('');
            for (const s of c.sampleDescriptions) {
                lines.push(`**${s.matchId}** (${s.leagueCode}, ${s.minute}):`);
                if (s.descriptionEN) lines.push(`- EN: ${s.descriptionEN}`);
                if (s.descriptionPT) lines.push(`- PT: ${s.descriptionPT}`);
                lines.push('');
            }
        }
    }
    lines.push('---');
    lines.push('');
    lines.push('## Diff sugerido para ID_TO_CATEGORY');
    lines.push('');
    lines.push('```js');
    lines.push('// Adicionar ao ID_TO_CATEGORY em src/bot/eventProcessor.js');
    for (const c of catalog) {
        if (c.recommendedCategory === 'SKIP' || c.recommendedCategory === 'UNKNOWN') continue;
        if (c.currentMapping === c.recommendedCategory) continue;
        const comment = c.typeEN || c.typePT || '';
        lines.push(`'${c.typeId}': '${c.recommendedCategory}',  // ${comment}`);
    }
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Partidas amostradas');
    lines.push('');
    lines.push('| Data | Liga | Partida | Eventos |');
    lines.push('|------|------|---------|---------|');
    for (const m of sampledMatches) {
        lines.push(`| ${m.date} | ${m.leagueCode} | ${m.homeTeam} x ${m.awayTeam} (${m.finalScore}) | ${m.keyEvents.length} |`);
    }
  lines.push('');

    return lines.join('\n');
}

async function collectCandidates(leagueCodes, dates, rng, minPoolSize) {
    const pool = [];
    const perLeague = new Map(leagueCodes.map((c) => [c, []]));

    const pairs = [];
    for (const leagueCode of leagueCodes) {
        for (const dateStr of dates) {
            pairs.push({ leagueCode, dateStr });
        }
    }
    for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    let requests = 0;
    for (const { leagueCode, dateStr } of pairs) {
        if (pool.length >= minPoolSize) break;
        try {
            const events = await getScoreboard(leagueCode, dateStr);
            requests++;
            if (requests % 25 === 0) {
                console.log(`  ... ${requests} scoreboard requests, ${pool.length} candidates so far`);
            }
            await sleep(REQUEST_DELAY_MS);
            for (const ev of events) {
                if (!isMatchFinished(ev)) continue;
                const candidate = parseMatchCandidate(ev, leagueCode, dateStr);
                if (candidate) {
                    pool.push(candidate);
                    perLeague.get(leagueCode).push(candidate);
                }
            }
        } catch (err) {
            console.warn(`  Scoreboard ${leagueCode} ${dateStr}: ${err.message}`);
        }
    }

    return { pool, perLeague, requests };
}

function selectSample(pool, perLeague, sampleSize, rng, minPerLeague = 2) {
    const selected = [];
    const selectedIds = new Set();

    const pick = (candidate) => {
        if (selected.length >= sampleSize) return false;
        if (selectedIds.has(candidate.matchId)) return false;
        selectedIds.add(candidate.matchId);
        selected.push(candidate);
        return true;
    };

    // Stratify: at least minPerLeague per league when available
    const leagueOrder = [...perLeague.keys()].sort(() => rng() - 0.5);
    for (const leagueCode of leagueOrder) {
        const candidates = perLeague.get(leagueCode) || [];
        const shuffled = [...candidates].sort(() => rng() - 0.5);
        let taken = 0;
        for (const c of shuffled) {
            if (taken >= minPerLeague) break;
            if (pick(c)) taken++;
        }
    }

    // Fill remaining from shuffled pool
    const remaining = [...pool].sort(() => rng() - 0.5);
    for (const c of remaining) {
        pick(c);
    }

    return selected;
}

async function fetchExtraFifaWorld(perLeague, pool, targetExtra = 10) {
    const existing = perLeague.get('fifa.world') || [];
    if (existing.length >= targetExtra) return;

    const rng = mulberry32(SAMPLE_SEED + 999);
    const extraDates = generateRandomDates(YEAR, 40, rng, 188);
    const extraPool = [...existing];
    const extraIds = new Set(existing.map((c) => c.matchId));

    for (const dateStr of extraDates) {
        if (extraPool.length >= targetExtra) break;
        try {
            const events = await getScoreboard('fifa.world', dateStr);
            await sleep(REQUEST_DELAY_MS);
            for (const ev of events) {
                if (!isMatchFinished(ev)) continue;
                const candidate = parseMatchCandidate(ev, 'fifa.world', dateStr);
                if (candidate && !extraIds.has(candidate.matchId)) {
                    extraIds.add(candidate.matchId);
                    extraPool.push(candidate);
                    pool.push(candidate);
                }
            }
        } catch {
            // skip
        }
    }
    perLeague.set('fifa.world', extraPool);
}

function ensureOutputDir() {
    try {
        mkdirSync(OUTPUT_DIR, { recursive: true });
    } catch (err) {
        console.error(`[Audit] Failed to create output dir ${OUTPUT_DIR}: ${err.message}`);
        throw err;
    }
}

async function loadClassifier() {
    process.env.NODE_ENV = 'test';
    process.env.STATE_DIR = path.join(process.cwd(), 'data', '.audit-tmp-state');
    mkdirSync(process.env.STATE_DIR, { recursive: true });
    const mod = await import('../src/bot/eventProcessor.js');
    return mod.categorizeEvent;
}

async function main() {
    ensureOutputDir();
    categorizeEvent = await loadClassifier();

    const leagueCodes = resolveLeagueCodes();
    const rng = mulberry32(SAMPLE_SEED);

    const today = new Date();
    const endDayOfYear = today.getUTCFullYear() === YEAR
        ? Math.floor((today - new Date(Date.UTC(YEAR, 0, 1))) / 86400000) + 1
        : daysInYear(YEAR);

    const dates = generateRandomDates(YEAR, 60, rng, endDayOfYear);

    console.log(`ESPN event type audit — year ${YEAR}, sample ${SAMPLE_SIZE}, seed ${SAMPLE_SEED}`);
    console.log(`Leagues: ${leagueCodes.length} | Date pool: ${dates.length} days`);

    console.log('\nPhase 1: Collecting match candidates from scoreboards...');
    const minPoolSize = SAMPLE_SIZE * 4;
    let { pool, perLeague, requests: scoreboardRequests } = await collectCandidates(
        leagueCodes, dates, rng, minPoolSize
    );
    console.log(`  Scoreboard requests: ${scoreboardRequests} | Candidates found: ${pool.length}`);

    if (leagueCodes.includes('fifa.world')) {
        console.log('  Boosting fifa.world pool for hydration coverage...');
        await fetchExtraFifaWorld(perLeague, pool);
        console.log(`  fifa.world candidates: ${(perLeague.get('fifa.world') || []).length}`);
    }

    const selected = selectSample(pool, perLeague, SAMPLE_SIZE, rng);
    console.log(`\nPhase 2: Fetching summaries for ${selected.length} matches (EN + PT)...`);

    const sampledMatches = [];
    for (let i = 0; i < selected.length; i++) {
        const m = selected[i];
        process.stdout.write(`  [${i + 1}/${selected.length}] ${m.leagueCode} ${m.homeTeam} x ${m.awayTeam}...`);

        try {
            const [summaryEN, summaryPT] = await Promise.all([
                getSummary(m.leagueCode, m.matchId, false),
                getSummary(m.leagueCode, m.matchId, true),
            ]);
            await sleep(REQUEST_DELAY_MS);

            const enEvents = extractKeyEvents(summaryEN);
            const ptEvents = extractKeyEvents(summaryPT);
            const keyEvents = mergeKeyEvents(enEvents, ptEvents);

            sampledMatches.push({ ...m, keyEvents });
            console.log(` ${keyEvents.length} events`);
        } catch (err) {
            console.log(` FAILED: ${err.message}`);
        }
    }

    console.log('\nPhase 3: Aggregating type catalog...');
    const catalog = aggregateTypes(sampledMatches, categorizeEvent);
    const gaps = catalog.filter((c) => c.isGap);
    const leaguesUsed = [...new Set(sampledMatches.map((m) => m.leagueCode))].sort();

    const meta = {
        generatedAt: new Date().toISOString(),
        year: YEAR,
        seed: SAMPLE_SEED,
        sampleSize: SAMPLE_SIZE,
        matchesCollected: sampledMatches.length,
        uniqueTypeIds: catalog.length,
        gapCount: gaps.length,
        leaguesUsed,
    };

    console.log('\nPhase 4: Writing output files...');
    const samplePath = path.join(OUTPUT_DIR, 'sample-2026.json');
    writeFileSync(samplePath, JSON.stringify({ meta, matches: sampledMatches }, null, 2), 'utf8');

    const catalogPath = path.join(OUTPUT_DIR, 'type-catalog-2026.json');
    writeFileSync(catalogPath, JSON.stringify({ meta, types: catalog }, null, 2), 'utf8');

    const mdPath = path.join(OUTPUT_DIR, 'type-catalog-2026.md');
    writeFileSync(mdPath, buildMarkdown(catalog, sampledMatches, meta), 'utf8');

    console.log('\n=== Summary ===');
    console.log(`Matches collected: ${sampledMatches.length}`);
    console.log(`Unique typeIds: ${catalog.length}`);
    console.log(`Gaps: ${gaps.length}`);
    if (gaps.length) {
        console.log('Gap typeIds:', gaps.map((g) => `${g.typeId} (${g.typeEN || g.typePT})`).join(', '));
    }
    const h129 = catalog.find((c) => c.typeId === '129');
    const h130 = catalog.find((c) => c.typeId === '130');
    console.log(`Hydration 129: ${h129 ? h129.count + ' events' : 'not in sample'}`);
    console.log(`Hydration 130: ${h130 ? h130.count + ' events' : 'not in sample'}`);
    console.log(`\nSaved:\n  ${samplePath}\n  ${catalogPath}\n  ${mdPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
