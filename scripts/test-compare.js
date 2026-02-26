#!/usr/bin/env node

import axios from 'axios';

const SCOREBOARD_HEADER = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';
const SCOREBOARD_API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

async function compare() {
    const league = 'bra.1';
    
    console.log('=== Comparing Scoreboard Header vs Scoreboard API ===\n');
    
    const url1 = `${SCOREBOARD_HEADER}?sport=soccer&league=${league}&region=br&lang=pt&contentorigin=deportes`;
    console.log('Header URL:', url1);
    
    const resp1 = await axios.get(url1);
    const headerData = resp1.data;
    
    console.log('Header response keys:', Object.keys(headerData));
    console.log('Header leagues:', headerData.leagues?.length);
    
    if (headerData.leagues?.[0]) {
        console.log('League 0 keys:', Object.keys(headerData.leagues[0]));
        console.log('League 0 events count:', headerData.leagues[0].events?.length);
    }
    
    const url2 = `${SCOREBOARD_API}/${league}/scoreboard`;
    console.log('\nScoreboard URL:', url2);
    
    const resp2 = await axios.get(url2);
    const scoreboardData = resp2.data;
    
    console.log('Scoreboard response keys:', Object.keys(scoreboardData));
    console.log('Scoreboard events count:', scoreboardData.events?.length);
    
    if (scoreboardData.events?.length > 0) {
        console.log('\nFirst event from scoreboard:');
        console.log(JSON.stringify(scoreboardData.events[0], null, 2).slice(0, 1000));
    }
    
    console.log('\n=== Summary ===');
    console.log(`Header events: ${headerData.leagues?.[0]?.events?.length || 0}`);
    console.log(`Scoreboard events: ${scoreboardData.events?.length || 0}`);
}

compare().catch(console.error);
