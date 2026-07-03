import { config } from '../config.js';
import { translate } from '../services/i18n.js';

function playerName(player) {
    if (player == null) return undefined;
    if (typeof player === 'string') return player;
    return player?.name;
}

/** Normalize minute for display: trim and strip trailing apostrophes so we can append a single "'". */
function displayMinute(value) {
    const raw = (value != null ? String(value).trim() : '').replace(/'+$/, '');
    return raw || '?';
}

/** Raw event description from API (PT or EN) for inclusion in toot body. */
function eventDescription(event) {
    const d = event?.description ?? event?.text ?? '';
    return typeof d === 'string' ? d.trim() : '';
}

/**
 * Format a goal event as a Mastodon post
 * @param {Object} event - Goal event data
 * @param {Object} match - Match data
 * @param {{ isFavoriteTeam?: boolean }} [options]
 * @returns {string} Formatted post text
 */
export function formatGoal(event, match, options = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const scorer = playerName(event.player) || translate('common.unknown_player');
    const assist = playerName(event.assist);
    const minute = displayMinute(event.minute);
    const typeLower = event.type?.toLowerCase() ?? '';
    const isOwnGoal = typeLower.includes('own') || typeLower.includes('autogol') || typeLower.includes('gol contra');
    const isPenalty = typeLower.includes('gol de pênalti') || typeLower.includes('pênalti convertido') || typeLower.includes('penalty - scored');

    let text = '';
    if (options.isFavoriteTeam) {
        text += '⚫🔴 Gol do Galo!\n\n';
    }
    if (isOwnGoal) {
        text += translate('ui.own_goal_announcement');
    } else if (isPenalty) {
        text += '⚽ Gol de Pênalti!\n';
    } else {
        text += translate('ui.goal_announcement');
    }
    text += '\n\n';
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}`;

    if (assist) {
        text += ` (${translate('ui.assist')}: ${assist})`;
    }

    const desc = eventDescription(event);
    if (desc) text += `\n\n📝 ${desc}`;

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
    const typeLower = event.type?.toLowerCase() ?? '';
    const isRed = typeLower.includes('red') || typeLower.includes('vermelho');
    const cardType = isRed
        ? translate('ui.red_card_announcement')
        : translate('ui.yellow_card_announcement');
    const player = playerName(event.player) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);
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

    const desc = eventDescription(event);
    if (desc) text += `\n\n📝 ${desc}`;

    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Parse player in/out from substitution description.
 * Supports English ("X replaces Y." / "X on for Y.") and others (e.g. Italian "X sostituisce Y.").
 *
 * The player-out capture matches only consecutive Title-Case words rather than "up to the next
 * period": ESPN often appends an untagged, lowercase reason clause after the name with no
 * separating punctuation (e.g. "...substituindo Jordan Bos uma lesão." or "...replaces Jordan
 * Bos because of an injury."), which a period-anchored capture would swallow into the name.
 * The player-in capture is lazy (bounded by the following keyword) so it doesn't greedily eat
 * into an optional keyword prefix (e.g. "comes" in "comes on for").
 * @param {string} text
 * @returns {{ playerIn: string, playerOut: string }|null}
 */
export function parseSubstitutionFromDescription(text) {
    if (!text || typeof text !== 'string') return null;
    const namePart = '[\\p{L}\\p{M}][\\p{L}\\p{M}\\s\'-]+?';
    const strictName = '\\p{Lu}[\\p{L}\\p{M}\'-]*(?:\\s\\p{Lu}[\\p{L}\\p{M}\'-]*)*';
    // Ordem: variantes por idioma primeiro; fallback genérico por último. O último padrão
    // exige contexto de substituição ("on for" / "comes on for") para evitar falsos
    // positivos com "for" solto (ex.: "Assist for X.").
    const patterns = [
        new RegExp(`entra em campo\\s+(${namePart})\\s+substituindo\\s+(${strictName})`, 'u'),
        new RegExp(`(${namePart}) replaces (${strictName})`, 'u'),
        new RegExp(`(${namePart}) sostituisce (${strictName})`, 'u'),
        new RegExp(`(${namePart}) in per (${strictName})`, 'u'),
        new RegExp(`(${namePart}) (?:comes )?on for (${strictName})`, 'u'),
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
    let playerIn = playerName(event.playerIn);
    let playerOut = playerName(event.playerOut);
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
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.substitution_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `⬆️ ${translate('ui.player_in')}: ${playerIn}\n`;
    text += `⬇️ ${translate('ui.player_out')}: ${playerOut}`;

    // Note: description removed to avoid repetition with structured substitution info

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
    const minute = displayMinute(event.minute);
    const decision = event.decision || event.result || translate('ui.review_in_progress');

    let text = `${translate('ui.var_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `📋 ${decision}`;

    const desc = eventDescription(event);
    if (desc) text += `\n\n📝 ${desc}`;

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
    const rawMinute = displayMinute(event?.minute);
    const minute = rawMinute === '?' ? '46' : rawMinute;

    let text = `${translate('ui.second_half_start')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore ?? 0} x ${awayScore ?? 0} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format half time / interval announcement
 * @param {Object} match - Match data
 * @param {Object} event - Event data (optional, for minute)
 * @returns {string} Formatted post text
 */
export function formatHalfTime(match, event = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const rawMinute = displayMinute(event?.minute);
    const minute = rawMinute === '?' ? '45' : rawMinute;

    let text = `${translate('ui.half_time')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore ?? 0} x ${awayScore ?? 0} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format match end announcement. If the match was decided on penalties (homeShootoutScore/
 * awayShootoutScore present — set once ESPN's header.competitors[].shootoutScore appears),
 * shows the shootout score and winner instead of the regular/extra-time score, which is often
 * a draw for these matches.
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatMatchEnd(match) {
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
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}`;
    if (hasShootout) {
        text += ` (${homeShootoutScore} x ${awayShootoutScore} ${translate('ui.penalties')})`;
    }
    text += `\n\n${result}`;

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
 * Format extra time start announcement (after regular 90 minutes end level)
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatExtraTimeStart(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;

    let text = `${translate('ui.extra_time_start')}\n\n`;
    text += `\ud83c\udfdf\ufe0f ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format extra time halftime (interval between the two 15-minute extra-time halves)
 * @param {Object} match - Match data
 * @param {Object} event - Event data (optional, for minute)
 * @returns {string} Formatted post text
 */
export function formatExtraTimeHalf(match, event = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const rawMinute = displayMinute(event?.minute);
    const minute = rawMinute === '?' ? '105' : rawMinute;

    let text = `${translate('ui.extra_time_half')}\n\n`;
    text += `\ud83c\udfdf\ufe0f ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\u23f1\ufe0f ${minute}'\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format second half of extra time start. Distinct from formatSecondHalfStart (regular time)
 * so it isn't confused with a normal second-half restart.
 * @param {Object} match - Match data
 * @param {Object} event - Event data (optional, for minute)
 * @returns {string} Formatted post text
 */
export function formatExtraTimeSecondHalf(match, event = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const rawMinute = displayMinute(event?.minute);
    const minute = rawMinute === '?' ? '105' : rawMinute;

    let text = `${translate('ui.extra_time_second_half')}\n\n`;
    text += `\ud83c\udfdf\ufe0f ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\u23f1\ufe0f ${minute}'\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format extra time end announcement (120 minutes played)
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatExtraTimeEnd(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;

    let text = `${translate('ui.extra_time_end')}\n\n`;
    text += `\ud83c\udfdf\ufe0f ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format penalty shootout start announcement. Only fires when scores are still level after
 * extra time (that's the only way ESPN emits this event), so the draw framing is always correct.
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatShootoutStart(match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;

    let text = `${translate('ui.shootout_start')}\n\n`;
    text += `\ud83c\udfdf\ufe0f ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `${translate('ui.extra_time_draw')}\n`;
    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

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
