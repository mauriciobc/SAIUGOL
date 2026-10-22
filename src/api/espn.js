import axios from 'axios';
import NodeCache from 'node-cache';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { getDateStringFor } from '../utils/dateUtils.js';
import { config } from '../config.js';
import { espnLogger } from '../utils/logger.js';
import { recordEspnRequest } from '../utils/metrics.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
/** Web API with lang/region support (e.g. lang=pt&region=br for Brazilian Portuguese) */
const WEB_BASE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';
const CDN_URL = 'https://cdn.espn.com/core/soccer';
const CORE_BASE_URL = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
const DEBUG_API = process.env.DEBUG_API === 'true';

let useCdnFallback = false;
let cdnHealthy = true;

const httpClient = axios.create({
    timeout: config.espn.requestTimeoutMs,
});

const scoreboardCache = new NodeCache({ stdTTL: config.cache.scoreboardTtlMs / 1000 });
const detailsCache = new NodeCache({ stdTTL: config.cache.detailsTtlMs / 1000 });
const eventsCache = new NodeCache({ stdTTL: config.cache.eventsTtlMs / 1000 });
const highlightsCache = new NodeCache({ stdTTL: config.cache.highlightsTtlMs / 1000 });
const officialsCache = new NodeCache({ stdTTL: config.cache.detailsTtlMs / 1000 });
const playsCache = new NodeCache({ stdTTL: config.cache.eventsTtlMs / 1000 });
const commentaryCache = new NodeCache({ stdTTL: config.cache.eventsTtlMs / 1000 });

/** Whether ESPN narratives should be requested in Portuguese (lang=pt&region=br) for this bot language. */
function wantsPortuguese(language) {
    return /^pt\b/i.test(language || '');
}

/**
 * Extract team id from ESPN core API team $ref URL.
 * @param {string|null|undefined} ref
 * @returns {string|null}
 */
export function parseTeamIdFromRef(ref) {
    if (!ref || typeof ref !== 'string') return null;
    const m = ref.match(/\/teams\/(\d+)/);
    return m ? m[1] : null;
}

const PLAYER_NAME = String.raw`(\p{L}[\p{L}.\s'-]+?)`;

/**
 * Play narratives that name the acting player. The core API serves the same Opta templates in
 * English (default) or Portuguese (lang=pt&region=br); the PT ones rearrange the sentence, e.g.
 * "Attempt missed. X (Team) …" becomes "Oportunidade perdida X (Team), …".
 */
const PLAY_PLAYER_PATTERNS = [
    String.raw`Attempt\s+(?:missed|saved|blocked)\.\s*${PLAYER_NAME}\s*\(`,
    String.raw`^${PLAYER_NAME}\s*\([^)]+\)\s+Save\s+at\b`,
    String.raw`Offside,\s*[^.]+\.\s*${PLAYER_NAME}\s+is\s+caught`,
    String.raw`Finaliza[çc][ãa]o\s+(?:defendida[^.]*\.|bloqueada,)\s*${PLAYER_NAME}\s*\(`,
    String.raw`Oportunidade\s+perdida\s+${PLAYER_NAME}\s*\(`,
    // Type 77 is "Defesa", but ESPN sometimes mistranslates it as "Limpar" (Clearance).
    String.raw`^${PLAYER_NAME}\s*\([^)]+\)\s+(?:Defesa|Limpar)\s`,
    String.raw`encontrou\s+${PLAYER_NAME}\s+em\s+posi[çc][ãa]o\s+irregular`,
].map((source) => new RegExp(source, 'iu'));

/**
 * Parse player name from ESPN play-by-play text narratives (English or Portuguese).
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function parsePlayerFromPlayText(text) {
    if (!text || typeof text !== 'string') return null;
    for (const pattern of PLAY_PLAYER_PATTERNS) {
        const m = text.match(pattern);
        if (m) return m[1].trim();
    }
    return parsePlayerFromEventDescription(text);
}

/**
 * Normalize a single core API play item.
 * @param {Object|null} raw
 * @returns {{ id: string, typeId: string, typeText: string, description: string, minute: string, period: number|null, priority: boolean, scoringPlay: boolean, teamId: string|null, playerName: string|null, wallclock: string|null, clockValue: number, flags: object }}
 */
