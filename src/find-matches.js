import 'dotenv/config';
import { getTodayMatches } from './api/espn.js';

/**
 * Helper script to find recent Brasileirão match IDs
 */
async function findMatches() {
    console.log('🔍 Searching for recent Brasileirão matches...\n');

    const matches = await getTodayMatches();

    if (matches.length === 0) {
        console.log('❌ No matches found for today.');
        console.log('\n💡 Try checking ESPN directly:');
        console.log('   https://www.espn.com.br/futebol/resultados/_/liga/bra.1\n');
        console.log('Some known past match IDs you can try:');
        console.log('   - 704861 (Brasileirão 2024)');
        console.log('   - 704797 (Brasileirão 2024)');
        console.log('   - 704518 (Example match used in tests)');
        return;
    }

    console.log(`✅ Found ${matches.length} match(es):\n`);

    for (const match of matches) {
        console.log(`Match ID: ${match.id}`);
        console.log(`  ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}`);
        console.log(`  Status: ${match.status} (${match.state})`);
        console.log(`  Venue: ${match.venue || 'N/A'}`);
        console.log('');
    }

    console.log('\n💡 Use one of these Match IDs in test-translation.js');
}

findMatches().catch(console.error);
