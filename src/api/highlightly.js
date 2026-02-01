import axios from 'axios';
import { config } from '../config.js';

const apiClient = axios.create({
    baseURL: config.rapidApi.baseUrl,
    headers: {
        'X-RapidAPI-Key': config.rapidApi.key,
        'X-RapidAPI-Host': config.rapidApi.host,
    },
});

/**
 * Get the Brasileirão Serie A league ID
 * @returns {Promise<number|null>} League ID or null if not found
 */
export async function getBrasileiraoLeagueId() {
    try {
        const response = await apiClient.get('/leagues', {
            params: {
                countryCode: config.bot.countryCode,
                leagueName: config.bot.leagueName,
            },
        });

        const leagues = response.data?.data || [];
        const brasileirao = leagues.find(
            (league) =>
                league.name?.toLowerCase().includes('serie a') ||
                league.name?.toLowerCase().includes('brasileirão')
        );

        return brasileirao?.id || null;
    } catch (error) {
        console.error('[Highlightly] Erro ao buscar ligas:', error.message);
        return null;
    }
}

/**
 * Get today's matches for a specific league
 * @param {number} leagueId - The league ID
 * @returns {Promise<Array>} List of matches
 */
export async function getTodayMatches(leagueId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await apiClient.get('/matches', {
            params: {
                date: today,
                leagueId,
                timezone: 'America/Sao_Paulo',
            },
        });

        return response.data?.data || [];
    } catch (error) {
        console.error('[Highlightly] Erro ao buscar partidas:', error.message);
        return [];
    }
}

/**
 * Get all matches for a league (regardless of date)
 * @param {number} leagueId - The league ID
 * @returns {Promise<Array>} List of matches
 */
export async function getMatchesByLeague(leagueId) {
    try {
        const response = await apiClient.get('/matches', {
            params: {
                leagueId,
                timezone: 'America/Sao_Paulo',
            },
        });

        return response.data?.data || [];
    } catch (error) {
        console.error('[Highlightly] Erro ao buscar partidas da liga:', error.message);
        return [];
    }
}

/**
 * Get match details by ID
 * @param {number} matchId - The match ID
 * @returns {Promise<Object|null>} Match details or null
 */
export async function getMatchDetails(matchId) {
    try {
        const response = await apiClient.get(`/matches/${matchId}`);
        return response.data?.data || null;
    } catch (error) {
        console.error(`[Highlightly] Erro ao buscar detalhes da partida ${matchId}:`, error.message);
        return null;
    }
}

/**
 * Get live events for a match
 * @param {number} matchId - The match ID
 * @returns {Promise<Array>} List of live events
 */
export async function getLiveEvents(matchId) {
    try {
        const response = await apiClient.get(`/matches/${matchId}/live-events`);
        return response.data?.data || [];
    } catch (error) {
        console.error(`[Highlightly] Erro ao buscar eventos ao vivo ${matchId}:`, error.message);
        return [];
    }
}

/**
 * Get highlights for a match
 * @param {number} matchId - The match ID
 * @returns {Promise<Array>} List of highlights with URLs
 */
export async function getHighlights(matchId) {
    try {
        const response = await apiClient.get('/highlights', {
            params: { matchId },
        });
        return response.data?.data || [];
    } catch (error) {
        console.error(`[Highlightly] Erro ao buscar highlights ${matchId}:`, error.message);
        return [];
    }
}

/**
 * Get match statistics
 * @param {number} matchId - The match ID
 * @returns {Promise<Object|null>} Match statistics or null
 */
export async function getMatchStatistics(matchId) {
    try {
        const response = await apiClient.get(`/matches/${matchId}/statistics`);
        return response.data?.data || null;
    } catch (error) {
        console.error(`[Highlightly] Erro ao buscar estatísticas ${matchId}:`, error.message);
        return null;
    }
}
