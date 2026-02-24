import axios from 'axios';
import NodeCache from 'node-cache';
import { config } from '../config.js';

const SCOREBOARD_HEADER_URL = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';

const headerCache = new NodeCache({ stdTTL: 15 });

const httpClient = axios.create({
    timeout: 5000,
});

function buildHeaderUrl(leagueCode) {
    const params = new URLSearchParams({
        sport: 'soccer',
        league: leagueCode,
        region: 'br',
        lang: 'pt',
        contentorigin: 'deportes',
        configuration: 'STREAM_MENU',
        platform: 'web',
        features: 'sfb-all,cutl',
    });
    return `${SCOREBOARD_HEADER_URL}?${params.toString()}`;
}

function extractMatchData(event) {
    const competitors = event.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    
    const parseScore = (s) => {
        if (s == null || s === '') return undefined;
        const n = parseInt(s, 10);
        return isNaN(n) ? undefined : n;
    };
    
    return {
        id: event.id,
        status: event.status,
        clock: event.summary,
        period: event.period,
        displayClock: event.clock,
        homeScore: parseScore(home?.score),
        awayScore: parseScore(away?.score),
        homeName: home?.displayName,
        awayName: away?.displayName,
        homeAbbrev: home?.abbreviation,
        awayAbbrev: away?.abbreviation,
        lastPlay: event.situation?.lastPlay?.text,
    };
}

function extractFromSports(data, leagueCode) {
    const soccer = data.sports?.find(s => s.name === 'soccer' || s.name === 'Futebol' || s.name === 'Football');
    if (!soccer) return [];
    
    const league = soccer.leagues?.find(l => 
        l.abbreviation?.toLowerCase() === leagueCode.toLowerCase() || 
        l.id?.toLowerCase() === leagueCode.toLowerCase() ||
        l.slug === leagueCode
    );
    if (!league) return [];
    
    return league.events || [];
}

export async function getMatchStatus(leagueCode, matchId) {
    const allMatches = await getAllMatchStatuses(leagueCode);
    return allMatches.find(m => m.id === matchId) || null;
}

export async function getAllMatchStatuses(leagueCode) {
    const cacheKey = `header:all:${leagueCode}`;
    const cached = headerCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }
    
    try {
        const url = buildHeaderUrl(leagueCode);
        const resp = await httpClient.get(url);
        
        const rawEvents = extractFromSports(resp.data, leagueCode);
        const matches = rawEvents.map(extractMatchData);
        
        headerCache.set(cacheKey, matches, 15);
        
        return matches;
    } catch (error) {
        console.error(`[Fastcast] Error fetching all statuses for ${leagueCode}:`, error.message);
        return [];
    }
}

export async function checkForChanges(leagueCode, matchId, previousState) {
    const current = await getMatchStatus(leagueCode, matchId);
    
    if (!current) {
        return { changed: false, current: null };
    }
    
    if (!previousState) {
        return { changed: true, current };
    }
    
    const changed = 
        current.status !== previousState.status ||
        current.homeScore !== previousState.homeScore ||
        current.awayScore !== previousState.awayScore ||
        current.clock !== previousState.clock ||
        current.lastPlay !== previousState.lastPlay;
    
    return { changed, current };
}

export async function getLiveMatchIds(leagueCode) {
    const matches = await getAllMatchStatuses(leagueCode);
    return matches
        .filter(m => m.status === 'in')
        .map(m => m.id);
}

export async function getScheduledMatchIds(leagueCode) {
    const matches = await getAllMatchStatuses(leagueCode);
    return matches
        .filter(m => m.status === 'pre' || m.status === 'Scheduled')
        .map(m => m.id);
}

export function clearCache() {
    headerCache.flushAll();
}

export const headerCacheStats = () => headerCache.getStats();
