#!/usr/bin/env node

import 'dotenv/config';
import { getTodayMatches } from '../src/api/espn.js';
import { getAllMatchStatuses as getHeaderStatuses } from '../src/api/fastcast.js';
import { matchesToSnapshotMap } from '../src/state/snapshotContract.js';

async function testIntegration() {
    console.log('=== Testing Header-First Strategy ===\n');
    
    const league = 'bra.1';
    
    console.log('Step 1: Get matches from Scoreboard API...');
    const matches = await getTodayMatches(league);
    console.log(`  Found ${matches.length} matches`);
    
    console.log('\nStep 2: Get status from Header API...');
    const headerMatches = await getHeaderStatuses(league);
    console.log(`  Found ${headerMatches.length} matches`);
    
    const headerMap = new Map(headerMatches.map(m => [m.id, m]));
    
    if (matches.length > 0) {
        console.log('\nStep 3: Compare data...');
        
        for (const match of matches.slice(0, 3)) {
            const matchId = String(match.id);
            const snap = matchesToSnapshotMap([match]).get(matchId);
            const header = headerMap.get(matchId);
            
            console.log(`\n  Match ${matchId}:`);
            console.log(`    Scoreboard: status=${snap?.status}, score=${snap?.score?.home}-${snap?.score?.away}, time=${snap?.gameTime}`);
            console.log(`    Header:     status=${header?.status}, score=${header?.homeScore}-${header?.awayScore}, clock=${header?.clock}`);
            console.log(`    lastPlay: ${header?.lastPlay?.slice(0, 50) || '(none)'}`);
        }
    } else {
        console.log('\nNo matches from scoreboard API. Testing with header data only...');
        
        const liveMatches = headerMatches.filter(m => m.status === 'in');
        const scheduledMatches = headerMatches.filter(m => m.status === 'pre');
        
        console.log(`\nLive: ${liveMatches.length}, Scheduled: ${scheduledMatches.length}`);
        
        if (liveMatches.length > 0) {
            console.log('\nSample live match:');
            const m = liveMatches[0];
            console.log(`  ${m.homeName} x ${m.awayName}`);
            console.log(`  Status: ${m.status}, Score: ${m.homeScore}-${m.awayScore}, Clock: ${m.clock}`);
            console.log(`  lastPlay: ${m.lastPlay}`);
        }
    }
    
    console.log('\n✓ Test complete');
}

testIntegration().catch(console.error);
