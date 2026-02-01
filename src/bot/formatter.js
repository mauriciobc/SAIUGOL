import { config } from '../config.js';

/**
 * Format a goal event as a Mastodon post
 * @param {Object} event - Goal event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatGoal(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const scorer = event.player?.name || 'Jogador desconhecido';
    const assist = event.assist?.name;
    const minute = event.minute || '?';
    const isOwnGoal = event.type?.toLowerCase().includes('own');

    let text = `⚽ GOOOOL!${isOwnGoal ? ' (Contra)' : ''}\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${scorer}`;

    if (assist) {
        text += ` (assist: ${assist})`;
    }

    text += `\n\n${getTeamHashtag(event.team?.name || homeTeam.name)} ${config.hashtags.join(' ')}`;

    return text;
}

/**
 * Format a card event as a Mastodon post
 * @param {Object} event - Card event data
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatCard(event, match) {
    const { homeTeam, awayTeam, homeScore, awayScore } = match;
    const isRed = event.type?.toLowerCase().includes('red');
    const emoji = isRed ? '🟥' : '🟨';
    const cardType = isRed ? 'CARTÃO VERMELHO' : 'CARTÃO AMARELO';
    const player = event.player?.name || 'Jogador';
    const minute = event.minute || '?';
    const reason = event.reason || '';

    let text = `${emoji} ${cardType}!\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `👤 ${player}`;

    if (reason) {
        text += `\n📝 ${reason}`;
    }

    text += `\n\n${config.hashtags.join(' ')}`;

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
    const playerIn = event.playerIn?.name || 'Jogador';
    const playerOut = event.playerOut?.name || 'Jogador';
    const minute = event.minute || '?';

    let text = `🔄 SUBSTITUIÇÃO\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `⬆️ Entra: ${playerIn}\n`;
    text += `⬇️ Sai: ${playerOut}`;

    text += `\n\n${config.hashtags.join(' ')}`;

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
    const decision = event.decision || event.result || 'Revisão em andamento';

    let text = `📺 VAR\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n`;
    text += `⏱️ ${minute}'\n`;
    text += `📋 ${decision}`;

    text += `\n\n${config.hashtags.join(' ')}`;

    return text;
}

/**
 * Format match start announcement
 * @param {Object} match - Match data
 * @returns {string} Formatted post text
 */
export function formatMatchStart(match) {
    const { homeTeam, awayTeam, venue } = match;

    let text = `🏁 COMEÇA O JOGO!\n\n`;
    text += `🏟️ ${homeTeam.name} x ${awayTeam.name}\n`;

    if (venue) {
        text += `📍 ${venue}\n`;
    }

    text += `\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${config.hashtags.join(' ')}`;

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
        result = `🏆 ${homeTeam.name} vence!`;
    } else if (awayScore > homeScore) {
        result = `🏆 ${awayTeam.name} vence!`;
    } else {
        result = '🤝 Empate!';
    }

    let text = `🏁 FIM DE JOGO!\n\n`;
    text += `🏟️ ${homeTeam.name} ${homeScore} x ${awayScore} ${awayTeam.name}\n\n`;
    text += `${result}`;

    text += `\n\n${getTeamHashtag(homeTeam.name)} ${getTeamHashtag(awayTeam.name)} ${config.hashtags.join(' ')}`;

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

    let text = `🎬 MELHORES MOMENTOS\n\n`;
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

    text += `\n${config.hashtags.join(' ')}`;

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
