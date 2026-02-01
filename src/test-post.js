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

    // Send test post
    console.log('\n📝 Enviando post de teste...');

    const testText = `🧪 Teste do bot SAIUGOL

Este é um post de teste para verificar que o bot está funcionando corretamente.

${config.hashtags.join(' ')}`;

    const result = await postStatus(testText);

    if (result) {
        console.log('\n✅ Post enviado com sucesso!');
        console.log(`🔗 ID: ${result.id}`);
    } else {
        console.error('\n❌ Falha ao enviar post');
    }
}

testPost().catch(console.error);
