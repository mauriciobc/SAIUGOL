import { config } from './config.js';

console.log('--- Multi-League Config Verification ---');

const activeLeagues = config.activeLeagues;
console.log(`Active Leagues Count: ${activeLeagues.length}`);

if (activeLeagues.length === 0) {
    console.error('FAILED: No active leagues found!');
    process.exit(1);
}

activeLeagues.forEach(league => {
    console.log(`\nLeague: ${league.name} (${league.code})`);
    console.log(`Country: ${league.countryCode}`);
    console.log(`Hashtags: ${league.hashtags.join(', ')}`);
});

console.log('\n--- Verification Successful ---');
