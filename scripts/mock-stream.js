/**
 * Replay saved ESPN match data locally in real time, posting to Mastodon.
 *
 * Reads JSON files produced by fetch-past-events.js and simulates the match
 * timeline with configurable speed, using existing formatters and Mastodon API.
 *
 * Usage:
 *   # Dry run (no Mastodon posts, just console output)
 *   DRY_RUN=true node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # 60x speed (90 min match → 90 seconds)
 *   SPEED=60 node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # Real-time replay (1x)
 *   SPEED=1 node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # Pick specific match by index (0-based)
 *   MATCH_INDEX=0 node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # Filter by league
 *   LEAGUE_CODE=bra.1 node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # Skip lifecycle events (match start, halftime, etc.)
 *   SKIP_LIFECYCLE=true node scripts/mock-stream.js data/match-snapshots/20250615.json
 *
 *   # Verbose logging
 *   VERBOSE=true node scripts/mock-stream.js data/match-snapshots/20250615.json
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initI18n, translate } from '../src/services/i18n.js';
import { config } from '../src/config.js';
import { postStatus } from '../src/api/mastodon.js';

// Initialize i18n
initI18n(config.i18n?.defaultLanguage || 'pt-BR');

const VERBOSE = process.env.VERBOSE === 'true';
const SKIP_LIFECYCLE = process.env.SKIP_LIFECYCLE === 'true';
const SPEED = Math.max(0.1, parseFloat(process.env.SPEED || '60') || 60);
const MATCH_INDEX = parseInt(process.env.MATCH_INDEX, 10);

// ─── Event classification (mirrors eventProcessor.js ID_TO_CATEGORY) ────────

const ID_TO_CATEGORY = {
    '70': 'GOAL', '97': 'GOAL', '98': 'GOAL', '114': 'PENALTY_MISSED',
    '137': 'GOAL', '138': 'GOAL', '173': 'GOAL',
    '93': 'RED_CARD', '94': 'YELLOW_CARD', '76': 'SUBSTITUTION', '167': 'VAR',
    '80': 'MATCH_START', '81': 'HALF_TIME', '82': 'SECOND_HALF_START',
    '83': 'END_REGULAR_TIME',
    '84': 'EXTRA_TIME_START', '85': 'EXTRA_TIME_HALF',
    '86': 'EXTRA_TIME_SECOND_HALF', '87': 'EXTRA_TIME_END', '88': 'SHOOTOUT_START',
    '129': 'MATCH_DELAY_START', '130': 'MATCH_DELAY_END',
};

// ESPN timing/housekeeping event IDs that carry no post-worthy content — silently skip
const IGNORED_TYPE_IDS = new Set(['89']);

function isPenaltyMissedType(type, typeId) {
    if (typeId === '114') return true;
    const t = (type || '').toLowerCase();
    return t.includes('pênalti - defendido') || t.includes('penalty - saved') || t.includes('pênalti defendido');
}

function categorizeEvent(type, typeId) {
    if (typeId != null) {
        if (IGNORED_TYPE_IDS.has(String(typeId))) return null;
        const cat = ID_TO_CATEGORY[String(typeId)];
        if (cat) return cat;
    }
    const t = (type || '').toLowerCase();
    if (isPenaltyMissedType(type, typeId)) return 'PENALTY_MISSED';
    if (t.includes('goal') || t.includes('gol')) return 'GOAL';
    if (t.includes('penalty') || t.includes('pênalti')) return 'GOAL';
    if (t.includes('yellow')) return 'YELLOW_CARD';
    if (t.includes('red') || t.includes('second yellow') || t.includes('vermelho')) return 'RED_CARD';
    if (t.includes('substitut') || t.includes('sub ')) return 'SUBSTITUTION';
    if (t.includes('var')) return 'VAR';
    if (t.includes('start delay') || t.includes('jogo atrasado')) return 'MATCH_DELAY_START';
    if (t.includes('end delay') || t.includes('fim do atraso')) return 'MATCH_DELAY_END';
    if (t.includes('start extra time') || t.includes('começo da prorrogação')) return 'EXTRA_TIME_START';
    if (t.includes('halftime extra time') || t.includes('intervalo da prorrogação')) return 'EXTRA_TIME_HALF';
    if (t.includes('start 2nd half extra time') || t.includes('começo do 2º tempo da prorrogação')) return 'EXTRA_TIME_SECOND_HALF';
    if (t.includes('end extra time') || t.includes('fim da prorrogação')) return 'EXTRA_TIME_END';
    if (t.includes('start shootout') || t.includes('começo da disputa de pênaltis')) return 'SHOOTOUT_START';
    if (t.includes('end regular time') || t.includes('fim do tempo regulamentar') || t.includes('fim do segundo tempo')) return 'END_REGULAR_TIME';
    if (t.includes('2nd half') || t.includes('second half') || t.includes('começo do 2º tempo')) return 'SECOND_HALF_START';
    if (t.includes('kickoff') || t.includes('kick off') || t.includes('começo')) return 'MATCH_START';
    if (t.includes('full time') || t.includes('fulltime')) return 'MATCH_END';
    if (t.includes('half time') || t.includes('halftime') || t.includes('intervalo')) return 'HALF_TIME';
    return null;
}

function normalizeDelayMinute(minute) {
    return String(minute ?? '').trim().replace(/'+$/, '');
}

function getMatchDelayKey(category, minute) {
    const phase = category === 'MATCH_DELAY_START' ? 'start' : 'end';
    return `${phase}-${normalizeDelayMinute(minute)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the scoring team object from event.teamId, matching against home/away by string comparison. */
