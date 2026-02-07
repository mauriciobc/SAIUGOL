import 'dotenv/config';
import { config } from './config.js';
import { postStatus, verifyCredentials } from './api/mastodon.js';

/**
 * Test script to verify Mastodon posting works
 */
async function testPost() {
    console.log('🧪 Teste de postagem no Mastodon\n');

    if (!config.mastodon.accessToken) {
        console.error('❌ MASTODON_ACCESS_TOKEN não configurado');
        process.exit(1);
    }

    // Verify credentials first
    console.log('📡 Verificando credenciais...');
    const ok = await verifyCredentials();
    if (!ok) {
        console.error('❌ Falha na autenticação');
        process.exit(1);
    }

    // Send test post for each active league
    for (const league of config.activeLeagues) {
        console.log(`\n📝 Enviando post de teste para ${league.name}...`);

        const testText = `🧪 Teste do bot SAIUGOL
Liga: ${league.name}

Este é um post de teste para verificar que o bot está funcionando corretamente.

${league.hashtags.join(' ')}`;

        const result = await postStatus(testText);

        if (result) {
            console.log(`\n✅ Post enviado com sucesso para ${league.name}!`);
            console.log(`🔗 ID: ${result.id}`);
        } else {
            console.error(`\n❌ Falha ao enviar post para ${league.name}`);
        }

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

testPost().catch(console.error);
