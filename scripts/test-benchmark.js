#!/usr/bin/env node

import axios from 'axios';
import { getAllMatchStatuses, headerCacheStats, clearCache } from '../src/api/fastcast.js';

const SCOREBOARD_API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

async function benchmark(league = 'bra.1', iterations = 3) {
    console.log('=== API Benchmark: Header vs Scoreboard ===\n');
    console.log(`League: ${league}, Iterations: ${iterations}\n`);
    
    const results = {
        header: { times: [], sizes: [] },
        scoreboard: { times: [], sizes: [] },
    };
    
    for (let i = 0; i < iterations; i++) {
        clearCache();
        
        const start1 = Date.now();
        const resp1 = await axios.get(`https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=soccer&league=${league}&region=br&lang=pt&contentorigin=deportes&configuration=STREAM_MENU&platform=web&features=sfb-all,cutl`);
        const time1 = Date.now() - start1;
        results.header.times.push(time1);
        results.header.sizes.push(JSON.stringify(resp1.data).length);
        
        const start2 = Date.now();
        const resp2 = await axios.get(`${SCOREBOARD_API}/${league}/scoreboard`);
        const time2 = Date.now() - start2;
        results.scoreboard.times.push(time2);
        results.scoreboard.sizes.push(JSON.stringify(resp2.data).length);
        
        console.log(`Iter ${i + 1}:`);
        console.log(`  Header:      ${time1}ms, ${results.header.sizes[i]} bytes`);
        console.log(`  Scoreboard:  ${time2}ms, ${results.scoreboard.sizes[i]} bytes`);
    }
    
    const avgHeaderTime = results.header.times.reduce((a, b) => a + b, 0) / iterations;
    const avgScoreboardTime = results.scoreboard.times.reduce((a, b) => a + b, 0) / iterations;
    const avgHeaderSize = results.header.sizes.reduce((a, b) => a + b, 0) / iterations;
    const avgScoreboardSize = results.scoreboard.sizes.reduce((a, b) => a + b, 0) / iterations;
    
    console.log('\n=== Summary ===');
    console.log(`Header avg:      ${Math.round(avgHeaderTime)}ms, ${Math.round(avgHeaderSize)} bytes`);
    console.log(`Scoreboard avg:  ${Math.round(avgScoreboardTime)}ms, ${Math.round(avgScoreboardSize)} bytes`);
    console.log(`\nSpeed: Header is ${(avgScoreboardTime / avgHeaderTime).toFixed(1)}x faster`);
    console.log(`Size: Header is ${(avgScoreboardSize / avgHeaderSize).toFixed(1)}x smaller`);
}

async function testChangeDetection() {
    console.log('\n=== Testing Change Detection ===\n');
    
    clearCache();
    
    const match = await getAllMatchStatuses('bra.1');
    if (match.length > 0) {
        const m = match[0];
        console.log(`Match: ${m.homeName} x ${m.awayName}`);
        console.log(`Status: ${m.status}, Clock: ${m.clock}`);
        
        const prev = { ...m, clock: '0\'' };
        const changed = m.clock !== prev.clock;
        console.log(`\nPrevious: ${prev.clock}, Current: ${m.clock}`);
        console.log(`Changed: ${changed}`);
    }
    
    console.log('\nCache stats:', headerCacheStats());
}

benchmark('bra.1', 3).then(testChangeDetection).catch(console.error);
