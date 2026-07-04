/**
 * Fetch past match data from ESPN API and save to JSON for mock stream replay.
 *
 * Usage:
 *   DATE=20250615 LEAGUE_CODES=bra.1 node scripts/fetch-past-events.js
 *   DATE=2025-06-15 LEAGUE_CODES=bra.1,eng.1 node scripts/fetch-past-events.js
 *
 * Output: data/match-snapshots/YYYYMMDD.json
 *
 * The saved JSON contains full match metadata + keyEvents + boxscore per match,
 * which mock-stream.js uses to replay the match locally in real time.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { leagues } from '../src/data/leagues.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB_BASE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';

function getSummaryUrl(leagueCode, eventId) {
    const usePt = process.env.ESPN_USE_PT_DESCRIPTIONS === 'true';
    const base = usePt ? WEB_BASE_URL : BASE_URL;
    const qs = usePt ? '&lang=pt&region=br' : '';
    return `${base}/${leagueCode}/summary?event=${eventId}${qs}`;
}

function resolveDate() {
    const raw = (process.env.DATE || '').trim();
    if (!raw) {
        console.error('ERROR: Set DATE env var (YYYYMMDD or YYYY-MM-DD).');
        process.exit(1);
    }
    return raw.replace(/-/g, '');
}

function getOutputDir() {
    const dir = path.join(process.cwd(), 'data', 'match-snapshots');
    mkdirSync(dir, { recursive: true });
    return dir;
}

async function getScoreboard(leagueCode, dateStr) {
    const url = `${BASE_URL}/${leagueCode}/scoreboard?dates=${dateStr}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    return data.events || [];
}

async function getSummary(leagueCode, eventId) {
    const url = getSummaryUrl(leagueCode, eventId);
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
}

function parseMatchFromScoreboard(event, leagueCode) {
    const comp = event.competitions?.[0];
    if (!comp) return null;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) return null;

    const venueAddr = comp.venue?.address;
    return {
        id: event.id,
        leagueCode,
        leagueName: leagues[leagueCode]?.name || leagueCode,
        leagueHashtags: leagues[leagueCode]?.hashtags || [],
        homeTeam: {
            id: home.team?.id,
            name: home.team?.displayName || 'Casa',
            logo: home.team?.logo,
            form: home.form || undefined,
            record: home.records?.find(r => r.type === 'total')?.summary || undefined,
        },
        awayTeam: {
            id: away.team?.id,
            name: away.team?.displayName || 'Visitante',
            logo: away.team?.logo,
            form: away.form || undefined,
            record: away.records?.find(r => r.type === 'total')?.summary || undefined,
        },
        homeScore: parseInt(home.score, 10) || 0,
        awayScore: parseInt(away.score, 10) || 0,
        status: comp.status?.type?.name || 'unknown',
        state: comp.status?.type?.state || 'unknown',
        venue: comp.venue?.fullName || 'Não informado',
        venueCity: venueAddr?.city || undefined,
        startTime: event.date,
        minute: comp.status?.displayClock || "0'",
    };
}

function enrichFromSummary(match, summary) {
    const header = summary.header;
    const comp = header?.competitions?.[0];
    if (!comp) return match;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');

    if (home) {
        match.homeScore = parseInt(home.score, 10) || match.homeScore;
        match.homeShootoutScore = home.shootoutScore != null ? parseInt(home.shootoutScore, 10) : undefined;
        if (home.team?.id) match.homeTeam.id = home.team.id;
    }
    if (away) {
        match.awayScore = parseInt(away.score, 10) || match.awayScore;
        match.awayShootoutScore = away.shootoutScore != null ? parseInt(away.shootoutScore, 10) : undefined;
        if (away.team?.id) match.awayTeam.id = away.team.id;
    }

    match.status = comp.status?.type?.name || match.status;
    match.venue = comp.venue?.fullName || match.venue;

    // Standings
    const standings = summary.standings;
    if (standings) {
        const entries = standings.groups?.[0]?.standings?.entries;
        if (entries?.length) {
            const parseStanding = (teamId) => {
                const entry = entries.find(e => String(e.team?.id) === String(teamId));
                if (!entry) return undefined;
                const stat = (name) => {
                    const s = entry.stats?.find(s => s.name === name);
                    return s != null ? Number(s.value) : undefined;
                };
                return {
                    rank: stat('rank'),
                    points: stat('points'),
                    wins: stat('wins'),
                    losses: stat('losses'),
                    ties: stat('ties'),
                    gamesPlayed: stat('gamesPlayed'),
                };
            };
            if (home?.team?.id) match.homeTeam.standing = parseStanding(home.team.id);
            if (away?.team?.id) match.awayTeam.standing = parseStanding(away.team.id);
        }
    }

    // Boxscore
    const rawBoxscore = summary.boxscore;
    if (rawBoxscore?.teams?.length) {
        const boxscore = {};
        for (const teamData of rawBoxscore.teams) {
            const side = teamData.homeAway === 'home' ? 'home' : 'away';
            const stat = (name) => {
                const s = teamData.statistics?.find(s => s.name === name);
                return s != null ? s.displayValue ?? s.value : undefined;
            };
            boxscore[side] = {
                possessionPct: stat('possessionPct'),
                totalShots: stat('totalShots'),
                shotsOnTarget: stat('shotsOnTarget'),
                wonCorners: stat('wonCorners'),
                yellowCards: stat('yellowCards'),
                redCards: stat('redCards'),
                saves: stat('saves'),
            };
        }
        if (boxscore.home || boxscore.away) match.boxscore = boxscore;
    }

    return match;
}

function parseKeyEvents(summary) {
    const raw = summary.keyEvents;
    const keyEvents = Array.isArray(raw) ? raw : [];

    return keyEvents.map(event => {
        const type = event.type?.text?.toLowerCase() || 'event';
        const typeId = event.type?.id != null ? String(event.type.id) : undefined;
        const minute = event.clock?.displayValue || "0'";
        const clockSeconds = event.clock?.seconds;
        const description = event.text;

        const p0 = event.participants?.[0]?.athlete;
        const p1 = event.participants?.[1]?.athlete;
        const p0Name = p0?.displayName || p0?.shortDisplayName || p0?.fullName;
        const p1Name = p1?.displayName || p1?.shortDisplayName || p1?.fullName;

        const base = {
            id: event.id,
            typeId,
            type,
            minute,
            clockSeconds: clockSeconds != null ? Number(clockSeconds) : undefined,
            teamId: event.team?.id,
            description,
            player: p0Name != null ? { name: p0Name } : undefined,
        };

        if (type.includes('substitution') || type.includes('sub') || type.includes('substituição')) {
            base.playerIn = p0Name ? { name: p0Name } : undefined;
            base.playerOut = p1Name ? { name: p1Name } : undefined;
            if (base.playerIn) base.player = base.playerIn;
        } else if (type.includes('goal') || type.includes('gol') || type.includes('penalty') || type.includes('pênalti')) {
            const m = description?.match(/(?:Goal|Gol)![\s\S]*?\.\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s'-]+?)\s*\(/);
            if (m) base.player = { name: m[1].trim() };
        }

        return base;
    });
}

async function main() {
    const dateStr = resolveDate();
    const leagueCodesStr = process.env.LEAGUE_CODES || process.env.LEAGUE_CODE || 'bra.1';
    const leagueCodes = leagueCodesStr.split(',').map(s => s.trim()).filter(Boolean);

    const invalid = leagueCodes.filter(c => !leagues[c]);
    if (invalid.length) {
        console.error(`Invalid league codes: ${invalid.join(', ')}`);
        console.error(`Supported: ${Object.keys(leagues).join(', ')}`);
        process.exit(1);
    }

    console.log(`Fetching matches for ${dateStr}, leagues: ${leagueCodes.join(', ')}`);

    const matches = [];

    for (const leagueCode of leagueCodes) {
        const leagueName = leagues[leagueCode]?.name || leagueCode;
        console.log(`\n--- ${leagueName} (${leagueCode}) ---`);

        let events;
        try {
            events = await getScoreboard(leagueCode, dateStr);
        } catch (err) {
            console.error(`  Error fetching scoreboard: ${err.message}`);
            continue;
        }

        console.log(`  Found ${events.length} match(es)`);

        for (const event of events) {
            const match = parseMatchFromScoreboard(event, leagueCode);
            if (!match) {
                console.warn(`  Skipping event ${event.id} (no valid competitors)`);
                continue;
            }

            console.log(`  ${match.homeTeam.name} x ${match.awayTeam.name} (${match.id})`);

            try {
                const summary = await getSummary(leagueCode, event.id);
                enrichFromSummary(match, summary);
                match.keyEvents = parseKeyEvents(summary);
                console.log(`    -> ${match.keyEvents.length} key event(s), final: ${match.homeScore}x${match.awayScore}`);
            } catch (err) {
                console.warn(`    -> Summary fetch failed: ${err.message}`);
                match.keyEvents = [];
            }

            matches.push(match);
        }
    }

    if (matches.length === 0) {
        console.log('\nNo matches found. Nothing saved.');
        return;
    }

    const outputDir = getOutputDir();
    const outputFile = path.join(outputDir, `${dateStr}.json`);

    const payload = {
        fetchedAt: new Date().toISOString(),
        date: dateStr,
        matchCount: matches.length,
        matches,
    };

    writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nSaved ${matches.length} match(es) to ${outputFile}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
