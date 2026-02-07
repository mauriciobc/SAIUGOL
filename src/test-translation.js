import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initI18n } from './services/i18n.js';
import { getLiveEvents, getMatchDetails } from './api/espn.js';
import {
    formatGoal,
    formatCard,
    formatSubstitution,
    formatVAR,
    formatMatchStart,
    formatMatchEnd,
} from './bot/formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test script to fetch a real match and test translations
 * Saves formatted output to translation-test.txt
 */
async function testTranslations() {
    console.log('🔧 Initializing translation system...');
    initI18n(config.i18n.defaultLanguage);
    console.log(`✅ Language: ${config.i18n.defaultLanguage}\n`);

    // Use a known completed Brasileirão match ID from 2024 season
    // You can find match IDs by checking ESPN's scoreboard page
    const matchId = '704797'; // Brasileirão 2024 match

    console.log(`📥 Fetching match details for ID: ${matchId}...`);

    const match = await getMatchDetails(matchId, 'bra.1');

    if (!match) {
        console.error('❌ Failed to fetch match details');
        console.log('\n💡 Try updating the matchId in this script with a valid Brasileirão match.');
        console.log('   Visit: https://www.espn.com.br/futebol/resultados/_/liga/bra.1');
        console.log('   Click on a match and get the ID from the URL');
        return;
    }

    console.log('✅ Match details fetched\n');
    console.log(`🏟️  ${match.homeTeam.name} ${match.homeScore} x ${match.awayScore} ${match.awayTeam.name}`);
    console.log(`📍 ${match.venue || 'Venue not available'}\n`);

    console.log('📥 Fetching match events...');
    const events = await getLiveEvents(matchId, 'bra.1');
    console.log(`✅ Found ${events.length} events\n`);

    // Create output
    const output = [];
    output.push('='.repeat(80));
    output.push('SAIUGOL BOT - TRANSLATION TEST RESULTS');
    output.push(`Language: ${config.i18n.defaultLanguage}`);
    output.push(`Match ID: ${matchId}`);
    output.push(`Generated: ${new Date().toLocaleString('pt-BR')}`);
    output.push('='.repeat(80));
    output.push('');

    // Match Start
    output.push('--- MATCH START ---');
    output.push(formatMatchStart(match));
    output.push('');
    output.push('');

    // Process events
    let goalCount = 0;
    let cardCount = 0;
    let subCount = 0;
    let varCount = 0;

    for (const event of events) {
        const type = event.type?.toLowerCase() || '';

        // Create mock event objects for formatting
        if (type.includes('goal') || type.includes('penalty')) {
            goalCount++;
            const mockEvent = {
                player: { name: event.player || 'Jogador' },
                minute: event.minute,
                type: event.type,
                team: { name: match.homeTeam.name } // Simplified - would need to determine from event
            };

            output.push(`--- GOAL #${goalCount} ---`);
            output.push(formatGoal(mockEvent, match));
            output.push('');
            output.push('');
        } else if (type.includes('card')) {
            cardCount++;
            const mockEvent = {
                player: { name: event.player || 'Jogador' },
                minute: event.minute,
                type: event.type
            };

            output.push(`--- CARD #${cardCount} ---`);
            output.push(formatCard(mockEvent, match));
            output.push('');
            output.push('');
        } else if (type.includes('substitution')) {
            subCount++;

            // Parse substitution from description
            // ESPN format: "Substitution, Team Name. Player In replaces Player Out."
            // or: "Substitution, Team. Player In on for Player Out."
            let playerIn = 'Jogador';
            let playerOut = 'Jogador';

            const desc = event.description || '';

            // Try to match different ESPN substitution patterns
            // Pattern 1: "Player In replaces Player Out"
            let match1 = desc.match(/([A-Z][^,.]+?) replaces ([A-Z][^,.]+?)\./);
            if (match1) {
                playerIn = match1[1].trim();
                playerOut = match1[2].trim();
            } else {
                // Pattern 2: "Player In on for Player Out"
                let match2 = desc.match(/([A-Z][^,.]+?) on for ([A-Z][^,.]+?)\./);
                if (match2) {
                    playerIn = match2[1].trim();
                    playerOut = match2[2].trim();
                } else {
                    // Fallback: use the player field if available
                    if (event.player) {
                        playerIn = event.player;
                    }
                }
            }

            const mockEvent = {
                playerIn: { name: playerIn },
                playerOut: { name: playerOut },
                minute: event.minute
            };

            output.push(`--- SUBSTITUTION #${subCount} ---`);
            output.push(`Raw: ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`);
            output.push(formatSubstitution(mockEvent, match));
            output.push('');
            output.push('');
        } else if (type.includes('var')) {
            varCount++;
            const mockEvent = {
                minute: event.minute,
                decision: event.description
            };

            output.push(`--- VAR #${varCount} ---`);
            output.push(formatVAR(mockEvent, match));
            output.push('');
            output.push('');
        }
    }

    // Match End
    output.push('--- MATCH END ---');
    output.push(formatMatchEnd(match));
    output.push('');
    output.push('');

    // Summary
    output.push('='.repeat(80));
    output.push('EVENT SUMMARY');
    output.push('='.repeat(80));
    output.push(`Goals:        ${goalCount}`);
    output.push(`Cards:        ${cardCount}`);
    output.push(`Substitutions: ${subCount}`);
    output.push(`VAR Reviews:   ${varCount}`);
    output.push(`Total Events:  ${events.length}`);
    output.push('='.repeat(80));

    // Save to file
    const outputPath = path.join(__dirname, '..', 'translation-test.txt');
    fs.writeFileSync(outputPath, output.join('\n'), 'utf8');

    console.log('📊 Event Summary:');
    console.log(`   Goals:        ${goalCount}`);
    console.log(`   Cards:        ${cardCount}`);
    console.log(`   Substitutions: ${subCount}`);
    console.log(`   VAR Reviews:   ${varCount}`);
    console.log(`   Total Events:  ${events.length}`);
    console.log('');
    console.log(`✅ Translation test complete!`);
    console.log(`📄 Output saved to: ${outputPath}`);
    console.log('');
    console.log('Sample output:');
    console.log('-'.repeat(80));
    // Show first few lines
    const sampleLines = output.slice(0, 30);
    console.log(sampleLines.join('\n'));
    if (output.length > 30) {
        console.log('...');
        console.log(`(${output.length - 30} more lines in file)`);
    }
}

// Run the test
testTranslations().catch((error) => {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
