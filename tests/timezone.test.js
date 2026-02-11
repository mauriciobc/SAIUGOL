import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');

/** Token dummy para o subprocess passar na validação do config. */
const FAKE_TOKEN = '01234567890123456789';

/**
 * Roda o script de fixture com env controlado e retorna a saída JSON (timezone + dateStr).
 */
function runFixtureWithEnv(envOverrides) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [join(__dirname, 'fixtures', 'print-config-timezone.js')],
            {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    MASTODON_ACCESS_TOKEN: process.env.MASTODON_ACCESS_TOKEN || FAKE_TOKEN,
                    ...envOverrides,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
        child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Fixture exited ${code}. stderr: ${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                reject(new Error(`Fixture stdout not JSON: ${stdout}. ${e.message}`));
            }
        });
    });
}

describe('timezone from .env', () => {
    it('usa TIMEZONE quando definido com IANA válido', async () => {
        const out = await runFixtureWithEnv({ TIMEZONE: 'America/Sao_Paulo', TZ: '' });
        assert.strictEqual(out.timezone, 'America/Sao_Paulo');
        assert.match(out.dateStr, /^\d{8}$/, 'dateStr deve ser YYYYMMDD');
    });

    it('usa TZ quando TIMEZONE não está definido', async () => {
        const out = await runFixtureWithEnv({
            TIMEZONE: '',
            TZ: 'Europe/London',
        });
        assert.strictEqual(out.timezone, 'Europe/London');
        assert.match(out.dateStr, /^\d{8}$/, 'dateStr deve ser YYYYMMDD');
    });

    it('TIMEZONE tem precedência sobre TZ', async () => {
        const out = await runFixtureWithEnv({
            TIMEZONE: 'America/New_York',
            TZ: 'Europe/London',
        });
        assert.strictEqual(out.timezone, 'America/New_York');
    });

    it('retorna UTC quando timezone é inválido', async () => {
        const out = await runFixtureWithEnv({ TIMEZONE: 'Invalid/Zone', TZ: '' });
        assert.strictEqual(out.timezone, 'UTC');
        assert.match(out.dateStr, /^\d{8}$/, 'dateStr deve ser YYYYMMDD');
    });

    it('retorna UTC quando TIMEZONE e TZ não estão definidos', async () => {
        const out = await runFixtureWithEnv({
            TIMEZONE: '',
            TZ: '',
        });
        assert.strictEqual(out.timezone, 'UTC');
        assert.match(out.dateStr, /^\d{8}$/, 'dateStr deve ser YYYYMMDD');
    });
});
