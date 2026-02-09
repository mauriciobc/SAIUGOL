import { config } from '../config.js';
import { translate } from '../services/i18n.js';

/**
 * Format a goal event as a Mastodon post
 * @param {Object} event - Goal event data
 * @param {Object} match - Match data
 * @param {{ isFavoriteTeam?: boolean }} [options]
 * @returns {string} Formatted post text
 */
export function formatGoal(event, match, options = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const scorer = event.player?.name || translate('common.unknown_player');
    const assist = event.assist?.name;
    const minute = event.minute || '?';
    const isOwnGoal = event.type?.toLowerCase().includes('own');

    let text = '';
    if (options.isFavoriteTeam) {
        text += '⚫🔴 Gol do Galo!\n\n';
    }
    text += isOwnGoal
        ? translate('ui.own_goal_announcement')
        : translate('ui.goal_announcement');
    text += '\n\n';
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}`;

    if (assist) {
        text += ` (${translate('ui.assist')}: ${assist})`;
    }

    text += `\n\n${getTeamHashtag(event.team?.name || homeTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a card event as a Mastodon post
 * @param {Object} event - Card event data
 * @param {Object} match - Match data
 * @param {{ isFavoriteTeam?: boolean }} [options]
 * @returns {string} Formatted post text
 */
export function formatCard(event, match, options = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const isRed = event.type?.toLowerCase().includes('red');
    const cardType = isRed
        ? translate('ui.red_card_announcement')
        : translate('ui.yellow_card_announcement');
    const player = event.player?.name || translate('common.unknown_player');
    const minute = event.minute || '?';
    const reason = event.reason || '';

    let text = '';
    if (isRed && options.isFavoriteTeam) {
        text += '⚫🔴 Cartão vermelho - Galo!\n\n';
    }
    text += `${cardType}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}`;

    if (reason) {
        text += `\n📝 ${reason}`;
    }

    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Parse player in/out from substitution description.
 * Supports English ("X replaces Y." / "X on for Y.") and others (e.g. Italian "X sostituisce Y.").
 * @param {string} text
 * @returns {{ playerIn: string, playerOut: string }|null}
 */
function parseSubstitutionFromDescription(text) {
    if (!text || typeof text !== 'string') return null;
    const namePart = '[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\\s\'-]+?';
    // Ordem: variantes por idioma primeiro; fallback genérico por último. O último padrão
    // exige contexto de substituição ("on for" / "comes on for") para evitar falsos
    // positivos com "for" solto (ex.: "Assist for X.").
    const patterns = [
        new RegExp(`(${namePart}) replaces (${namePart})\\.`),
        new RegExp(`(${namePart}) on for (${namePart})\\.`),
        new RegExp(`(${namePart}) sostituisce (${namePart})\\.`),
        new RegExp(`(${namePart}) in per (${namePart})\\.`),
        new RegExp(`(${namePart}) (?:comes )?on for (${namePart})\\.`),
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) return { playerIn: m[1].trim(), playerOut: m[2].trim() };
    }
    return null;
}

/**
 * Format a substitution event as a Mastodon post
 * @param {Object} event - Substitution event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatSubstitution(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    let playerIn = event.playerIn?.name;
    let playerOut = event.playerOut?.name;
    if (!playerIn || !playerOut) {
        const description = event.description ?? event.text ?? '';
        const parsed = parseSubstitutionFromDescription(description);
        if (parsed) {
            playerIn = playerIn || parsed.playerIn;
            playerOut = playerOut || parsed.playerOut;
        }
    }
    playerIn = playerIn || translate('common.unknown_player');
    playerOut = playerOut || translate('common.unknown_player');
    const minute = event.minute || '?';

    let text = `${translate('ui.substitution_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `⬆️ ${translate('ui.player_in')}: ${playerIn}\n`;
    text += `⬇️ ${translate('ui.player_out')}: ${playerOut}`;

    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a VAR review event as a Mastodon post
 * @param {Object} event - VAR event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatVAR(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const minute = event.minute || '?';
    const decision = event.decision || event.result || translate('ui.review_in_progress');

    let text = `${translate('ui.var_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `📋 ${decision}`;

    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format match start announcement
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatMatchStart(match) {
    const { homeTeam, awayTeam, venue } = match;

    let text = `${translate('ui.match_start')}\n\n`;
    text += `🏟️ ${homeTeam.name} x ${awayTeam.name}\n`;

    if (venue) {
        text += `📍 ${venue}\n`;
    }

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format second half start announcement
 * @param {Object} match - Match data
 * @param {Object} event - Event data (optional, for minute)
 * @returns {string} Formatted post text
 */
export function formatSecondHalfStart(match, event = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    // Normalize minute: trim, strip trailing apostrophe(s), then append single "'" on display (same as other formatters)
    const rawMinute = (event?.minute != null ? String(event.minute).trim() : '').replace(/'+$/, '');
    const minute = rawMinute || '46';

    let text = `${translate('ui.second_half_start')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore ?? 0} x ${awayScore ?? 0} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format match end announcement
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatMatchEnd(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;

    let result;
    if (homeScore > awayScore) {
        result = translate('ui.team_wins', { team: homeTeam.name });
    } else if (awayScore > homeScore) {
        result = translate('ui.team_wins', { team: awayTeam.name });
    } else {
        result = translate('ui.draw');
    }

    let text = `${translate('ui.match_end')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n\n`;
    text += `${result}`;

    text += `\n\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

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

/**
 * Generate a hashtag from team name
 * @param {string} teamName - Team name
 * @returns {string} Hashtag
 */
function getTeamHashtag(teamName) {
    if (!teamName) return '';
    // Remove spaces and special characters, keep only alphanumeric
    const clean = teamName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-zA-Z0-9]/g, '');
    return `#${clean}`;
}