export function normalizePlay(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            id: '',
            typeId: '',
            typeText: '',
            description: '',
            minute: '',
            period: null,
            priority: false,
            scoringPlay: false,
            teamId: null,
            playerName: null,
            wallclock: null,
            clockValue: 0,
            flags: { yellowCard: false, redCard: false, penaltyKick: false, ownGoal: false },
        };
    }
    const description = (raw.text || raw.alternativeText || '').trim();
    const clockValue = typeof raw.clock?.value === 'number' ? raw.clock.value : 0;
    return {
        id: raw.id != null ? String(raw.id) : '',
        typeId: raw.type?.id != null ? String(raw.type.id) : '',
        typeText: raw.type?.text || raw.type?.type || '',
        description,
        minute: raw.clock?.displayValue || '',
        period: raw.period?.number ?? null,
        priority: Boolean(raw.priority),
        scoringPlay: Boolean(raw.scoringPlay),
        teamId: parseTeamIdFromRef(raw.team?.$ref) || (raw.team?.id != null ? String(raw.team.id) : null),
        playerName: parsePlayerFromPlayText(description),
        wallclock: raw.wallclock || raw.modified || null,
        clockValue,
        flags: {
            yellowCard: Boolean(raw.yellowCard),
            redCard: Boolean(raw.redCard),
            penaltyKick: Boolean(raw.penaltyKick),
            ownGoal: Boolean(raw.ownGoal),
        },
    };
}

/**
 * Normalize ESPN officials list (summary gameInfo.officials or core API items).
 * @param {Array|*} rawList
 * @returns {{ id?: string, name: string, positionName: string, positionId: string, order: number }[]}
 */
