import { translate } from '../../services/i18n.js';
import {
    formatForm,
    possessionBar,
    formatKickoff,
    getTeamHashtag,
} from './formatHelpers.js';

/**
 * Format post-match statistics toot.
 * @param {Object} match - Match data (with boxscore)
 * @returns {string|null} Formatted post text, or null if no stats available
 */
export function formatMatchStats(match) {
    const { homeTeam, awayTeam, homeScore, awayScore, boxscore } = match;
    if (!boxscore) return null;

    const h = boxscore.home;
    const a = boxscore.away;

    const statLine = (emoji, label, hVal, aVal, opts = {}) => {
        if (hVal == null && aVal == null) return null;
        const hv = hVal ?? '-';
        const av = aVal ?? '-';
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

    // Possession — rendered as a visual bar
    const hPoss = h?.possessionPct;
    const aPoss = a?.possessionPct;
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
    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a daily digest listing all of today's matches, grouped by league.
 * @param {Array<{ league: Object, matches: Array }>} leagueMatches - Array of { league, matches }
 * @returns {string} Formatted post text
 */
export function formatDailyDigest(leagueMatches) {
    let text = `${translate('ui.daily_digest')}\n\n`;

    for (const { league, matches } of leagueMatches) {
        if (!matches.length) continue;
        if (league?.name) text += `🏆 ${league.name}\n`;
        for (const match of matches) {
            const kickoff = formatKickoff(match.startTime);
            const time = kickoff ? ` — ${kickoff}` : '';
            text += `⚽ ${match.homeTeam.name} x ${match.awayTeam.name}${time}\n`;
        }
        text += '\n';
    }

    const allHashtags = [...new Set(leagueMatches.flatMap(({ league }) => league?.hashtags || []))];
    if (allHashtags.length) text += allHashtags.join(' ');

    return text.trimEnd();
}

/**
 * Format a pre-match preview for a single match (form, record, venue city).
 * @param {Object} match - Match data (with homeTeam.form, homeTeam.record, venueCity)
 * @returns {string} Formatted post text
 */
export function formatMatchPreview(match) {
    const { homeTeam, awayTeam, venueCity } = match;
    const kickoff = formatKickoff(match.startTime);

    let text = `${translate('ui.match_preview')}\n\n`;
    text += `⚽ ${homeTeam.name} x ${awayTeam.name}`;
    if (kickoff) text += ` — ${kickoff}`;
    text += '\n';
    if (venueCity) text += `📍 ${venueCity}\n`;
    text += '\n';

    const teamBlock = (emoji, team) => {
        let block = `${emoji} ${team.name}`;
        const form = formatForm(team.form);
        if (form) block += `\n   ${translate('ui.form')}: ${form}`;
        if (team.record) block += `\n   ${translate('ui.record')}: ${team.record}`;
        return block;
    };

    text += `${teamBlock('🏠', homeTeam)}\n\n`;
    text += `${teamBlock('✈️', awayTeam)}\n`;

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;
    return text;
}

/**
 * Format highlights announcement
 * @param {Object} match - Match data
 * @param {Array} highlights - Array of highlight objects
 * @returns {string} Formatted post text
 */
export function formatHighlights(match, highlights) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;

    let text = `${translate('ui.highlights')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n\n`;

    // Add up to 3 highlight links
    const topHighlights = highlights.slice(0, 3);
    for (const highlight of topHighlights) {
        const title = highlight.title || 'Highlight';
        const url = highlight.url || highlight.embedUrl;
        if (url) {
            text += `🔗 ${title}: ${url}\n`;
        }
    }

    text += `\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}