function resolveScoringTeam(event, match) {
    if (!event.teamId) return null;
    const id = String(event.teamId);
    if (id === String(match.homeTeam.id)) return match.homeTeam;
    if (id === String(match.awayTeam.id)) return match.awayTeam;
    return null;
}

/** Returns a view of match with homeScore/awayScore overridden by the running tally. */
function liveMatch(match, score) {
    return { ...match, homeScore: score.home, awayScore: score.away };
}

/** Parse minute string (e.g. "23'", "45+2", "HT") to seconds from kickoff. */
function parseMinuteToSeconds(display, clockSeconds) {
    if (clockSeconds != null) return Number(clockSeconds);
    if (!display) return 0;
    const s = String(display).trim();
    // Half-time / full-time markers
    if (/^(ht|half|interval)$/i.test(s)) return 45 * 60;
    if (/^(ft|full\s*time|final)$/i.test(s)) return 90 * 60;
    if (/^(et|extra)$/i.test(s)) return 105 * 60;
    // "45+2" → 47*60, "23'" → 23*60
    const m = s.match(/(\d+)\+?(\d+)?/);
    if (m) {
        const base = parseInt(m[1], 10) || 0;
        const added = parseInt(m[2], 10) || 0;
        return (base + added) * 60;
    }
    return 0;
}

/** Map match seconds to real delay in ms. */
function toRealDelay(matchSeconds) {
    return Math.round((matchSeconds / SPEED) * 1000);
}

function log(...args) {
    if (VERBOSE) console.log(...args);
}

// ─── Formatters (inline, matching formatter.js output) ──────────────────────

function playerName(player) {
    if (player == null) return undefined;
    if (typeof player === 'string') return player;
    return player?.name;
}

function displayMinute(value) {
    const raw = (value != null ? String(value).trim() : '').replace(/'+$/, '');
    return raw || '?';
}

function standingAnnotation(standing) {
    if (!standing?.rank || standing?.points == null) return '';
    const parts = [];
    if (standing.rank != null) parts.push(`${standing.rank}º`);
    if (standing.points != null) parts.push(`${standing.points}pts`);
    return parts.length ? ` (${parts.join(' · ')})` : '';
}

function getTeamHashtag(teamName) {
    if (!teamName) return '';
    const clean = teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '');
    return `#${clean}`;
}

