import { config } from '../../config.js';

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

function formatForm(form) {
    if (!form) return '';
    return [...form.toUpperCase()].map(c => {
        if (c === 'W') return '🟩';
        if (c === 'D') return '🟨';
        if (c === 'L') return '🟥';
        return '⬜';
    }).join('');
}

/**
 * Render a 10-block possession bar with the home team's share on the left.
 * Returns null when either value is missing or unparseable.
 * Example: possessionBar('41.7', '58.3') → '████░░░░░░'
 */
function possessionBar(homeStr, awayStr) {
    const h = parseFloat(homeStr);
    const a = parseFloat(awayStr);
    if (isNaN(h) || isNaN(a)) return null;
    const blocks = Math.round(h / 10);
    return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

/** Format a standing as a compact annotation, e.g. "(1º · 41pts)". Returns '' when absent. */
function standingAnnotation(standing) {
    if (!standing || (standing.rank == null && standing.points == null)) return '';
    const parts = [];
    if (standing.rank != null) parts.push(`${standing.rank}º`);
    if (standing.points != null) parts.push(`${standing.points}pts`);
    return parts.length ? ` (${parts.join(' · ')})` : '';
}

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

function getTeamHashtag(teamName) {
    if (!teamName) return '';
    // Remove spaces and special characters, keep only alphanumeric
    const clean = teamName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-zA-Z0-9]/g, '');
    return `#${clean}`;
}

export {
    playerName,
    displayMinute,
    eventDescription,
    formatForm,
    possessionBar,
    standingAnnotation,
    formatKickoff,
    getTeamHashtag,
};