export function normalizeOfficials(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList
        .map((o, i) => {
            if (!o || typeof o !== 'object') return null;
            const name = o.displayName || o.fullName || '';
            if (!name) return null;
            return {
                id: o.id != null ? String(o.id) : undefined,
                name,
                positionName: o.position?.displayName || o.position?.name || '',
                positionId: o.position?.id != null ? String(o.position.id) : '',
                order: typeof o.order === 'number' ? o.order : i + 1,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);
}

/** Base URL for summary when usePortugueseDescriptions: web API with lang=pt&region=br. */
function getSummaryUrl(leagueCode, matchId) {
    const base = config.espn.usePortugueseDescriptions ? WEB_BASE_URL : BASE_URL;
    const qs = config.espn.usePortugueseDescriptions ? '&lang=pt&region=br' : '';
    return `${base}/${leagueCode}/summary?event=${matchId}${qs}`;
}

function getTodayDateString() {
    return getDateStringFor(new Date(), config.timezone || 'UTC');
}

/**
 * Validate that an object has required properties
 * @param {Object} obj - Object to validate
 * @param {Array<string>} props - Required property paths (e.g., ['data.events'])
 * @returns {boolean}
 */
function hasProps(obj, props) {
    return props.every(prop => {
        const parts = prop.split('.');
        let current = obj;
        for (const part of parts) {
            if (!current || typeof current !== 'object' || !(part in current)) {
                return false;
            }
            current = current[part];
        }
        return true;
    });
}

/**
 * Get today's matches for a specific league from ESPN.
 * Uses scoreboard endpoint only; does NOT support lang=pt. Returned data (match list, scores, status)
 * is never used as event description in toot body — only summary (getLiveEvents/getMatchDetails) is.
 * @param {string} leagueCode - League code (e.g. 'bra.1')
 * @returns {Promise<Array>} List of normalized matches
 */
export async function getTodayMatches(leagueCode) {
    const cacheKey = `scoreboard:${leagueCode}:${getTodayDateString()}`;
    const cached = scoreboardCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        if (DEBUG_API) {
            espnLogger.debug({ cacheKey, matchCount: cached.length }, 'Scoreboard cache hit');
        }
        return cached;
    }

    const startTime = Date.now();

    return await retryWithBackoff(
        async () => {
            try {
                const dateStr = getTodayDateString();
                let url, response;

                if (useCdnFallback && cdnHealthy) {
                    url = `${CDN_URL}/scoreboard?xhr=1&dates=${dateStr}&league=${leagueCode}`;
                    if (DEBUG_API) {
                        espnLogger.debug({ url }, 'ESPN CDN API request');
                    }
                    try {
                        response = await httpClient.get(url);
                        cdnHealthy = true;
                    } catch (cdnError) {
                        espnLogger.warn({ error: cdnError.message }, 'CDN endpoint failed, falling back to main API');
                        cdnHealthy = false;
                        useCdnFallback = false;
                        url = `${BASE_URL}/${leagueCode}/scoreboard?dates=${dateStr}`;
                        response = await httpClient.get(url);
                    }
                } else {
                    url = `${BASE_URL}/${leagueCode}/scoreboard?dates=${dateStr}`;
                    if (DEBUG_API) {
                        espnLogger.debug({ url }, 'ESPN API request');
                    }
                    response = await httpClient.get(url);
                }

                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);

                // Site API returns `events` at the top level; the CDN (?xhr=1) nests them under content.sbData.
                const events = response.data?.events ?? response.data?.content?.sbData?.events;
                if (!Array.isArray(events)) {
                    espnLogger.warn({ url }, 'Resposta inesperada da API (sem events)');
                    return [];
                }

                if (DEBUG_API) {
                    espnLogger.debug({ eventCount: events.length }, 'ESPN API response received');
                }

                return events.map(event => {
                    const competition = event.competitions?.[0];
                    if (!competition) {
                        espnLogger.warn({ eventId: event.id }, 'Event sem competition');
                        return null;
                    }

                    const home = competition.competitors?.find(c => c.homeAway === 'home');
                    const away = competition.competitors?.find(c => c.homeAway === 'away');

                    if (!home || !away) {
                        espnLogger.warn({ eventId: event.id }, 'Event com competitors inválidos');
                        return null;
                    }

                    const venueAddr = competition.venue?.address;
                    return {
                        id: event.id,
                        tie: parseTie(competition),
                        homeTeam: {
                            id: home.team?.id,
                            name: home.team?.displayName || 'Casa',
                            logo: home.team?.logo,
                            form: home.form || undefined,
                            record: home.records?.find(r => r.type === 'total')?.summary || undefined,
                        },
                        awayTeam: {
                            id: away.team?.id,
                            name: away.team?.displayName || 'Visitante',
                            logo: away.team?.logo,
                            form: away.form || undefined,
                            record: away.records?.find(r => r.type === 'total')?.summary || undefined,
                        },
                        homeScore: parseInt(home.score, 10) || 0,
                        awayScore: parseInt(away.score, 10) || 0,
                        status: competition.status?.type?.name || 'unknown',
                        state: competition.status?.type?.state || 'unknown',
                        venue: competition.venue?.fullName || 'Não informado',
                        venueCity: venueAddr?.city || undefined,
                        startTime: event.date,
                        minute: competition.status?.displayClock || "0'",
                    };
                }).filter(match => match !== null);
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ error: error.message }, 'Erro ao buscar partidas');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: 'ESPN getTodayMatches',
        }
    ).then(result => {
        scoreboardCache.set(cacheKey, result);
        espnLogger.debug({ cacheKey, matchCount: result.length }, 'Scoreboard cache miss - fetched and cached');
        return result;
    }).catch(error => {
        recordEspnRequest(false, Date.now() - startTime, false);
        espnLogger.error({ error: error.message }, 'Todas as tentativas falharam para getTodayMatches');
        return [];
    });
}

/**
 * Parse the standings table from a summary response for a specific team.
 * Returns undefined when the competition has no table (e.g. World Cup group stage with no entries).
 * @param {Object|undefined} standings - response.data.standings
 * @param {string|undefined} teamId
 * @returns {{ rank: number, points: number, wins: number, losses: number, ties: number, gamesPlayed: number }|undefined}
 */
