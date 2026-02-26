#!/usr/bin/env node

import axios from 'axios';

const SCOREBOARD_HEADER = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';

async function debug() {
    const league = 'bra.1';
    
    const url = `${SCOREBOARD_HEADER}?sport=soccer&league=${league}&region=br&lang=pt&contentorigin=deportes&configuration=STREAM_MENU&platform=web&features=sfb-all,cutl`;
    console.log('URL:', url);
    
    const resp = await axios.get(url);
    const data = resp.data;
    
    console.log('\nTop-level keys:', Object.keys(data));
    
    if (data.sports) {
        console.log('\nSports:', data.sports.map(s => s.name));
        
        const soccer = data.sports.find(s => s.name === 'soccer');
        if (soccer) {
            console.log('\nSoccer keys:', Object.keys(soccer));
            console.log('Leagues in soccer:', soccer.leagues?.length);
            
            if (soccer.leagues) {
                for (const l of soccer.leagues) {
                    console.log(`\nLeague: ${l.name} (${l.abbreviation})`);
                    console.log('  Keys:', Object.keys(l));
                    console.log('  Events:', l.events?.length);
                    if (l.events?.length > 0) {
                        console.log('  First event:', JSON.stringify(l.events[0], null, 2).slice(0, 500));
                    }
                }
            }
        }
    }
}

debug().catch(console.error);
