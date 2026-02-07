import { leagues } from './data/leagues.js';

console.log('--- Checking All Leagues ---');
let errors = 0;

for (const [code, league] of Object.entries(leagues)) {
    console.log(`Checking ${code}: ${league.name}`);
    if (!league.name) {
        console.error(`  [ERROR] Missing name for ${code}`);
        errors++;
    }
    if (!league.countryCode) {
        console.error(`  [ERROR] Missing countryCode for ${code}`);
        errors++;
    }
    if (!league.hashtags || !Array.isArray(league.hashtags) || league.hashtags.length === 0) {
        console.error(`  [ERROR] Invalid hashtags for ${code}`);
        errors++;
    }
}

if (errors === 0) {
    console.log(`\nSUCCESS: All ${Object.keys(leagues).length} leagues are valid.`);
} else {
    console.error(`\nFAILED: Found ${errors} errors.`);
    process.exit(1);
}
