# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests
npm test

# Run a single test file
NODE_ENV=test node --test tests/matchMonitor.test.js

# Start the bot
npm start

# Development mode (auto-restart on file change)
npm run dev

# Test posting without running the bot (requires .env)
npm run test:post
```

## Architecture

SAIUGOL is a Mastodon bot that monitors soccer matches via the ESPN API and posts live updates. It uses ES modules (`"type": "module"`).

### Data flow

1. **`matchMonitor.js`** — main polling loop. On each tick it:
   - Fetches today's matches per league via `espn.js`
   - Normalizes them into `MatchSnapshot` objects via `snapshotContract.js`
   - Calls `diffEngine.js` to compare against cached snapshots → emits `match_start`, `match_end`, or `score_changed` actions
   - For live matches, fetches per-event updates via `getLiveEvents` and delegates to `eventProcessor.js`
   - Reschedules itself with an elastic interval (live: 60s, pre: 2m, hibernation: 30m)

2. **`diffEngine.js`** — pure function, no side effects. Compares new vs previous `MatchSnapshot` maps and emits `DiffAction` objects. No Mastodon or formatter dependency.

3. **`snapshotContract.js`** — single source of truth for ESPN status normalization. Maps raw ESPN status strings/tokens to `'pre' | 'in' | 'post'`. If ESPN changes their status strings, fix it here.

4. **`eventProcessor.js`** — classifies raw ESPN `keyEvents` by `type.id` first (see `ID_TO_CATEGORY` map), falling back to text keyword matching. Calls formatters and posts to Mastodon. Tracks posted event IDs to deduplicate.

5. **`matchState.js`** — in-memory state (active matches, posted event IDs, previous snapshots). Persists to disk on shutdown and every 5 minutes. On restart, restores state to avoid duplicate posts and handle ongoing matches.

6. **`formatter.js`** — builds Mastodon post text. Uses `i18n.js` for Brazilian Portuguese translations.

### Key design constraints

- **Event deduplication**: every posted event is recorded in `postedEventIds` (persisted). Always check `isEventPosted()` before posting and call `markEventPosted()` after.
- **Snapshot composite key**: `"leagueCode:matchId"` (e.g. `"bra.1:12345"`). All `previousSnapshots` and `recoveredActiveKeys` use this key, not bare matchId.
- **ESPN event type IDs are preferred over text**: The `ID_TO_CATEGORY` map in `eventProcessor.js` takes priority. Text keyword fallback only runs when the ID is unrecognized. When adding support for new event types, add to `ID_TO_CATEGORY` first.
- **State is lazy-initialized**: `matchState.js` uses a `whenReady()` promise. Tests must await it or mock persistence.

### Configuration

All config flows through `src/config.js` → `config` object. Environment variables are parsed once at startup. See `.env.example` for all supported variables. The access token can come from `MASTODON_ACCESS_TOKEN`, `MASTODON_ACCESS_TOKEN_FILE`, or a Docker secret at `/run/secrets/mastodon_access_token`.

Supported league codes are defined in `src/data/leagues.js` and set via `LEAGUE_CODES` (comma-separated).

### Testing

Tests use Node's built-in `node --test` runner (no Jest/Mocha). Test files live in `tests/`. The `NODE_ENV=test` flag suppresses the periodic save timer in `matchState.js` to prevent tests from hanging.
