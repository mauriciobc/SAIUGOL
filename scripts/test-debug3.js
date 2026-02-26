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
    
    const evt = leagueData.events[0];
    
    console.log('Event keys:', Object.keys(evt));
    
    const fields = ['id', 'status', 'summary', 'period', 'clock', 'competitors', 'teams', 'homeTeam', 'awayTeam'];
    
    for (const f of fields) {
        console.log(`\n${f}:`, evt[f]);
    }
}

debug().catch(console.error);
