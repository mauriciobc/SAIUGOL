import 'dotenv/config';
import { config } from './config.js';
import { verifyCredentials } from './api/mastodon.js';
import { initialize, startMonitoring } from './bot/matchMonitor.js';

/**
 * Main entry point for the SAIUGOL bot
 */
async function main() {
    console.log('='.repeat(50));
    console.log('⚽ SAIUGOL - Bot de Brasileirão para Mastodon');
    console.log('='.repeat(50));

    // Check configuration
    if (!config.mastodon.accessToken) {
        console.error('❌ MASTODON_ACCESS_TOKEN não configurado');
        process.exit(1);
    }


    if (config.bot.dryRun) {
        console.log('🔧 Modo DRY RUN ativado - nenhum post será enviado');
    }

    // Verify Mastodon credentials
    console.log('\n📡 Verificando credenciais do Mastodon...');
    const credentialsOk = await verifyCredentials();
    if (!credentialsOk && !config.bot.dryRun) {
        console.error('❌ Falha na autenticação do Mastodon');
        process.exit(1);
    }

    // Initialize match monitor
    console.log('\n🔍 Inicializando monitor de partidas...');
    const initOk = await initialize();
    if (!initOk) {
        console.error('❌ Falha ao inicializar o monitor');
        process.exit(1);
    }

    // Start monitoring
    console.log('\n✅ Bot iniciado com sucesso!');
    console.log(`📊 Intervalo de polling: ${config.bot.pollIntervalMs}ms`);
    console.log(`🏆 Liga: ${config.bot.leagueName} (${config.bot.countryCode})`);
    console.log('-'.repeat(50));

    await startMonitoring();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Encerrando bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Encerrando bot...');
    process.exit(0);
});

// Run
main().catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