function parseStandingForTeam(standings, teamId) {
    if (!standings || !teamId) return undefined;
    const entries = (standings.groups || []).flatMap(g => g.standings?.entries || []);
    if (!entries.length) return undefined;
    // Summary entries carry `team` as a display-name string with the id alongside it
    // ({ team: "Juventus", id: "111" }); the /apis/v2 standings endpoint nests it as team.id.
    const entry = entries.find(e => String(e.team?.id ?? e.id) === String(teamId));
    if (!entry) return undefined;
    const stat = (name) => {
        const s = entry.stats?.find(s => s.name === name);
        if (s == null) return undefined;
        const n = Number(s.value);
        return Number.isFinite(n) ? n : undefined;
    };
    return {
        rank: stat('rank'),
        points: stat('points'),
        wins: stat('wins'),
        losses: stat('losses'),
        ties: stat('ties'),
        gamesPlayed: stat('gamesPlayed'),
    };
}

/**
 * Parse boxscore statistics from a summary response.
 * Returns undefined when boxscore is absent. Individual stats are undefined when not provided by ESPN
 * for a given league (e.g. World Cup returns a minimal stat set).
 * @param {Object|undefined} rawBoxscore - response.data.boxscore
 * @returns {{ home: Object, away: Object }|undefined}
 */
function parseBoxscore(rawBoxscore) {
    if (!rawBoxscore?.teams?.length) return undefined;
    const result = {};
    for (const teamData of rawBoxscore.teams) {
        const side = teamData.homeAway === 'home' ? 'home' : 'away';
        const stat = (name) => {
            const s = teamData.statistics?.find(s => s.name === name);
            return s != null ? s.displayValue ?? s.value : undefined;
        };
        const rawPoss = stat('possessionPct');
        result[side] = {
            possessionPct: rawPoss != null ? String(rawPoss).replace(/%$/, '') : undefined,
            totalShots: stat('totalShots'),
            shotsOnTarget: stat('shotsOnTarget'),
            wonCorners: stat('wonCorners'),
            yellowCards: stat('yellowCards'),
            redCards: stat('redCards'),
            saves: stat('saves'),
        };
    }
    return (result.home || result.away) ? result : undefined;
}

/**
 * Parse two-legged tie info (Copa do Brasil, Libertadores/Sul-Americana knockouts) from a scoreboard
 * competition or summary header competition. Returns undefined for single-match fixtures.
 * `series` is an object on the scoreboard and a one-element array in the summary header. ESPN only
 * fills aggregateScore from the 2nd leg on, and marks the tie winner once series.completed is true.
 * @param {Object|undefined} competition
 * @returns {{ leg: number, totalLegs: number, title?: string, homeAggregate?: number, awayAggregate?: number, completed: boolean, winnerTeamId?: string }|undefined}
 */
export function parseTie(competition) {
    if (!competition) return undefined;
    const series = Array.isArray(competition.series) ? competition.series[0] : competition.series;
    const leg = parseInt(competition.leg?.value ?? series?.leg, 10);
    if (!Number.isFinite(leg) || leg < 1) return undefined;
    const totalLegs = parseInt(series?.totalCompetitions, 10) || leg;
    if (totalLegs < 2) return undefined;

    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : undefined;
    };
    const seriesEntry = (id) => series?.competitors?.find(c => String(c.id) === String(id));
    const aggregateFor = (side) => {
        const c = competition.competitors?.find(x => x.homeAway === side);
        if (!c) return undefined;
        return toInt(seriesEntry(c.id ?? c.team?.id)?.aggregateScore ?? c.aggregateScore);
    };
    const winner = series?.completed ? series.competitors?.find(c => c.winner === true) : undefined;

    return {
        leg,
        totalLegs,
        title: series?.title || undefined,
        homeAggregate: aggregateFor('home'),
        awayAggregate: aggregateFor('away'),
        completed: Boolean(series?.completed),
        winnerTeamId: winner?.id != null ? String(winner.id) : undefined,
    };
}

/**
 * Get match details (equivalent to scoreboard for a single match or summary)
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Object|null>} Match details
 */
