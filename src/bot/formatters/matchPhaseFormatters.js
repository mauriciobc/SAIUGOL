import { translate } from '../../services/i18n.js';
import { parseDelayReason } from '../../domain/eventTextParsers.js';
import {
    displayMinute,
    eventDescription,
    standingAnnotation,
    getTeamHashtag,
} from './formatHelpers.js';

/**
 * Format match start announcement
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatMatchStart(match) {
    const { homeTeam, awayTeam, venue } = match;

    let text = `${translate('ui.match_start')}\n\n`;
    text += `🏟️ ${homeTeam.name}${standingAnnotation(homeTeam.standing)} x ${awayTeam.name}${standingAnnotation(awayTeam.standing)}\n`;

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
 * Format end of regular time (second half) announcement
 * @param {Object} match - Match data
 * @param {Object} event - Event data (optional, for minute)
 * @returns {string} Formatted post text
 */
export function formatEndRegularTime(match, event = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const rawMinute = displayMinute(event?.minute);
    const minute = rawMinute === '?' ? '90' : rawMinute;

    let text = `${translate('ui.end_regular_time')}\n\n`;
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
    text += `🏟️ ${homeTeam.name}${standingAnnotation(homeTeam.standing)} ${homeScore} x ${awayScore} ${awayTeam.name}${standingAnnotation(awayTeam.standing)}`;
    if (hasShootout) {
        text += ` (${homeShootoutScore} x ${awayShootoutScore} ${translate('ui.penalties')})`;
    }
    text += `\n\n${result}`;

    text += `\n\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

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
 * Format match delay start (typeId 129 — hydration, injury, or generic pause).
 * @param {Object} event
 * @param {Object} match
 * @returns {string}
 */
export function formatMatchDelayStart(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const minute = displayMinute(event.minute);
    const reason = parseDelayReason(eventDescription(event));
    const announcementKey = reason === 'hydration'
        ? 'ui.match_delay_hydration_start'
        : reason === 'injury'
            ? 'ui.match_delay_injury_start'
            : 'ui.match_delay_generic_start';

    let text = `${translate(announcementKey)}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;

    const desc = eventDescription(event);
    if (desc) text += `\n📝 ${desc}\n`;

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format match delay end (typeId 130 — play resumes).
 * @param {Object} event
 * @param {Object} match
 * @returns {string}
 */
export function formatMatchDelayEnd(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.match_delay_end')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;

    const desc = eventDescription(event);
    if (desc) text += `\n📝 ${desc}\n`;

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}
