import { config } from '../../config.js';
import { translate } from '../../services/i18n.js';
import { parseSubstitutionFromDescription } from '../../domain/eventTextParsers.js';
import {
    playerName,
    displayMinute,
    eventDescription,
} from './formatHelpers.js';

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
        const { favoriteTeamEmoji: emoji, favoriteTeamNickname: nickname } = config.bot;
        text += `${emoji} Cartão vermelho - ${nickname}!\n\n`;
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
