import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

describe('phase8 — hygiene and docs', () => {
    it('src/ must not contain ad-hoc test-*.js scripts (moved to scripts/)', () => {
        const srcFiles = readdirSync(join(root, 'src'));
        const stray = srcFiles.filter((f) => /^test-.*\.js$/.test(f));
        assert.deepStrictEqual(stray, [], `unexpected src test scripts: ${stray.join(', ')}`);
    });

    it('manual helper scripts live under scripts/ with npm entry points', () => {
        for (const rel of [
            'scripts/test-post.js',
            'scripts/test-translation.js',
            'scripts/test-multi-league.js',
            'scripts/test-config-hashtags.js',
            'scripts/find-matches.js',
            'scripts/check-all-leagues.js',
        ]) {
            assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
        }

        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        assert.strictEqual(pkg.scripts['test:post'], 'node scripts/test-post.js');
        assert.ok(pkg.scripts['check:leagues'], 'package.json should expose check:leagues');
        assert.ok(pkg.scripts['find:matches'], 'package.json should expose find:matches');
    });

    it('repository-instructions.md documents lazy config, pendingDelayStarts, and stopMonitoring', () => {
        const docs = readFileSync(join(root, 'repository-instructions.md'), 'utf8');
        assert.ok(docs.includes('getConfig'), 'docs should mention getConfig / lazy config');
        assert.ok(docs.includes('pendingDelayStarts'), 'docs should mention pendingDelayStarts persistence');
        assert.ok(docs.includes('stopMonitoring'), 'docs should mention stopMonitoring');
        assert.ok(docs.includes('eventTextParsers') || docs.includes('domain/'), 'docs should mention domain parsers');
        assert.ok(docs.includes('confirmationLifecycle') || docs.includes('decideConfirmationStep'), 'docs should mention confirmation FSM');
        assert.ok(/version.*1\.2|1\.2/.test(docs), 'docs should mention state schema 1.2');
        assert.ok(docs.includes('score_changed'), 'docs should keep score_changed as intentional unused action');
    });

    it('src/ production tree only keeps runtime entry modules at top level', () => {
        const topLevelJs = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js'));
        const allowed = new Set(['index.js', 'config.js']);
        for (const f of topLevelJs) {
            assert.ok(allowed.has(f), `unexpected top-level src module: ${f} (move helpers to scripts/)`);
        }
    });
});