export async function getMatchDetails(matchId, leagueCode) {
    const cacheKey = `details:${leagueCode}:${matchId}`;
    const cached = detailsCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        if (DEBUG_API) {
            espnLogger.debug({ matchId }, 'Match details cache hit');
        }
        return cached;
    }

    const startTime = Date.now();

    return await retryWithBackoff(
        async () => {
            try {
                const url = getSummaryUrl(leagueCode, matchId);
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN API request');
                }
                const response = await httpClient.get(url);
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);

                if (!hasProps(response, ['data.header'])) {
                    espnLogger.warn({ matchId }, 'Match resposta sem header');
                    return null;
                }

                const header = response.data.header;
                const competition = header.competitions?.[0];

                if (!competition) {
                    espnLogger.warn({ matchId }, 'Match sem competition');
                    return null;
                }

                const home = competition.competitors?.find(c => c.homeAway === 'home');
                const away = competition.competitors?.find(c => c.homeAway === 'away');

                if (!home || !away) {
                    espnLogger.warn({ matchId }, 'Match competitors inválidos');
                    return null;
                }

                // Only present once a penalty shootout has decided the match (header.competitions[0]
                // .competitors[].shootoutScore); ESPN doesn't expose individual shootout kicks here.
                const homeShootoutScore = home.shootoutScore != null ? parseInt(home.shootoutScore, 10) : undefined;
                const awayShootoutScore = away.shootoutScore != null ? parseInt(away.shootoutScore, 10) : undefined;

                const homeStanding = parseStandingForTeam(response.data.standings, home.team?.id);
                const awayStanding = parseStandingForTeam(response.data.standings, away.team?.id);
                const boxscore = parseBoxscore(response.data.boxscore);

                return {
                    id: matchId,
                    homeTeam: {
                        id: home.team?.id,
                        name: home.team?.displayName || 'Casa',
                        // The summary header lists crests under `logos[]`; only the scoreboard has `logo`.
                        logo: home.team?.logo ?? home.team?.logos?.[0]?.href,
                        standing: homeStanding,
                    },
                    awayTeam: {
                        id: away.team?.id,
                        name: away.team?.displayName || 'Visitante',
                        logo: away.team?.logo ?? away.team?.logos?.[0]?.href,
                        standing: awayStanding,
                    },
                    homeScore: parseInt(home.score, 10) || 0,
                    awayScore: parseInt(away.score, 10) || 0,
                    homeShootoutScore,
                    awayShootoutScore,
                    tie: parseTie(competition),
                    status: competition.status?.type?.name || 'unknown',
                    venue: competition.venue?.fullName,
                    startTime: header.date,
                    minute: competition.status?.displayClock,
                    boxscore,
                    officials: normalizeOfficials(response.data.gameInfo?.officials),
                };
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar detalhes');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getMatchDetails(${matchId})`,
        }
    ).then(result => {
        if (result) {
            detailsCache.set(cacheKey, result);
            espnLogger.debug({ matchId }, 'Match details cached');
        }
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return null;
    });
}

/**
 * Get display name from a participant/athlete object (ESPN structure may vary by league).
 * @param {Object} participant - Raw participant from keyEvents[].participants[i]
 * @returns {string|undefined}
 */
function getParticipantDisplayName(participant) {
    const athlete = participant?.athlete;
    if (!athlete) return undefined;
    return athlete.displayName || athlete.shortDisplayName || athlete.fullName;
}

/**
 * Parse player in/out names from substitution description text.
 * Supports English and other common formats (e.g. Italian "X sostituisce Y").
 *
 * The player-out capture matches only consecutive Title-Case words (not "up to the next
 * period"): ESPN often appends an untagged, lowercase reason clause after the name with no
 * separating punctuation (e.g. "...substituindo Jordan Bos uma lesão." or "...replaces Jordan
 * Bos because of an injury."), which a period-anchored capture would swallow into the name.
 * @param {string} text - Event description
 * @returns {{ playerIn: string, playerOut: string }|null}
 */
function parseSubstitutionFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const namePart = '[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\\s\'-]+?';
    const strictName = '[A-ZÀ-Þ][A-Za-zà-ÿ\'-]*(?:\\s[A-ZÀ-Þ][A-Za-zà-ÿ\'-]*)*';
    const patterns = [
        { re: new RegExp(`entra em campo\\s+(${namePart})\\s+substituindo\\s+(${strictName})`), playerIn: 1, playerOut: 2 },
        { re: new RegExp(`(${namePart}) replaces (${strictName})`), playerIn: 1, playerOut: 2 },
        { re: new RegExp(`(${namePart}) on for (${strictName})`), playerIn: 1, playerOut: 2 },
        { re: new RegExp(`(${namePart}) sostituisce (${strictName})`), playerIn: 1, playerOut: 2 },
        { re: new RegExp(`(${namePart}) in per (${strictName})`), playerIn: 1, playerOut: 2 },
        { re: new RegExp(`(${namePart}) for (${strictName})`), playerIn: 1, playerOut: 2 },
    ];
    for (const { re, playerIn: i, playerOut: o } of patterns) {
        const m = text.match(re);
        if (m) return { playerIn: m[i].trim(), playerOut: m[o].trim() };
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
 * Get live events for a match (goals, cards, etc.)
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Array>} List of events
 */
