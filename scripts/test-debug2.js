#!/usr/bin/env node

import axios from 'axios';

const SCOREBOARD_HEADER = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';

async function debug() {
    const league = 'bra.1';
    
    const url = `${SCOREBOARD_HEADER}?sport=soccer&league=${league}&region=br&lang=pt&contentorigin=deportes&configuration=STREAM_MENU&platform=web&features=sfb-all,cutl`;
    
    const resp = await axios.get(url);
    const data = resp.data;
    
    const soccer = data.sports.find(s => s.name === 'Futebol');
    const leagueData = soccer.leagues[0];
    
    console.log('League data keys:', Object.keys(leagueData));
    console.log('Events count:', leagueData.events?.length);
    
    if (leagueData.events?.length > 0) {
        const evt = leagueData.events[0];
        console.log('\nFirst event FULL:');
        console.log(JSON.stringify(evt, null, 2).slice(0, 2000));
    }
}

debug().catch(console.error);
