#!/usr/bin/env node

import 'dotenv/config';
import { getMatchStatus, getAllMatchStatuses, getLiveMatchIds, headerCacheStats } from '../src/api/fastcast.js';
import { leagues } from '../src/data/leagues.js';

async function testAllLeagues() {
    console.log('=== Testing Fastcast API for all leagues ===\n');
    
    const leagueCodes = Object.keys(leagues);
    console.log(`Testing ${leagueCodes.length} leagues...\n`);
    
    for (const leagueCode of leagueCodes) {
        console.log(`--- ${leagueCode} (${leagues[leagueCode].name}) ---`);
        
        try {
            const start = Date.now();
            const matches = await getAllMatchStatuses(leagueCode);
            const elapsed = Date.now() - start;
            
            console.log(`  Status: OK (${elapsed}ms)`);
            console.log(`  Matches: ${matches.length}`);
            
            const live = matches.filter(m => m.status === 'in');
            const scheduled = matches.filter(m => m.status === 'pre' || m.status === 'Scheduled');
            const post = matches.filter(m => m.status === 'post' || m.status === 'Post');
            
            if (live.length > 0) {
                console.log(`  LIVE (${live.length}):`);
                for (const m of live) {
                    console.log(`    ${m.id}: ${m.homeName} ${m.homeScore} x ${m.awayScore} ${m.awayName} [${m.clock}]`);
                    if (m.lastPlay) {
                        console.log(`    LastPlay: ${m.lastPlay}`);
                    }
                }
            }
            
            if (scheduled.length > 0) {
                console.log(`  Scheduled: ${scheduled.length}`);
            }
            
            if (post.length > 0) {
                console.log(`  Finished: ${post.length}`);
            }
            
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
        console.log();
    }
    
    console.log('=== Cache Stats ===');
    console.log(headerCacheStats());
}

async function testSpecificMatch() {
    console.log('\n=== Testing specific match ID ===\n');
    
    const testCases = [
        { league: 'bra.1', id: '401841003' },
    ];
    
    for (const { league, id } of testCases) {
        console.log(`Fetching ${league}/${id}...`);
        const status = await getMatchStatus(league, id);
        console.log(JSON.stringify(status, null, 2));
    }
}

async function main() {
    await testAllLeagues();
    await testSpecificMatch();
}

main().catch(console.error);