export async function getLiveEvents(matchId, leagueCode) {
    const cacheKey = `events:${leagueCode}:${matchId}`;
    const cached = eventsCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        if (DEBUG_API) {
            espnLogger.debug({ matchId, eventCount: cached.length }, 'Live events cache hit');
        }
        return cached;
    }

    const startTime = Date.now();

    return await retryWithBackoff(
        async () => {
            try {
                const url = getSummaryUrl(leagueCode, matchId);
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN API request');
                }
                const response = await httpClient.get(url);
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);
                const raw = response.data?.keyEvents;
                const keyEvents = Array.isArray(raw) ? raw : [];

                if (DEBUG_API) {
                    espnLogger.debug({ matchId, eventCount: keyEvents.length }, 'Live events response');
                }

                return keyEvents.map(event => {
                    const type = event.type?.text?.toLowerCase() || 'event';
                    const description = event.text;
                    const p0Name = getParticipantDisplayName(event.participants?.[0]);
                    const p1Name = getParticipantDisplayName(event.participants?.[1]);
                    const base = {
                        id: event.id,
                        typeId: event.type?.id != null ? String(event.type.id) : undefined,
                        type,
                        minute: event.clock?.displayValue || "0'",
                        teamId: event.team?.id,
                        description,
                        player: p0Name != null ? { name: p0Name } : undefined,
                    };
                    if (type.includes('substitution') || type.includes('sub') || type.includes('substituição')) {
                        const parsed = parseSubstitutionFromText(description);
                        if (parsed) {
                            base.playerIn = { name: parsed.playerIn };
                            base.playerOut = { name: parsed.playerOut };
                            base.player = { name: parsed.playerIn };
                        } else if (p0Name && p1Name) {
                            base.playerIn = { name: p0Name };
                            base.playerOut = { name: p1Name };
                        }
                    } else if (type.includes('goal') || type.includes('gol') || type.includes('penalty') || type.includes('pênalti')) {
                        // Broad match is safe here: parseScorerFromGoalDescription only matches text
                        // starting with "Goal!"/"Gol!", so a missed/saved penalty (whose description
                        // doesn't start that way) simply yields no scorer rather than a wrong one.
                        const playerFromText = parsePlayerFromEventDescription(description);
                        if (playerFromText) {
                            base.player = { name: playerFromText };
                        }
                    }
                    return base;
                });
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar eventos');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getLiveEvents(${matchId})`,
        }
    ).then(result => {
        eventsCache.set(cacheKey, result);
        espnLogger.debug({ matchId, eventCount: result.length }, 'Live events cached');
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return [];
    });
}

/**
 * Empty implementation as legacy support
 */
export async function getBrasileiraoLeagueId() {
    return 'bra.1';
}

/**
 * Get match officials (referee, assistants, etc.).
 * Prefers summary gameInfo.officials via getMatchDetails cache; falls back to core API.
 * Empty results are not cached so pre-match polls can retry until ESPN publishes them.
 * @param {string} matchId
 * @param {string} leagueCode
 * @returns {Promise<Array<{ id?: string, name: string, positionName: string, positionId: string, order: number }>>}
 */
