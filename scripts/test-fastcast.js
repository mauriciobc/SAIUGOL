#!/usr/bin/env node

import axios from 'axios';

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SCOREBOARD_HEADER = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';

async function getCurrentMatchIds() {
    const leagues = ['bra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1'];
    const allMatches = [];
    
    for (const league of leagues) {
        try {
            const url = `${ESPN_API_BASE}/${league}/scoreboard`;
            const resp = await axios.get(url);
            const events = resp.data.events || [];
            
            for (const evt of events) {
                allMatches.push({
                    id: evt.id,
                    league,
                    status: evt.status?.type?.description,
                });
            }
        } catch (e) {
            console.error(`Error: ${e.message}`);
        }
    }
    return allMatches;
}

async function fetchScoreboardHeader(league) {
    const url = `${SCOREBOARD_HEADER}?sport=soccer&league=${league}&region=br&lang=pt&contentorigin=deportes&configuration=STREAM_MENU&platform=web&features=sfb-all,cutl`;
    
    const start = Date.now();
    const resp = await axios.get(url, { timeout: 10000 });
    const elapsed = Date.now() - start;
    
    return { 
        status: resp.status, 
        elapsed,
        size: JSON.stringify(resp.data).length,
        data: resp.data,
    };
}

async function fetchSummaryApi(league, matchId) {
    const url = `${ESPN_API_BASE}/${league}/summary?event=${matchId}`;
    
    const start = Date.now();
    const resp = await axios.get(url, { timeout: 10000 });
    const elapsed = Date.now() - start;
    
    return { 
        status: resp.status, 
        elapsed,
        size: JSON.stringify(resp.data).length,
        data: resp.data,
    };
}

async function fetchScoreboardApi(league) {
    const url = `${ESPN_API_BASE}/${league}/scoreboard`;
    
    const start = Date.now();
    const resp = await axios.get(url, { timeout: 10000 });
    const elapsed = Date.now() - start;
    
    return { 
        status: resp.status, 
        elapsed,
        size: JSON.stringify(resp.data).length,
        data: resp.data,
    };
}

function analyzeHeaderData(data, league) {
    const events = data.leagues?.[0]?.events || [];
    const results = [];
    
    for (const evt of events) {
        results.push({
            id: evt.id,
            status: evt.status,
            clock: evt.summary,
            period: evt.period,
            homeScore: evt.competitors?.home?.score,
            awayScore: evt.competitors?.away?.score,
            homeName: evt.competitors?.home?.team?.displayName,
            awayName: evt.competitors?.away?.team?.displayName,
            lastPlay: evt.situation?.lastPlay?.text,
        });
    }
    
    return results;
}

async function main() {
    console.log('=== ESPN API Comparison: Header vs Summary vs Scoreboard ===\n');
    
    console.log('Step 1: Get current matches...');
    const matches = await getCurrentMatchIds();
    console.log(`Found ${matches.length} total events across leagues`);
    
    const liveMatches = matches.filter(m => m.status === 'In Progress');
    console.log(`Live: ${liveMatches.length}`);
    
    const scheduledMatches = matches.filter(m => m.status === 'Scheduled');
    console.log(`Scheduled: ${scheduledMatches.length}`);
    
    if (liveMatches.length > 0) {
        console.log('\n=== Comparing APIs for LIVE match ===\n');
        
        const testMatch = liveMatches[0];
        const league = testMatch.league;
        const matchId = testMatch.id;
        
        console.log(`Testing: ${league}/${matchId}\n`);
        
        const header = await fetchScoreboardHeader(league);
        console.log('Scoreboard Header:');
        console.log(`  Status: ${header.status}`);
        console.log(`  Time: ${header.elapsed}ms`);
        console.log(`  Size: ${header.size} bytes`);
        
        const summary = await fetchSummaryApi(league, matchId);
        console.log('\nSummary API:');
        console.log(`  Status: ${summary.status}`);
        console.log(`  Time: ${summary.elapsed}ms`);
        console.log(`  Size: ${summary.size} bytes`);
        
        const scoreboard = await fetchScoreboardApi(league);
        console.log('\nScoreboard API:');
        console.log(`  Status: ${scoreboard.status}`);
        console.log(`  Time: ${scoreboard.elapsed}ms`);
        console.log(`  Size: ${scoreboard.size} bytes`);
        
        console.log('\n=== Header Data Analysis ===');
        const headerEvents = analyzeHeaderData(header.data, league);
        const liveHeaderEvents = headerEvents.filter(e => e.status === 'in');
        
        for (const evt of liveHeaderEvents) {
            console.log(`\nMatch ${evt.id}:`);
            console.log(`  Status: ${evt.status}, Clock: ${evt.clock}, Period: ${evt.period}`);
            console.log(`  Score: ${evt.homeName} ${evt.homeScore} x ${evt.awayScore} ${evt.awayName}`);
            console.log(`  LastPlay: ${evt.lastPlay}`);
        }
        
        console.log('\n=== Data Availability Comparison ===');
        console.log('\nWhat Header provides:');
        console.log('  - status (in/pre/post)');
        console.log('  - clock (minute)');
        console.log('  - period');
        console.log('  - competitors with scores');
        console.log('  - situation.lastPlay.text (latest event in PT)');
        console.log('\nWhat Summary provides:');
        console.log('  - All of above plus:');
        console.log('  - keyEvents (all goals, substitutions, cards)');
        console.log('  - team details, venue, officials');
        console.log('  - statistics (possession, shots, etc.)');
        
        console.log('\n=== Recommendation ===');
        console.log('Header is ~5-10x smaller and faster for status/score.');
        console.log('Use Header for: detecting changes, trigger full poll.');
        console.log('Use Summary for: detailed events, match start/end posts.');
        
    } else {
        console.log('\nNo live matches. Testing with scheduled match...');
        
        if (scheduledMatches.length > 0) {
            const testMatch = scheduledMatches[0];
            const league = testMatch.league;
            
            const header = await fetchScoreboardHeader(league);
            console.log(`\nScoreboard Header (${league}):`);
            console.log(`  Time: ${header.elapsed}ms`);
            console.log(`  Size: ${header.size} bytes`);
            
            const headerEvents = analyzeHeaderData(header.data, league);
            console.log(`\nEvents from header:`);
            for (const evt of headerEvents.slice(0, 5)) {
                console.log(`  ${evt.id}: ${evt.status} - ${evt.homeName} x ${evt.awayName}`);
            }
        }
    }
}

main().catch(console.error);
