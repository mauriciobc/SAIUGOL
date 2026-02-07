import { config } from './config.js';

console.log('--- Config Verification ---');
console.log(`League Code: ${process.env.LEAGUE_CODE || 'Default (bra.1)'}`);
console.log(`League Name: ${config.bot.leagueName}`);
console.log(`Country Code: ${config.bot.countryCode}`);
console.log(`Hashtags: ${JSON.stringify(config.hashtags)}`);

if (!config.hashtags || config.hashtags.length === 0) {
    console.error('FAILED: No hashtags found!');
    process.exit(1);
}

console.log('--- Verification Successful ---');
