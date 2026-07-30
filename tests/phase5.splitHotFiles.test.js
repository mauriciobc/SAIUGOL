import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { categorizeEvent } from '../src/bot/eventCategorization.js';
import { categorizeEvent as fromProcessor } from '../src/bot/eventProcessor.js';
import { formatGoal, formatMatchStart, formatMatchStats } from '../src/bot/formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function lineCount(rel) {
    return readFileSync(join(root, rel), 'utf8').split('\n').length;
}

describe('phase5 — split hot files', () => {
    it('formatter.js is a thin barrel under 80 lines', () => {
        assert.ok(lineCount('src/bot/formatter.js') < 80, 'formatter.js should be a barrel');
    });

    it('formatter domain modules each stay under 350 lines', () => {
        for (const rel of [
            'src/bot/formatters/formatHelpers.js',
            'src/bot/formatters/scoringFormatters.js',
            'src/bot/formatters/cardFormatters.js',
            'src/bot/formatters/matchPhaseFormatters.js',
            'src/bot/formatters/digestFormatters.js',
        ]) {
            const n = lineCount(rel);
            assert.ok(n < 350, `${rel} has ${n} lines`);
            assert.ok(statSync(join(root, rel)).isFile());
        }
    });

    it('barrel still exports scoring / phase / digest formatters', () => {
        assert.strictEqual(typeof formatGoal, 'function');
        assert.strictEqual(typeof formatMatchStart, 'function');
        assert.strictEqual(typeof formatMatchStats, 'function');
    });

    it('categorizeEvent lives in eventCategorization and is re-exported by eventProcessor', () => {
        assert.strictEqual(fromProcessor, categorizeEvent);
        assert.strictEqual(categorizeEvent('Goal', '70'), 'GOAL');
        assert.strictEqual(categorizeEvent('Yellow Card', '94'), 'YELLOW_CARD');
    });

    it('eventProcessor.js must not redefine ID_TO_CATEGORY locally', () => {
        const src = readFileSync(join(root, 'src/bot/eventProcessor.js'), 'utf8');
        assert.ok(
            src.includes('eventCategorization'),
            'eventProcessor should import from eventCategorization'
        );
        assert.ok(
            !/const ID_TO_CATEGORY\s*=/.test(src),
            'ID_TO_CATEGORY should live only in eventCategorization.js'
        );
    });
});
