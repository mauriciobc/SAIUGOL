import 'dotenv/config';
import { config } from './config.js';
import { verifyCredentials } from './api/mastodon.js';
import { initialize, startMonitoring } from './bot/matchMonitor.js';
import { shutdown as shutdownState } from './state/matchState.js';
import { logger, botLogger } from './utils/logger.js';
import { initI18n } from './services/i18n.js';

/**
 * Main entry point for the SAIUGOL bot
 */
async function main() {
    logger.info('Iniciando SAIUGOL Bot');

    // Initialize translation system
    initI18n(config.i18n.defaultLanguage);
    logger.info({ language: config.i18n.defaultLanguage }, 'Sistema de tradução inicializado');

    // Check configuration
    if (!config.mastodon.accessToken) {
        logger.error('MASTODON_ACCESS_TOKEN não configurado');
        process.exit(1);
    }


    if (config.bot.dryRun) {
        botLogger.info('Modo DRY RUN ativado - nenhum post será enviado');
    }

    // Verify Mastodon credentials
    botLogger.info('Verificando credenciais do Mastodon...');
    const credentialsOk = await verifyCredentials();
    if (!credentialsOk && !config.bot.dryRun) {
        logger.error('Falha na autenticação do Mastodon');
        process.exit(1);
    }

    // Initialize match monitor
    botLogger.info('Inicializando monitor de partidas...');
    const initOk = await initialize();
    if (!initOk) {
        logger.error('Falha ao inicializar o monitor');
        process.exit(1);
    }

    // Start monitoring
    botLogger.info({
        pollIntervalMs: config.bot.pollIntervalMs,
        pollIntervalMs: config.bot.pollIntervalMs,
        leagues: config.activeLeagues.map(l => l.name),
    }, 'Bot iniciado com sucesso');

    await startMonitoring();
}

// Handle graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        botLogger.warn({ signal }, 'Shutdown já em progresso, ignorando');
        return;
    }

    isShuttingDown = true;
    botLogger.info({ signal }, 'Recebido sinal de shutdown, encerrando bot...');
    try {
        await shutdownState();
        botLogger.info('Estado salvo com sucesso');
    } catch (error) {
        logger.error({ error: error.message }, 'Erro ao salvar estado');
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Run
main().catch((error) => {
    logger.error({ error: error.message }, 'Erro fatal');
    process.exit(1);
});
