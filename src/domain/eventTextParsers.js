/**
 * Shared ESPN event-text parsers (substitution, goal scorer, provisional player, delay reason).
 * Single source of truth for both the ESPN API normalizer and the Mastodon formatter.
 */

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
 * Parse scorer name from goal description.
 * ESPN format: "Goal! TeamA N, TeamB M. Scorer Name (Team) right footed shot..."
 * Supports names with initials (e.g. "J. Smith").
 * @param {string} text - Event description
 * @returns {string|null} Scorer name or null
 */
export function parseScorerFromGoalDescription(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/(?:Goal|Gol)![\s\S]*?\.\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s'-]+?)\s*\(/);
    return m ? m[1].trim() : null;
}

/**
 * Parse player name from ESPN provisional text before the final description is ready.
 * PT: "Lionel Messi (Argentina) Tentativa temporária aos 21'"
 * EN: "Lionel Messi (Argentina) Temporary attempt at 21'"
 * @param {string} text
 * @returns {string|null}
 */
export function parsePlayerFromTemporaryDescription(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/^(.+?)\s*\([^)]+\)\s+(?:Tentativa tempor[aá]ria|Temporary attempt)/i);
    return m ? m[1].trim() : null;
}

/**
 * Extract player name from goal or provisional penalty descriptions.
 * @param {string} text
 * @returns {string|null}
 */
export function parsePlayerFromEventDescription(text) {
    return parseScorerFromGoalDescription(text) || parsePlayerFromTemporaryDescription(text);
}

/**
 * Parse delay reason from ESPN description (PT or EN).
 * @param {string} [description]
 * @returns {'hydration'|'injury'|'generic'}
 */
export function parseDelayReason(description) {
    const d = (description || '').toLowerCase();
    if (d.includes('hidratação') || d.includes('drinks break')) return 'hydration';
    if (d.includes('lesão') || d.includes('lesao') || d.includes('injury')) return 'injury';
    return 'generic';
}