export async function getMatchOfficials(matchId, leagueCode) {
    const officialsKey = `officials:${leagueCode}:${matchId}`;
    const cachedOfficials = officialsCache.get(officialsKey);
    if (cachedOfficials !== undefined) {
        recordEspnRequest(true, 0, true);
        return cachedOfficials;
    }

    const detailsKey = `details:${leagueCode}:${matchId}`;
    const cachedDetails = detailsCache.get(detailsKey);
    if (cachedDetails?.officials?.length) {
        officialsCache.set(officialsKey, cachedDetails.officials);
        recordEspnRequest(true, 0, true);
        return cachedDetails.officials;
    }

    const details = await getMatchDetails(matchId, leagueCode);
    if (details?.officials?.length) {
        officialsCache.set(officialsKey, details.officials);
        return details.officials;
    }

    const startTime = Date.now();
    return await retryWithBackoff(
        async () => {
            try {
                const url = `${CORE_BASE_URL}/${leagueCode}/events/${matchId}/competitions/${matchId}/officials`;
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN core officials request');
                }
                const response = await httpClient.get(url);
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);
                return normalizeOfficials(response.data?.items);
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar árbitros');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getMatchOfficials(${matchId})`,
        }
    ).then((result) => {
        if (result.length > 0) {
            officialsCache.set(officialsKey, result);
            espnLogger.debug({ matchId, count: result.length }, 'Officials cached');
        }
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return [];
    });
}

/** Largest page size the core API honors; above this it silently falls back to 25 per page. */
const MAX_PLAYS_PAGE_SIZE = 1000;

/**
 * Core plays page URL. Narratives are requested in Portuguese when the bot posts in Portuguese;
 * play ids are the same in every language, so switching does not affect dedup.
 * @param {string} leagueCode
 * @param {string} matchId
 * @param {{ page: number, pageSize: number, language?: string }} options
 * @returns {string}
 */
export function getPlaysUrl(leagueCode, matchId, { page, pageSize, language = config.i18n.defaultLanguage }) {
    const lang = wantsPortuguese(language) ? '&lang=pt&region=br' : '';
    return `${CORE_BASE_URL}/${leagueCode}/events/${matchId}/competitions/${matchId}/plays?limit=${pageSize}&page=${page}${lang}`;
}

/**
 * Get play-by-play items from ESPN core API (shots, saves, passes, etc.).
 * The endpoint is paginated in ascending order and a full match has ~1500 plays, so every page
 * is fetched — reading only page 1 would freeze the feed partway through the first half.
 * @param {string} matchId
 * @param {string} leagueCode
 * @param {{ limit?: number }} [options] - Page size (capped at MAX_PLAYS_PAGE_SIZE)
 * @returns {Promise<ReturnType<typeof normalizePlay>[]>}
 */
export async function getMatchPlays(matchId, leagueCode, { limit = MAX_PLAYS_PAGE_SIZE } = {}) {
    const cacheKey = `plays:${leagueCode}:${matchId}`;
    const cached = playsCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        if (DEBUG_API) {
            espnLogger.debug({ matchId, playCount: cached.length }, 'Plays cache hit');
        }
        return cached;
    }

    const startTime = Date.now();
    return await retryWithBackoff(
        async () => {
            try {
                const pageSize = Math.min(Math.max(1, limit), MAX_PLAYS_PAGE_SIZE);
                const pageUrl = (page) => getPlaysUrl(leagueCode, matchId, { page, pageSize });
                if (DEBUG_API) {
                    espnLogger.debug({ url: pageUrl(1) }, 'ESPN core plays request');
                }
                const first = await httpClient.get(pageUrl(1));
                const pageCount = parseInt(first.data?.pageCount, 10) || 1;
                const rest = await Promise.all(
                    Array.from({ length: pageCount - 1 }, (_, i) => httpClient.get(pageUrl(i + 2)))
                );
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);
                const items = [first, ...rest].flatMap((r) => (Array.isArray(r.data?.items) ? r.data.items : []));
                return items.map(normalizePlay).filter((p) => p.id);
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar plays');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getMatchPlays(${matchId})`,
        }
    ).then((result) => {
        playsCache.set(cacheKey, result);
        espnLogger.debug({ matchId, playCount: result.length }, 'Plays cached');
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return [];
    });
}

/**
 * Summary URL for the live commentary feed. Like plays, it is requested in Portuguese whenever the bot
 * posts in Portuguese, independent of ESPN_USE_PT_DESCRIPTIONS (which only governs keyEvents).
 * @param {string} leagueCode
 * @param {string} matchId
 * @param {{ language?: string }} [options]
 * @returns {string}
 */
