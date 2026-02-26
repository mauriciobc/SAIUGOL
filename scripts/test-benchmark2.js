#!/usr/bin/env node

import axios from 'axios';
import NodeCache from 'node-cache';
import { getAllMatchStatuses, headerCacheStats, clearCache } from '../src/api/fastcast.js';

const SCOREBOARD_API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const scoreboardCache = new NodeCache({ stdTTL: 60 });

async function benchmark() {
    console.log('=== API Benchmark ===\n');
    
    clearCache();
    scoreboardCache.flushAll();
    
    console.log('Cold calls:');
    
    const start1 = Date.now();
    await getAllMatchStatuses('bra.1');
    const time1 = Date.now() - start1;
    
    const start2 = Date.now();
    const resp = await axios.get(`${SCOREBOARD_API}/bra.1/scoreboard`);
    const time2 = Date.now() - start2;
    
    console.log(`  Header API: ${time1}ms`);
    console.log(`  Scoreboard API: ${time2}ms`);
    
    console.log('\nCached calls:');
    
    const c1 = Date.now();
    await getAllMatchStatuses('bra.1');
    const t1 = Date.now() - c1;
    
    const c2 = Date.now();
    scoreboardCache.get('scoreboard:bra.1');
    const t2 = Date.now() - c2;
    
    console.log(`  Header API: ${t1}ms`);
    console.log(`  Scoreboard API: ${t2}ms (cache lookup only)`);
    
    console.log('\nHeader API provides: status, clock, scores, lastPlay (PT)');
    console.log('Scoreboard API provides: full event data');
}

async function main() {
    await benchmark();
}

main().catch(console.error);