function formatGoal(event, match) {
    const scorer = playerName(event.player) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);
    const typeLower = event.type?.toLowerCase() ?? '';
    const isOwnGoal = typeLower.includes('own') || typeLower.includes('autogol');
    const isPenalty = (typeLower.includes('penalty') || typeLower.includes('pênalti'))
        && !isPenaltyMissedType(event.type, event.typeId);

    let text = '';
    if (isOwnGoal) text += translate('ui.own_goal_announcement');
    else if (isPenalty) text += translate('ui.penalty_goal_announcement');
    else text += translate('ui.goal_announcement');
    text += '\n\n';
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}`;
    const desc = event.description || '';
    if (desc) text += `\n\n📝 ${desc}`;
    const scoringTeam = resolveScoringTeam(event, match);
    text += `\n\n${getTeamHashtag(scoringTeam?.name || match.homeTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatPenaltyMissed(event, match) {
    const player = playerName(event.player) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.penalty_missed_announcement')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}`;
    const desc = event.description || '';
    if (desc) text += `\n\n📝 ${desc}`;
    text += `\n\n${getTeamHashtag(event.team?.name || match.homeTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function parseDelayReason(description) {
    const d = (description || '').toLowerCase();
    if (d.includes('hidratação') || d.includes('drinks break')) return 'hydration';
    if (d.includes('lesão') || d.includes('lesao') || d.includes('injury')) return 'injury';
    return 'generic';
}

function formatMatchDelayStart(event, match) {
    const minute = displayMinute(event.minute);
    const reason = parseDelayReason(event.description);
    const announcementKey = reason === 'hydration'
        ? 'ui.match_delay_hydration_start'
        : reason === 'injury'
            ? 'ui.match_delay_injury_start'
            : 'ui.match_delay_generic_start';

    let text = `${translate(announcementKey)}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    if (event.description) text += `\n📝 ${event.description}\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatMatchDelayEnd(event, match) {
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.match_delay_end')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    if (event.description) text += `\n📝 ${event.description}\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatCard(event, match) {
    const typeLower = event.type?.toLowerCase() ?? '';
    const isRed = typeLower.includes('red') || typeLower.includes('vermelho');
    const cardType = isRed ? translate('ui.red_card_announcement') : translate('ui.yellow_card_announcement');
    const player = playerName(event.player) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${cardType}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}`;
    const desc = event.description || '';
    if (desc) text += `\n\n📝 ${desc}`;
    text += `\n\n${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatSubstitution(event, match) {
    const playerIn = playerName(event.playerIn) || translate('common.unknown_player');
    const playerOut = playerName(event.playerOut) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.substitution_announcement')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `⬆️ ${translate('ui.player_in')}: ${playerIn}\n`;
    text += `⬇️ ${translate('ui.player_out')}: ${playerOut}`;
    text += `\n\n${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatMatchStart(match) {
    let text = `${translate('ui.match_start')}\n\n`;
    text += `🏟️ ${match.homeTeam.name}${standingAnnotation(match.homeTeam.standing)} x ${match.awayTeam.name}${standingAnnotation(match.awayTeam.standing)}\n`;
    if (match.venue) text += `📍 ${match.venue}\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatHalfTime(match) {
    let text = `${translate('ui.half_time')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore ?? 0} x ${match.awayScore ?? 0} ${match.awayTeam.name}\n`;
    text += `⏱️ 45'\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatSecondHalfStart(match) {
    let text = `${translate('ui.second_half_start')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore ?? 0} x ${match.awayScore ?? 0} ${match.awayTeam.name}\n`;
    text += `⏱️ 46'\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatEndRegularTime(match) {
    let text = `${translate('ui.end_regular_time')}\n\n`;
    text += `🏟️ ${match.homeTeam.name} ${match.homeScore ?? 0} x ${match.awayScore ?? 0} ${match.awayTeam.name}\n`;
    text += `⏱️ 90'\n`;
    text += `\n${getTeamHashtag(match.homeTeam.name)} ${getTeamHashtag(match.awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatMatchEnd(match) {
    const { homeTeam, awayTeam, homeScore, awayScore, homeShootoutScore, awayShootoutScore } = match;
    const hasShootout = homeShootoutScore != null && awayShootoutScore != null;

    let result;
    if (hasShootout) {
        const winnerTeam = homeShootoutScore > awayShootoutScore ? homeTeam : awayTeam;
        result = translate('ui.team_wins', { team: winnerTeam.name });
    } else if (homeScore > awayScore) {
        result = translate('ui.team_wins', { team: homeTeam.name });
    } else if (awayScore > homeScore) {
        result = translate('ui.team_wins', { team: awayTeam.name });
    } else {
        result = translate('ui.draw');
    }

    let text = `${translate('ui.match_end')}\n\n`;
    text += `🏟️ ${homeTeam.name}${standingAnnotation(homeTeam.standing)} ${homeScore} x ${awayScore} ${awayTeam.name}${standingAnnotation(awayTeam.standing)}`;
    if (hasShootout) {
        text += ` (${homeShootoutScore} x ${awayShootoutScore} ${translate('ui.penalties')})`;
    }
    text += `\n\n${result}`;
    text += `\n\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatExtraTimeStart(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    let text = `${translate('ui.extra_time_start')}\n\n`;
    text += `⏱️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatExtraTimeHalf(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    let text = `${translate('ui.extra_time_half')}\n\n`;
    text += `⏱️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatExtraTimeSecondHalf(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    let text = `${translate('ui.extra_time_second_half')}\n\n`;
    text += `⏱️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function formatShootoutStart(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    let text = `${translate('ui.shootout_start')}\n\n`;
    text += `⏱️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `${translate('ui.extra_time_draw')}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

function possessionBar(homeStr, awayStr) {
    const h = parseFloat(homeStr);
    const a = parseFloat(awayStr);
    if (isNaN(h) || isNaN(a)) return null;
    const blocks = Math.round(h / 10);
    return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

function formatMatchStats(match) {
    const { homeTeam, awayTeam, homeScore, awayScore, boxscore } = match;
    if (!boxscore) return null;

    const h = boxscore.home;
    const a = boxscore.away;
    const stat = (side, key) => boxscore[side]?.[key];

    const statLine = (emoji, label, homeVal, awayVal, opts = {}) => {
        if (homeVal == null && awayVal == null) return null;
        const hv = homeVal ?? '-';
        const av = awayVal ?? '-';
        const hNum = Number(hv);
        const aNum = Number(av);
        let hArrow = '', aArrow = '';
        if (!isNaN(hNum) && !isNaN(aNum) && hNum !== aNum) {
            const homeWins = opts.lowerIsBetter ? hNum < aNum : hNum > aNum;
            if (homeWins) hArrow = ' ◀'; else aArrow = ' ▶';
        }
        return `${emoji} ${label}  ${hv}${hArrow} x ${av}${aArrow}`;
    };

    const lines = [];

    const hPoss = stat('home', 'possessionPct');
    const aPoss = stat('away', 'possessionPct');
    if (hPoss != null || aPoss != null) {
        const bar = possessionBar(hPoss, aPoss);
        const hPct = hPoss != null ? `${Math.round(parseFloat(hPoss))}%` : '-';
        const aPct = aPoss != null ? `${Math.round(parseFloat(aPoss))}%` : '-';
        lines.push(`📊 ${translate('ui.possession')}  ${hPct} ${bar ?? '|'} ${aPct}`);
    }
    lines.push(statLine('🥅', translate('ui.shots'), h?.totalShots, a?.totalShots));
    lines.push(statLine('🎯', translate('ui.shots_on_target'), h?.shotsOnTarget, a?.shotsOnTarget));
    lines.push(statLine('🚩', translate('ui.corners'), h?.wonCorners, a?.wonCorners));
    lines.push(statLine('🧤', translate('ui.saves'), h?.saves, a?.saves));
    lines.push(statLine('🟨', 'Amarelos', h?.yellowCards, a?.yellowCards, { lowerIsBetter: true }));
    lines.push(statLine('🟥', 'Vermelhos', h?.redCards, a?.redCards, { lowerIsBetter: true }));

    const validLines = lines.filter(Boolean);
    if (validLines.length === 0) return null;

    let text = `${translate('ui.match_stats')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n\n`;
    text += validLines.join('\n');
    text += `\n\n${(match.leagueHashtags || []).join(' ')}`;

    return text;
}

function formatDailyDigest(match) {
    let text = `${translate('ui.daily_digest')}\n\n`;
    text += `🏆 ${match.leagueName}\n`;
    text += `⚽ ${match.homeTeam.name} x ${match.awayTeam.name}`;
    const kickoff = formatKickoff(match.startTime);
    if (kickoff) text += ` — ${kickoff}`;
    text += '\n';
    const allHashtags = match.leagueHashtags || [];
    if (allHashtags.length) text += `\n${allHashtags.join(' ')}`;
    return text;
}

function formatForm(form) {
    if (!form) return '';
    return form.split('').map(c => {
        const u = c.toUpperCase();
        if (u === 'W') return '🟩';
        if (u === 'D') return '🟨';
        if (u === 'L') return '🟥';
        return '⬜';
    }).join('');
}

function formatMatchPreview(match) {
    const { homeTeam, awayTeam, venueCity } = match;
    const kickoff = formatKickoff(match.startTime);

    let text = `${translate('ui.match_preview')}\n\n`;
    text += `⚽ ${homeTeam.name} x ${awayTeam.name}`;
    if (kickoff) text += ` — ${kickoff}`;
    text += '\n';
    if (venueCity) text += `📍 ${venueCity}\n`;

    const homeForm = formatForm(homeTeam.form);
    const awayForm = formatForm(awayTeam.form);

    text += `\n🏠 ${homeTeam.name}\n`;
    if (homeForm) text += `   ${translate('ui.form')}: ${homeForm}\n`;
    if (homeTeam.record) text += `   ${translate('ui.record')}: ${homeTeam.record}\n`;

    text += `\n✈️ ${awayTeam.name}\n`;
    if (awayForm) text += `   ${translate('ui.form')}: ${awayForm}\n`;
    if (awayTeam.record) text += `   ${translate('ui.record')}: ${awayTeam.record}\n`;

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.leagueHashtags || []).join(' ')}`;
    return text;
}

/** Format kickoff time as HH:MM in the configured timezone. */
function formatKickoff(isoDate) {
    if (!isoDate) return '';
    try {
        return new Intl.DateTimeFormat('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: config.timezone,
        }).format(new Date(isoDate));
    } catch {
        return '';
    }
}

// ─── Timeline builder ───────────────────────────────────────────────────────

function buildTimeline(match, skipLifecycle) {
    const events = (match.keyEvents || [])
        .map(ev => ({
            ...ev,
            _matchSeconds: parseMinuteToSeconds(ev.minute, ev.clockSeconds),
            _category: categorizeEvent(ev.type, ev.typeId),
        }))
        .sort((a, b) => a._matchSeconds - b._matchSeconds);

    const timeline = [];

    if (!skipLifecycle) {
        // Always inject lifecycle events — they represent the canonical match flow
        timeline.push({ time: 0, type: 'lifecycle', label: 'MATCH_START' });
        timeline.push({ time: 45 * 60, type: 'lifecycle', label: 'HALF_TIME' });
        timeline.push({ time: 46 * 60, type: 'lifecycle', label: 'SECOND_HALF_START' });
        timeline.push({ time: 90 * 60, type: 'lifecycle', label: 'END_REGULAR_TIME' });

        // Detect extra time from events
        const hasExtraTime = events.some(e => e._category === 'EXTRA_TIME_START' || e._category === 'EXTRA_TIME_HALF' || e._category === 'EXTRA_TIME_SECOND_HALF');
        if (hasExtraTime) {
            timeline.push({ time: 90 * 60 + 1, type: 'lifecycle', label: 'EXTRA_TIME_START' });
            timeline.push({ time: 105 * 60, type: 'lifecycle', label: 'EXTRA_TIME_HALF' });
            timeline.push({ time: 106 * 60, type: 'lifecycle', label: 'EXTRA_TIME_SECOND_HALF' });
        }

        // Detect shootout from events
        const hasShootout = events.some(e => e._category === 'SHOOTOUT_START');
        if (hasShootout) {
            timeline.push({ time: 120 * 60, type: 'lifecycle', label: 'SHOOTOUT_START' });
        }

        const maxEventTime = events.length > 0 ? Math.max(...events.map(e => e._matchSeconds)) : 90 * 60;
        timeline.push({
            time: Math.max(90 * 60, maxEventTime + 60),
            type: 'lifecycle',
            label: 'MATCH_END',
        });
    }

    // Add actual events, skipping lifecycle categories and uncategorized events
    // (lifecycle is already handled by the injected items above)
    const seenDelayKeys = new Map();
    for (const ev of events) {
        if (!skipLifecycle && ['MATCH_START', 'HALF_TIME', 'SECOND_HALF_START', 'END_REGULAR_TIME', 'MATCH_END', 'EXTRA_TIME_START', 'EXTRA_TIME_HALF', 'EXTRA_TIME_SECOND_HALF', 'SHOOTOUT_START'].includes(ev._category)) {
            continue; // covered by injected lifecycle
        }
        if (ev._category === 'MATCH_DELAY_START' || ev._category === 'MATCH_DELAY_END') {
            const key = getMatchDelayKey(ev._category, ev.minute);
            const existing = seenDelayKeys.get(key);
            const hasDesc = Boolean((ev.description || '').trim());
            if (existing) {
                const existingHasDesc = Boolean((existing.description || '').trim());
                if (!(hasDesc && !existingHasDesc)) continue;
            }
            seenDelayKeys.set(key, ev);
        }
        if (ev._category == null) {
            log(`  Skipping uncategorized event: ${ev.type}`);
            continue;
        }

        timeline.push({
            time: ev._matchSeconds,
            type: 'event',
            event: ev,
            category: ev._category,
        });
    }

    // Remove duplicate delay entries superseded by a better-described twin
    const delayWinners = new Set(seenDelayKeys.values());
    const filtered = timeline.filter((item) => {
        if (item.type !== 'event') return true;
        const cat = item.category;
        if (cat !== 'MATCH_DELAY_START' && cat !== 'MATCH_DELAY_END') return true;
        return delayWinners.has(item.event);
    });
    timeline.length = 0;
    timeline.push(...filtered);

    // Sort by time, with lifecycle before events at the same time
    timeline.sort((a, b) => a.time - b.time || (a.type === 'lifecycle' ? -1 : 1));

    return timeline;
}

// ─── Poster ─────────────────────────────────────────────────────────────────

async function post(text, label) {
    const dryRun = config.bot.dryRun;
    const prefix = dryRun ? '[DRY RUN]' : '[POST]';
    console.log(`${prefix} ${label}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(text);
    console.log(`${'─'.repeat(60)}\n`);

    if (!dryRun) {
        const result = await postStatus(text);
        if (result) {
            log(`  -> Posted: ${result.id}`);
        } else {
            console.error(`  -> Failed to post ${label}`);
        }
    }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

async function replayMatch(match) {
    const title = `${match.homeTeam.name} x ${match.awayTeam.name}`;
    console.log(`\n⚽ Mock stream: ${title}`);
    console.log(`   League: ${match.leagueName} (${match.leagueCode})`);
    console.log(`   Final score: ${match.homeScore} x ${match.awayScore}`);
    console.log(`   Events: ${(match.keyEvents || []).length}`);
    console.log(`   Speed: ${SPEED}x | Dry run: ${config.bot.dryRun}`);
    console.log('');

    // ── Pre-match posts ──
    if (!SKIP_LIFECYCLE) {
        const digestText = formatDailyDigest(match);
        await post(digestText, `DAILY_DIGEST (${title})`);

        await new Promise(r => setTimeout(r, 2000));

        const previewText = formatMatchPreview(match);
        await post(previewText, `MATCH_PREVIEW (${title})`);

        await new Promise(r => setTimeout(r, 2000));
    }

    // ── Match timeline ──
    const timeline = buildTimeline(match, SKIP_LIFECYCLE);
    console.log(`   Timeline: ${timeline.length} items\n`);

    let prevTime = 0;
    const score = { home: 0, away: 0 };

    for (const item of timeline) {
        const delayMs = toRealDelay(item.time - prevTime);
        prevTime = item.time;

        if (delayMs > 0) {
            const matchMin = Math.floor(item.time / 60);
            const realSec = (delayMs / 1000).toFixed(1);
            log(`  ⏳ Waiting ${realSec}s (match ${matchMin}')...`);
            await new Promise(r => setTimeout(r, delayMs));
        }

        if (item.type === 'lifecycle') {
            let text;
            const live = liveMatch(match, score);
            switch (item.label) {
                case 'MATCH_START':
                    text = formatMatchStart(match); // 0–0, use bare match
                    await post(text, `MATCH_START (${title})`);
                    break;
                case 'HALF_TIME':
                    text = formatHalfTime(live);
                    await post(text, `HALF_TIME (${title})`);
                    break;
                case 'SECOND_HALF_START':
                    text = formatSecondHalfStart(live);
                    await post(text, `SECOND_HALF_START (${title})`);
                    break;
                case 'END_REGULAR_TIME':
                    text = formatEndRegularTime(live);
                    await post(text, `END_REGULAR_TIME (${title})`);
                    break;
                case 'EXTRA_TIME_START':
                    text = formatExtraTimeStart(live);
                    await post(text, `EXTRA_TIME_START (${title})`);
                    break;
                case 'EXTRA_TIME_HALF':
                    text = formatExtraTimeHalf(live);
                    await post(text, `EXTRA_TIME_HALF (${title})`);
                    break;
                case 'EXTRA_TIME_SECOND_HALF':
                    text = formatExtraTimeSecondHalf(live);
                    await post(text, `EXTRA_TIME_SECOND_HALF (${title})`);
                    break;
                case 'SHOOTOUT_START':
                    text = formatShootoutStart(live);
                    await post(text, `SHOOTOUT_START (${title})`);
                    break;
                case 'MATCH_END':
                    text = formatMatchEnd(match); // use final snapshot score
                    await post(text, `MATCH_END (${title})`);
                    break;
            }
        } else {
            const { event, category } = item;
            let text;
            switch (category) {
                case 'GOAL': {
                    // Advance running tally before formatting so the post shows the updated score.
                    // ESPN's teamId on both regular goals and own goals points to the team that benefits
                    // (i.e. the team whose score increases), so the logic is the same either way.
                    const benefitIsHome = String(event.teamId) === String(match.homeTeam.id);
                    if (benefitIsHome) score.home++; else score.away++;
                    text = formatGoal(event, liveMatch(match, score));
                    break;
                }
                case 'YELLOW_CARD':
                case 'RED_CARD':
                    text = formatCard(event, liveMatch(match, score));
                    break;
                case 'SUBSTITUTION':
                    text = formatSubstitution(event, liveMatch(match, score));
                    break;
                case 'PENALTY_MISSED':
                    text = formatPenaltyMissed(event, liveMatch(match, score));
                    break;
                case 'VAR':
                    text = `📺 VAR\n\n${event.description || event.type}`;
                    break;
                case 'MATCH_DELAY_START':
                    text = formatMatchDelayStart(event, liveMatch(match, score));
                    break;
                case 'MATCH_DELAY_END':
                    text = formatMatchDelayEnd(event, liveMatch(match, score));
                    break;
                default:
                    log(`  Skipping uncategorized event: ${event.type}`);
                    continue;
            }
            if (text) {
                await post(text, `${category} (${title}, ${event.minute})`);
            }
        }
    }

    // ── Post-match stats ──
    if (!SKIP_LIFECYCLE) {
        await new Promise(r => setTimeout(r, 2000));
        const statsText = formatMatchStats(match);
        if (statsText) {
            await post(statsText, `MATCH_STATS (${title})`);
        }
    }

    console.log(`\n✅ Replay finished: ${title}\n`);
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node scripts/mock-stream.js <path-to-match-snapshot.json>');
        console.error('');
        console.error('Example:');
        console.error('  DRY_RUN=true SPEED=60 node scripts/mock-stream.js data/match-snapshots/20250615.json');
        process.exit(1);
    }

    const resolved = path.resolve(filePath);
    let data;
    try {
        data = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (err) {
        console.error(`Error reading ${resolved}: ${err.message}`);
        process.exit(1);
    }

    let matches = data.matches || [];
    if (matches.length === 0) {
        console.log('No matches in file.');
        return;
    }

    // Filter by league if specified
    const leagueFilter = process.env.LEAGUE_CODE;
    if (leagueFilter) {
        matches = matches.filter(m => m.leagueCode === leagueFilter);
        if (matches.length === 0) {
            console.log(`No matches for league ${leagueFilter}.`);
            return;
        }
    }

    // Pick specific match if index specified
    if (!isNaN(MATCH_INDEX) && MATCH_INDEX >= 0 && MATCH_INDEX < matches.length) {
        matches = [matches[MATCH_INDEX]];
    }

    console.log(`Mock stream: ${matches.length} match(es) to replay`);
    console.log(`Speed: ${SPEED}x | Dry run: ${config.bot.dryRun} | Skip lifecycle: ${SKIP_LIFECYCLE}`);

    for (const match of matches) {
        await replayMatch(match);
    }

    console.log('\n🏁 All replays finished.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
