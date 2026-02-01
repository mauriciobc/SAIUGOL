import axios from 'axios';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUE = 'bra.1';

/**
 * Get today's matches for Brasileirão Serie A from ESPN
 * @returns {Promise<Array>} List of normalized matches
 */
export async function getTodayMatches() {
    try {
        const response = await axios.get(`${BASE_URL}/${LEAGUE}/scoreboard`);
        const events = response.data?.events || [];

        return events.map(event => {
            const competition = event.competitions[0];
            const home = competition.competitors.find(c => c.homeAway === 'home');
            const away = competition.competitors.find(c => c.homeAway === 'away');

            return {
                id: event.id,
                homeTeam: {
                    id: home.team.id,
                    name: home.team.displayName,
                },
                awayTeam: {
                    id: away.team.id,
                    name: away.team.displayName,
                },
                homeScore: parseInt(home.score, 10) || 0,
                awayScore: parseInt(away.score, 10) || 0,
                status: competition.status.type.name,
                state: competition.status.type.state,
                venue: competition.venue?.fullName || 'Não informado',
                startTime: event.date,
                minute: competition.status.displayClock || '0\'',
            };
        });
    } catch (error) {
        console.error('[ESPN] Erro ao buscar partidas:', error.message);
        return [];
    }
}

/**
 * Get match details (equivalent to scoreboard for a single match or summary)
 * @param {string} matchId - The match ID
 * @returns {Promise<Object|null>} Match details
 */
export async function getMatchDetails(matchId) {
    try {
        const response = await axios.get(`${BASE_URL}/${LEAGUE}/summary?event=${matchId}`);
        const header = response.data?.header;
        const competition = header?.competitions?.[0];

        if (!competition) return null;

        const home = competition.competitors.find(c => c.homeAway === 'home');
        const away = competition.competitors.find(c => c.homeAway === 'away');

        return {
            id: matchId,
            homeTeam: {
                id: home.team.id,
                name: home.team.displayName,
            },
            awayTeam: {
                id: away.team.id,
                name: away.team.displayName,
            },
            homeScore: parseInt(home.score, 10) || 0,
            awayScore: parseInt(away.score, 10) || 0,
            status: competition.status.type.name,
            venue: competition.venue?.fullName,
            startTime: header.date,
            minute: competition.status.displayClock,
        };
    } catch (error) {
        console.error(`[ESPN] Erro ao buscar detalhes ${matchId}:`, error.message);
        return null;
    }
}

/**
 * Get live events for a match (goals, cards, etc.)
 * @param {string} matchId - The match ID
 * @returns {Promise<Array>} List of events
 */
export async function getLiveEvents(matchId) {
    try {
        const response = await axios.get(`${BASE_URL}/${LEAGUE}/summary?event=${matchId}`);
        // ESPN calls events "plays" or "keyEvents"
        const keyEvents = response.data?.keyEvents || [];

        return keyEvents.map(event => ({
            id: event.id,
            type: event.type?.text?.toLowerCase() || 'event',
            minute: event.clock?.displayValue || '0\'',
            teamId: event.team?.id,
            description: event.text,
            player: event.participants?.[0]?.athlete?.displayName,
        }));
    } catch (error) {
        console.error(`[ESPN] Erro ao buscar eventos ${matchId}:`, error.message);
        return [];
    }
}

/**
 * Empty implementation as legacy support
 */
export async function getBrasileiraoLeagueId() {
    return LEAGUE;
}

export async function getHighlights(matchId) {
    // ESPN often has highlights in the summary under 'videos'
    try {
        const response = await axios.get(`${BASE_URL}/${LEAGUE}/summary?event=${matchId}`);
        const videos = response.data?.videos || [];
        return videos.map(v => ({
            url: v.links?.source?.mezzanine?.href || v.links?.mobile?.href,
            title: v.headline
        }));
    } catch (error) {
        return [];
    }
}
