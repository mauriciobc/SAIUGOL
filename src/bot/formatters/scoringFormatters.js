import { config } from '../../config.js';
import { translate } from '../../services/i18n.js';
import { parsePlayerFromEventDescription } from '../../api/espn.js';
import { PENALTY_SCORED_KEYWORDS } from '../../utils/eventKeywords.js';
import {
    playerName,
    displayMinute,
    eventDescription,
    getTeamHashtag,
} from './formatHelpers.js';

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
    const isPenalty = PENALTY_SCORED_KEYWORDS.some((kw) => typeLower.includes(kw));

    let text = '';
    if (options.isFavoriteTeam) {
        const { favoriteTeamEmoji: emoji, favoriteTeamNickname: nickname } = config.bot;
        text += `${emoji} Gol do ${nickname}!\n\n`;
    }
    if (isOwnGoal) {
        text += translate('ui.own_goal_announcement');
    } else if (isPenalty) {
        text += translate('ui.penalty_goal_announcement');
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
 * Format a goal that ESPN hasn't finished describing yet (event.text is still its transient
 * short-form template, e.g. "Gol temporário aos 36'") as a lightweight "awaiting confirmation"
 * post. The real "⚽ GOOOOL!" announcement (formatGoal) is posted as a reply once ESPN fills in
 * the full narrative under the same event id.
 * @param {Object} event - Goal event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatGoalPending(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const scorer = playerName(event.player)
        || parsePlayerFromEventDescription(eventDescription(event))
        || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.goal_pending_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}\n\n`;
    text += translate('ui.goal_pending_note');
    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a retraction for a goal that was pending confirmation and later came back from ESPN
 * marked as disallowed/overturned (e.g. VAR). Posted as a reply to the original pending toot.
 * @param {Object} event - Goal event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatGoalDisallowed(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const scorer = playerName(event.player) || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.goal_disallowed_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}`;
    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a missed/saved penalty event as a Mastodon post
 * @param {Object} event - Penalty missed event data
 * @param {Object} match - Match data
 * @param {{ isFavoriteTeam?: boolean }} [options]
 * @returns {string} Formatted post text
 */
export function formatPenaltyMissed(event, match, options = {}) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const player = playerName(event.player)
        || parsePlayerFromEventDescription(eventDescription(event))
        || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = '';
    if (options.isFavoriteTeam) {
        const { favoriteTeamEmoji: emoji, favoriteTeamNickname: nickname } = config.bot;
        text += `${emoji} Pênalti perdido - ${nickname}!\n\n`;
    }
    text += `${translate('ui.penalty_missed_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}`;

    const desc = eventDescription(event);
    if (desc) text += `\n\n📝 ${desc}`;

    text += `\n\n${getTeamHashtag(event.team?.name || homeTeam.name)} ${(match.league?.hashtags || []).join(' ')}`;

    return text;
}

/**
 * Format a penalty that ESPN hasn't finished describing yet (e.g. "Tentativa temporária aos 21'").
 * The real announcement (formatPenaltyMissed) is posted as a reply once ESPN fills in the text.
 * @param {Object} event - Penalty missed event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatPenaltyMissedPending(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const player = playerName(event.player)
        || parsePlayerFromEventDescription(eventDescription(event))
        || translate('common.unknown_player');
    const minute = displayMinute(event.minute);

    let text = `${translate('ui.penalty_missed_pending_announcement')}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}\n\n`;
    text += translate('ui.penalty_missed_pending_note');
    text += `\n\n${(match.league?.hashtags || []).join(' ')}`;

    return text;
}
