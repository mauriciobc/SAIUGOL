#!/usr/bin/env node

import 'dotenv/config';
import { getAllMatchStatuses, getMatchStatus } from '../src/api/fastcast.js';

async function showLiveDetails() {
    console.log('=== Showing details for all leagues ===\n');
    
    const leagues = ['bra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1'];
    
    for (const league of leagues) {
        const matches = await getAllMatchStatuses(league);
        
        console.log(`\n${league}:`);
        
        for (const m of matches) {
            console.log(`  ${m.id}: ${m.homeName} x ${m.awayName}`);
            console.log(`    Status: ${m.status}, Clock: ${m.clock}`);
            if (m.homeScore !== undefined) {
                console.log(`    Score: ${m.homeScore} x ${m.awayScore}`);
            }
            if (m.lastPlay) {
                console.log(`    LastPlay: ${m.lastPlay}`);
            }
        }
    }
}

async function testChangeDetection() {
    console.log('\n=== Testing change detection ===\n');
    
    const league = 'bra.1';
    const matches = await getAllMatchStatuses(league);
    
    if (matches.length > 0) {
        const match = matches[0];
        console.log(`Testing with match ${match.id}`);
        
        const prevState = {
            status: 'pre',
            homeScore: 0,
            awayScore: 0,
            clock: '0\'',
            lastPlay: null,
        };
        
        const result = await checkForChanges(league, match.id, prevState);
        console.log('Change detection result:', result);
    }
}

async function checkForChanges(leagueCode, matchId, previousState) {
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

showLiveDetails().then(testChangeDetection).catch(console.error);
