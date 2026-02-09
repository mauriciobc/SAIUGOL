#!/usr/bin/env node
/**
 * Repost all toots from a specific game for comparison (e.g. after fixes).
 *
 * Fetches your recent Mastodon statuses, filters those that mention both
 * team names (e.g. Atalanta and Cremonese), and reposts them with an
 * optional prefix so you can compare with the originals.
 *
 * Usage:
 *   node scripts/repost-game-toots.js [options]
 *
 * Options:
 *   --team1 "Name"   First team name (default: Atalanta)
 *   --team2 "Name"   Second team name (default: Cremonese)
 *   --prefix "text"  Prepend this to each repost (default: "🔄 Republicação para comparação:\n\n")
 *   --dry-run        Fetch and list only, do not post
 *   --limit N        Max statuses to fetch (default: 80)
 */

import 'dotenv/config';
import { getAccountId, getAccountStatuses, postStatus } from '../src/api/mastodon.js';
import { config } from '../src/config.js';

const DELAY_MS = 3000;

function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
}

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        team1: 'Atalanta',
        team2: 'Cremonese',
        prefix: '🔄 Republicação para comparação:\n\n',
        dryRun: false,
        limit: 80,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--team1' && args[i + 1]) {
            out.team1 = args[++i];
        } else if (args[i] === '--team2' && args[i + 1]) {
            out.team2 = args[++i];
        } else if (args[i] === '--prefix' && args[i + 1]) {
            out.prefix = args[++i];
        } else if (args[i] === '--dry-run') {
            out.dryRun = true;
        } else if (args[i] === '--limit' && args[i + 1]) {
            out.limit = parseInt(args[++i], 10) || 80;
        }
    }
    return out;
}

async function fetchAllStatuses(accountId, limit) {
    const all = [];
    let maxId = undefined;
    const pageSize = 40;
    while (all.length < limit) {
        const page = await getAccountStatuses(accountId, {
            limit: pageSize,
            max_id: maxId,
        });
        if (page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
        maxId = page[page.length - 1].id;
    }
    return all.slice(0, limit);
}

async function main() {
    const opts = parseArgs();
    console.log('Config:', opts);
    console.log('');

    const accountId = await getAccountId();
    if (!accountId) {
        console.error('Could not get account id. Check Mastodon credentials.');
        process.exit(1);
    }

    console.log('Fetching your recent statuses...');
    const statuses = await fetchAllStatuses(accountId, opts.limit);
    console.log(`Fetched ${statuses.length} statuses.\n`);

    const t1 = opts.team1.toLowerCase();
    const t2 = opts.team2.toLowerCase();
    const matching = statuses.filter((s) => {
        const text = stripHtml(s.content).toLowerCase();
        return text.includes(t1) && text.includes(t2);
    });

    // Oldest first (ascending id = chronological); BigInt for correct 64-bit Snowflake order
    matching.sort((a, b) => {
      const idA = BigInt(a.id);
      const idB = BigInt(b.id);
      if (idA < idB) return -1;
      if (idA > idB) return 1;
      return 0;
    });

    console.log(`Found ${matching.length} toots mentioning "${opts.team1}" and "${opts.team2}".\n`);
    if (matching.length === 0) {
        console.log('Nothing to repost.');
        return;
    }

    if (opts.dryRun) {
        console.log('--- DRY RUN: would repost the following ---');
        matching.forEach((s, i) => {
            const text = stripHtml(s.content);
            console.log(`\n[${i + 1}] id=${s.id}`);
            console.log(text.substring(0, 120) + (text.length > 120 ? '...' : ''));
        });
        console.log('\nRun without --dry-run to post.');
        return;
    }

    console.log('Reposting (oldest first)...');
    for (let i = 0; i < matching.length; i++) {
        const s = matching[i];
        const plain = stripHtml(s.content);
        const toPost = opts.prefix + plain;
        const result = await postStatus(toPost);
        if (result) {
            console.log(`  [${i + 1}/${matching.length}] Reposted (new id: ${result.id})`);
        } else {
            console.log(`  [${i + 1}/${matching.length}] Failed to post (original id: ${s.id})`);
        }
        if (i < matching.length - 1) {
            await new Promise((r) => setTimeout(r, config.delays.betweenPosts || DELAY_MS));
        }
    }
    console.log('\nDone.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
