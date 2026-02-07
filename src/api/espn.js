import axios from 'axios';
import NodeCache from 'node-cache';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { config } from '../config.js';
import { espnLogger } from '../utils/logger.js';
import { recordEspnRequest } from '../utils/metrics.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const CDN_URL = 'https://cdn.espn.com/core/soccer';
const DEBUG_API = process.env.DEBUG_API === 'true';

const ESPN_DOCUMENTED_ENDPOINTS = [
    { path: '/scoreboard', method: 'GET', documented: true },
    { path: '/summary', method: 'GET', documented: false },
];

const ESPN_CDN_ENDPOINTS = [
    { path: '/scoreboard', method: 'GET' },
];

let useCdnFallback = false;
let cdnHealthy = true;

const httpClient = axios.create({
    timeout: config.espn.requestTimeoutMs,
});

const scoreboardCache = new NodeCache({ stdTTL: config.cache.scoreboardTtlMs / 1000 });
const detailsCache = new NodeCache({ stdTTL: config.cache.detailsTtlMs / 1000 });
const eventsCache = new NodeCache({ stdTTL: config.cache.eventsTtlMs / 1000 });
const highlightsCache = new NodeCache({ stdTTL: config.cache.highlightsTtlMs / 1000 });

function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
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
 * Get today's matches for a specific league from ESPN
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

                if (!hasProps(response, ['data.events'])) {
                    espnLogger.warn({ response }, 'Resposta inesperada da API (sem events)');
                    return [];
                }

                const events = response.data.events || [];

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

                    return {
                        id: event.id,
                        homeTeam: {
                            id: home.team?.id,
                            name: home.team?.displayName || 'Casa',
                        },
                        awayTeam: {
                            id: away.team?.id,
                            name: away.team?.displayName || 'Visitante',
                        },
                        homeScore: parseInt(home.score, 10) || 0,
                        awayScore: parseInt(away.score, 10) || 0,
                        status: competition.status?.type?.name || 'unknown',
                        state: competition.status?.type?.state || 'unknown',
                        venue: competition.venue?.fullName || 'Não informado',
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
 * Get match details (equivalent to scoreboard for a single match or summary)
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Object|null>} Match details
 */
export async function getMatchDetails(matchId, leagueCode) {
    const cacheKey = `details:${matchId}`;
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
                const url = `${BASE_URL}/${leagueCode}/summary?event=${matchId}`;
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

                return {
                    id: matchId,
                    homeTeam: {
                        id: home.team?.id,
                        name: home.team?.displayName || 'Casa',
                    },
                    awayTeam: {
                        id: away.team?.id,
                        name: away.team?.displayName || 'Visitante',
                    },
                    homeScore: parseInt(home.score, 10) || 0,
                    awayScore: parseInt(away.score, 10) || 0,
                    status: competition.status?.type?.name || 'unknown',
                    venue: competition.venue?.fullName,
                    startTime: header.date,
                    minute: competition.status?.displayClock,
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
 * Get live events for a match (goals, cards, etc.)
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Array>} List of events
 */
export async function getLiveEvents(matchId, leagueCode) {
    const cacheKey = `events:${matchId}`;
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
                const url = `${BASE_URL}/${leagueCode}/summary?event=${matchId}`;
                if (DEBUG_API) {
                    espnLogger.debug({ url }, 'ESPN API request');
                }
                const response = await httpClient.get(url);
                const latencyMs = Date.now() - startTime;
                recordEspnRequest(true, latencyMs, false);
                const keyEvents = response.data?.keyEvents || [];

                if (DEBUG_API) {
                    espnLogger.debug({ matchId, eventCount: keyEvents.length }, 'Live events response');
                }

                return keyEvents.map(event => ({
                    id: event.id,
                    type: event.type?.text?.toLowerCase() || 'event',
                    minute: event.clock?.displayValue || "0'",
                    teamId: event.team?.id,
                    description: event.text,
                    player: event.participants?.[0]?.athlete?.displayName,
                }));
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
 * Get highlights/videos for a match
 * @param {string} matchId - The match ID
 * @param {string} leagueCode - The league code
 * @returns {Promise<Array>} List of highlight objects with URLs
 */
export async function getHighlights(matchId, leagueCode) {
    const cacheKey = `highlights:${matchId}`;
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
                const url = `${BASE_URL}/${leagueCode}/summary?event=${matchId}`;
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
                            v.links?.mobile?.href;

                        if (!url) {
                            espnLogger.debug({ matchId }, 'Highlight sem URL válida');
                            return null;
                        }

                        return {
                            url,
                            title: v.headline || 'Highlight',
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