export function getCommentaryUrl(leagueCode, matchId, { language = config.i18n.defaultLanguage } = {}) {
    return wantsPortuguese(language)
        ? `${WEB_BASE_URL}/${leagueCode}/summary?event=${matchId}&lang=pt&region=br`
        : `${BASE_URL}/${leagueCode}/summary?event=${matchId}`;
}

/**
 * Normalize one ESPN summary `commentary[]` entry. Most entries link to a play (same id space as the
 * core plays feed and keyEvents); a few, like stoppage-time announcements, have no play.
 * @param {Object|null} raw
 * @returns {{ sequence: number|null, playId: string|null, typeId: string|null, minute: string, text: string }}
 */
export function normalizeCommentary(raw) {
    const play = raw?.play;
    return {
        sequence: typeof raw?.sequence === 'number' ? raw.sequence : null,
        playId: play?.id != null ? String(play.id) : null,
        typeId: play?.type?.id != null ? String(play.type.id) : null,
        minute: raw?.time?.displayValue || '',
        text: (raw?.text || '').trim(),
    };
}

/**
 * Get ESPN's live commentary for a match (fouls, corners, shots, offsides… plus the key events).
 * @param {string} matchId
 * @param {string} leagueCode
 * @returns {Promise<ReturnType<typeof normalizeCommentary>[]>} Entries in ESPN sequence order
 */
export async function getMatchCommentary(matchId, leagueCode) {
    const cacheKey = `commentary:${leagueCode}:${matchId}`;
    const cached = commentaryCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        return cached;
    }

    const startTime = Date.now();
    return await retryWithBackoff(
        async () => {
            try {
                const url = getCommentaryUrl(leagueCode, matchId);
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN commentary request');
                }
                const response = await httpClient.get(url);
                recordEspnRequest(true, Date.now() - startTime, false);
                const raw = Array.isArray(response.data?.commentary) ? response.data.commentary : [];
                return raw
                    .map(normalizeCommentary)
                    .filter((e) => e.text)
                    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
            } catch (error) {
                recordEspnRequest(false, Date.now() - startTime, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar comentários');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getMatchCommentary(${matchId})`,
        }
    ).then((result) => {
        commentaryCache.set(cacheKey, result);
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return [];
    });
}

/**
 * Get highlights/videos for a match
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Array>} List of highlight objects with URLs
 */
export async function getHighlights(matchId, leagueCode) {
    const cacheKey = `highlights:${leagueCode}:${matchId}`;
    const cached = highlightsCache.get(cacheKey);
    if (cached !== undefined) {
        recordEspnRequest(true, 0, true);
        if (DEBUG_API) {
            espnLogger.debug({ matchId, highlightCount: cached.length }, 'Highlights cache hit');
        }
        return cached;
    }

    const startTime = Date.now();

    return await retryWithBackoff(
        async () => {
            try {
                const url = getSummaryUrl(leagueCode, matchId);
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN API request');
                }
                const response = await httpClient.get(url);
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);
                const videos = response.data?.videos || [];

                if (DEBUG_API) {
                    espnLogger.debug({ matchId, videoCount: videos.length }, 'Highlights response');
                }

                return videos
                    .map(v => {
                        // Get best quality URL available
                        const url = v.links?.source?.mezzanine?.href ||
                            v.links?.source?.HD?.href ||
                            v.links?.source?.href ||
                            v.links?.mobile?.source?.href;

                        if (!url) {
                            espnLogger.debug({ matchId }, 'Highlight sem URL válida');
                            return null;
                        }

                        return {
                            url,
                            title: v.headline || 'Highlight',
                            thumbnail: v.thumbnail || undefined,
                        };
                    })
                    .filter(h => h !== null);
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(false, latencyMs, false);
                espnLogger.error({ matchId, error: error.message }, 'Erro ao buscar highlights');
                throw error;
            }
        },
        {
            shouldRetry: isRetryableError,
            operationName: `ESPN getHighlights(${matchId})`,
        }
    ).then(result => {
        highlightsCache.set(cacheKey, result);
        espnLogger.debug({ matchId, highlightCount: result.length }, 'Highlights cached');
        return result;
    }).catch(() => {
        recordEspnRequest(false, Date.now() - startTime, false);
        return [];
    });
}
