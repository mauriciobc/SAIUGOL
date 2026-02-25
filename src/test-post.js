import 'dotenv/config';
import { config } from './config.js';
import { postStatus, verifyCredentials, uploadMediaFromUrl } from './api/mastodon.js';

/**
 * Test script to verify Mastodon posting works with video URL (downloading via curl and uploading natively)
 */
async function testVideoUpload() {
    console.log('🧪 Teste de upload de vídeo no Mastodon (usando curl)\n');

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

    // Test with ESPN video URL
    const videoUrl = 'https://media.video-origin.espn.com/espnvideo/2026/0219/Hu_260219_BR_FUTEBOL_BRASILEIRAO_ATHLETICO_X_CORINTHIANS_PENALTI_HIGHLIGHT/Hu_260219_BR_FUTEBOL_BRASILEIRAO_ATHLETICO_X_CORINTHIANS_PENALTI_HIGHLIGHT.mp4';
    
    console.log('📝 Tentando fazer upload da mídia (via curl)...');
    console.log(`   URL: ${videoUrl}\n`);
    
    let mediaId = await uploadMediaFromUrl(videoUrl, { type: 'video', description: 'Gol de Pênalti - Athletico x Corinthians' });

    let mediaIds = [];
    if (mediaId) {
        mediaIds.push(mediaId);
    } else {
        console.log('⚠️ Falha ao fazer upload da mídia (vídeo muito grande ou erro), testando fallback para thumbnail...');
        const thumbUrl = 'https://a.espncdn.com/media/motion/2026/0219/Hu_260219_BR_FUTEBOL_BRASILEIRAO_ATHLETICO_X_CORINTHIANS_PENALTI_HIGHLIGHT/Hu_260219_BR_FUTEBOL_BRASILEIRAO_ATHLETICO_X_CORINTHIANS_PENALTI_HIGHLIGHT.jpg';
        mediaId = await uploadMediaFromUrl(thumbUrl, { type: 'image', description: 'Thumbnail do Gol' });
        if (mediaId) {
            mediaIds.push(mediaId);
        } else {
            console.error('\n❌ Falha ao fazer upload da thumbnail também');
            process.exit(1);
        }
    }

    console.log(`\n✅ Mídia processada! Media IDs: ${mediaIds.join(',')}`);
    
    const testText = `🧪 Teste de vídeo (com fallback) no SAIUGOL\n\nEste teste avalia o fallback automático para imagem se o vídeo for muito grande!\n\nLink Original: ${videoUrl}\n\n#Brasileirão #Futebol`;
    console.log('📝 Enviando post...');

    const result = await postStatus(testText, { mediaIds });

    if (result) {
        console.log('\n✅ Post enviado com sucesso com o vídeo anexo!');
        console.log(`🔗 ID do Post: ${result.id}`);
        console.log(`🔗 URL: ${result.url || 'Não disponível'}`);
    } else {
        console.error('\n❌ Falha ao enviar post');
    }
}

testVideoUpload().catch(console.error);
