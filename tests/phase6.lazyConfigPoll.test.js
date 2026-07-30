import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');
const FAKE_TOKEN = '01234567890123456789';

function runNode(code, env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
            cwd: projectRoot,
            env: { ...process.env, NODE_ENV: 'test', ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c));
        child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

describe('phase6 — lazy config', () => {
    it('importing config.js must not throw when MASTODON_ACCESS_TOKEN is missing', async () => {
        const { code, stdout, stderr } = await runNode(
            `import './src/config.js'; console.log('imported-ok');`,
            { MASTODON_ACCESS_TOKEN: '', MASTODON_ACCESS_TOKEN_FILE: '', PATH: process.env.PATH }
        );
        assert.strictEqual(code, 0, `stderr: ${stderr}`);
        assert.strictEqual(stdout.trim(), 'imported-ok');
        assert.ok(!/Configuration validation failed/.test(stderr));
    });

    it('getConfig() validates and throws without token on first access', async () => {
        const { code, stdout, stderr } = await runNode(
            `
            import { getConfig } from './src/config.js';
            try { getConfig(); console.log('unexpected-success'); }
            catch (e) { console.log(e.message.includes('MASTODON_ACCESS_TOKEN') ? 'threw-ok' : 'wrong:' + e.message); }
            `,
            { MASTODON_ACCESS_TOKEN: '', MASTODON_ACCESS_TOKEN_FILE: '', PATH: process.env.PATH }
        );
        assert.strictEqual(code, 0, `stderr: ${stderr}`);
        assert.strictEqual(stdout.trim(), 'threw-ok');
    });

    it('getConfig() returns config when token is present', async () => {
        const { code, stdout, stderr } = await runNode(
            `
            import { getConfig } from './src/config.js';
            const c = getConfig();
            console.log(JSON.stringify({ hasToken: Boolean(c.mastodon.accessToken), live: c.bot.pollIntervalLiveMs }));
            `,
            { MASTODON_ACCESS_TOKEN: FAKE_TOKEN, PATH: process.env.PATH }
        );
        assert.strictEqual(code, 0, `stderr: ${stderr}`);
        const out = JSON.parse(stdout.trim());
        assert.strictEqual(out.hasToken, true);
        assert.ok(out.live >= 10000);
    });

    it('config proxy still supports nested mutation used by tests', async () => {
        const { code, stdout, stderr } = await runNode(
            `
            import { config, getConfig, __resetConfigForTesting } from './src/config.js';
            __resetConfigForTesting();
            const before = config.delays.betweenPosts;
            config.delays.betweenPosts = 0;
            console.log(JSON.stringify({ before, after: config.delays.betweenPosts, same: getConfig().delays.betweenPosts === 0 }));
            `,
            { MASTODON_ACCESS_TOKEN: FAKE_TOKEN, PATH: process.env.PATH }
        );
        assert.strictEqual(code, 0, `stderr: ${stderr}`);
        const out = JSON.parse(stdout.trim());
        assert.strictEqual(out.after, 0);
        assert.strictEqual(out.same, true);
        assert.ok(out.before !== 0);
    });

    it('config.js exports getConfig and does not call validateConfig at top level', () => {
        const src = readFileSync(join(projectRoot, 'src/config.js'), 'utf8');
        assert.ok(/export\s+function\s+getConfig\s*\(/.test(src));
        const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.strictEqual(
            withoutComments.match(/^validateConfig\(\);/m),
            null,
            'validateConfig() must not run at module top level'
        );
    });
});

describe('phase6 — elastic poll stopMonitoring', () => {
    it('matchMonitor exports stopMonitoring', async () => {
        const mod = await import('../src/bot/matchMonitor.js');
        assert.strictEqual(typeof mod.stopMonitoring, 'function');
    });

    it('index.js gracefulShutdown stops monitoring before saving state', () => {
        const src = readFileSync(join(projectRoot, 'src/index.js'), 'utf8');
        assert.ok(src.includes('stopMonitoring'), 'index should import/call stopMonitoring on shutdown');
        const shutdownIdx = src.indexOf('async function gracefulShutdown');
        const stopIdx = src.indexOf('stopMonitoring', shutdownIdx);
        const saveIdx = src.indexOf('shutdownState', shutdownIdx);
        assert.ok(stopIdx > 0 && saveIdx > 0 && stopIdx < saveIdx, 'stopMonitoring before shutdownState');
    });
});
