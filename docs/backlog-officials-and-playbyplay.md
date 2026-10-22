# Backlog: Officials Pre-Match + Play-by-Play Enhanced Events

Status: **Feature 3 + Feature 4 v1 implemented (2026-07-21)**  
Date: 2026-07-21  
Scope: `bra.1` verified; design should work for any league where the endpoints return data.  
Related: ESPN feature research (session 2026-07-21), `API_DOCUMENTATION.md`, `src/api/mastodon.js`, `src/bot/matchMonitor.js`, `src/bot/eventProcessor.js`.

---

## Mastodon API compliance (shared constraints)

Both features must respect the limits already documented in `API_DOCUMENTATION.md` §2 and enforced in `src/api/mastodon.js`.

| Constraint | Limit | Bot behavior today | Requirement for new features |
|------------|-------|--------------------|------------------------------|
| Status length | **500 characters** (default on most instances; some allow more via `max_characters`) | No hard truncate helper — formatters keep posts short by convention | Every new formatter **must** stay ≤ 500 graphemes. Prefer building short templates + optional 📝 line. Add a shared `assertStatusLength(text)` (warn + hard-trim to 500) before `postStatus` if text can include long ESPN narratives. |
| Visibility | `public` \| `unlisted` \| `private` \| `direct` | Default `public` | Keep `public` for match content (same as preview/start). |
| Language | `language` ISO 639-1 | Set from `config.i18n.defaultLanguage` (`pt`) | No change. |
| Threading | `in_reply_to_id` | Used for goal confirmation / penalty pending / delay end | Optional: officials as reply to preview; enhanced plays as standalone (not threaded to every keyEvent). |
| Rate limit (account) | **300 requests / 5 min** (typical) | `DELAY_BETWEEN_POSTS_MS` default **2000 ms** + retry on 429 with `Retry-After` | **Critical for play-by-play.** Unfiltered plays would flood the timeline and hit 429. See volume budget below. |
| Media | 30 uploads / 30 min | Crests on goals only | Officials/PBP: **no media** in v1. |
| Auth scopes | write:statuses (post), read:notifications (mentions) | Already required | No new scopes. |
| Idempotency | N/A on Mastodon | `postedEventIds` + `markEventPosted` | **Mandatory** composite event IDs (same pattern as preview: `{matchId}-preview`). |

### Volume budget (play-by-play)

Live sample (Bahia vs Chapecoense, event `401879459`, ~90'):

| Filter | Est. posts / match |
|--------|--------------------|
| All plays | ~1 300 (unusable) |
| “Interesting” typeIds (save, corner, shot, foul, offside, free kick…) | ~90 |
| `priority === true` only | ~30 |
| **Recommended v1 allowlist** (shot on target, shot off target, save, big chance if present) | **~8–15** |

With `DELAY_BETWEEN_POSTS_MS=2000`, 15 posts ≈ 30 s of pure throttle — fine for one match.  
With **N concurrent live matches**, budget is shared:  
`max_posts_per_5min ≈ min(300, 5*60*1000 / DELAY_BETWEEN_POSTS_MS)` ≈ **150** at 2 s delay.

**Rule of thumb for v1:** allow at most **~12 enhanced posts per match** (config cap), prefer `priority` + strict type allowlist, never post Pass/Clear/Throw In/Aerial.

### Character budget template

```
[emoji + title]          ~25
blank + score line       ~40
minute line              ~10
player line              ~40
optional 📝 desc         ≤ 250 (truncate with "…")
hashtags                 ~60
────────────────────────
total                    ≤ 500
```

---

## Feature 3 — Officials pre-match post

### Goal

Post referee (and any other officials when present) once per match in the pre-match window, before or alongside the existing match preview.

### ESPN data (verified `bra.1`)

**Preferred source (zero extra HTTP if summary already fetched):**

```
GET site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={matchId}
→ gameInfo.officials[]
```

Sample:

```json
{
  "fullName": "Paulo Cezar Zanovelli Da Silva",
  "displayName": "Paulo Cezar Zanovelli Da Silva",
  "position": { "name": "Referee", "displayName": "Referee", "id": "1" },
  "order": 1
}
```

**Fallback source (dedicated, works when only referee is listed):**

```
GET sports.core.api.espn.com/v2/sports/soccer/leagues/{league}/events/{id}/competitions/{id}/officials
→ items[] { id, fullName, displayName, position.{name,displayName,id}, order }
```

Notes:

- `bra.1` typically returns **1 official** (main referee). Other leagues may return AR1/AR2/4th/VAR — design for an array.
- Officials may be **missing** until closer to kickoff (or empty for some fixtures). Treat empty as skip, not error.
- Scoreboard does **not** expose officials; preview path currently only uses scoreboard data.

### Product behavior

| Item | Decision |
|------|----------|
| When | Once, in pre-match window (`config.bot.pollWindowBeforeMatchMs`), same gate as `formatMatchPreview` |
| Order vs preview | **After** preview if both fire same tick (or as `in_reply_to_id` of preview status if we store preview `statusId` — optional nicety, not required for v1) |
| Dedup key | `{matchId}-officials` via `isEventPosted` / `markEventPosted` |
| Feature flag | `config.events.matchOfficials` ← `EVENT_MATCH_OFFICIALS` env (default `true`) |
| Empty officials | Do not post; do **not** mark posted (retry next poll until window ends or match starts) |
| Match already `in` | Do not post (pre-only) |
| Language | i18n keys under `ui.*` (pt-BR) |

### Suggested toot (pt-BR)

```
🧑‍⚖️ ARBITRAGEM

⚽ Atlético-MG x Bahia
📍 Arena MRV

👤 Árbitro: Paulo Cezar Zanovelli Da Silva

#AtleticoMG #Bahia #Brasileirao
```

If multiple officials:

```
👤 Árbitro: …
👤 Assistente 1: …
👤 Assistente 2: …
```

Map `position.name` / `position.id` → short PT labels (fallback: raw `displayName` of position).

### Implementation plan

#### 3.1 `src/api/espn.js`

- Add `getMatchOfficials(matchId, leagueCode)`:
  1. Try reuse of in-memory/cache from `getMatchDetails` if `gameInfo.officials` present (extend `getMatchDetails` normalizer to pass through `officials`).
  2. Else GET core officials URL; normalize to:
     ```js
     [{ id, name, positionName, positionId, order }]
     ```
- Cache TTL: same as details (`config.cache.detailsTtlMs`) or dedicated `officialsTtlMs` (default 120s).
- Do **not** call three times; share cache key with details when possible.

#### 3.2 `src/bot/formatter.js`

- Add `formatMatchOfficials(match, officials)`:
  - Title via `translate('ui.match_officials')`
  - Teams + optional venue
  - One line per official
  - Hashtags via existing `getTeamHashtag` + `match.league.hashtags`
  - Enforce ≤ 500 chars (drop lower-order officials if needed, keep referee first by `order` / position id `1`)

#### 3.3 `src/services/dictionaries/pt-BR.json` (and i18n)

- Keys e.g.:
  - `ui.match_officials` → `🧑‍⚖️ ARBITRAGEM`
  - `ui.official_referee` → `Árbitro`
  - `ui.official_assistant` → `Assistente`
  - `ui.official_fourth` → `Quarto árbitro`
  - `ui.official_var` → `VAR`
  - `ui.official_generic` → `{position}`

#### 3.4 `src/bot/matchMonitor.js`

In the existing pre-match block (near preview, ~lines 101–116):

```text
if (config.events.matchOfficials) {
  const officialsId = `${matchId}-officials`;
  if (inWindow && !isEventPosted(officialsId)) {
    const officials = await getMatchOfficials(matchId, league.code);
    if (officials?.length) {
      await postStatus(formatMatchOfficials(matchData, officials));
      markEventPosted(officialsId);
    }
  }
}
```

Only mark posted after successful `postStatus` (same pattern as preview).

#### 3.5 `src/config.js` + `.env.example`

```js
matchOfficials: process.env.EVENT_MATCH_OFFICIALS !== 'false',
```

Document in `.env.example` under pre-match events.

#### 3.6 Tests

| File | Cases |
|------|--------|
| `tests/formatter.officials.test.js` | Single referee; multiple officials; truncation ≤ 500; missing venue |
| `tests/espn.officials.test.js` | Normalize summary `gameInfo.officials`; normalize core API items; empty → `[]` |
| `tests/matchMonitor.test.js` | Posts once in window; skips if empty; skips if already posted; respects flag off |

#### 3.7 Docs

- Update `API_DOCUMENTATION.md`: core officials endpoint + `gameInfo.officials` field table.
- Note bra.1 usually has only main referee.

### Acceptance criteria

- [x] One officials toot per match max (dedup survives restart via persistence).
- [x] No post when API returns empty list.
- [x] Post length ≤ 500 characters.
- [x] Uses existing `postStatus` (visibility public, language, delays, 429 retry).
- [x] Feature can be disabled via env without code change.
- [x] Unit tests green; dry-run logs text without posting.

### Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Officials late-populated | Retry each poll until window ends; only mark posted when non-empty + success |
| Extra ESPN call | Prefer summary `gameInfo` from details cache |
| Name-only English positions | Map known ids; fallback to PT generic + raw name |
| Double post with preview | Distinct event IDs; optional thread later |

### Effort

**S** (~0.5–1 day): mostly wiring + formatter + tests. No new Mastodon APIs.

---

## Feature 4 — Play-by-play enhanced events

### Goal

Post a **curated subset** of ESPN play-by-play actions that `keyEvents` currently miss or under-report (shots, saves, big chances), without turning the bot into a full commentary feed.

### Why not only `keyEvents`?

Today live flow uses `getLiveEvents` → `keyEvents[]` + `ID_TO_CATEGORY` (goals, cards, subs, phase changes, VAR, delays).

Core plays endpoint exposes many more actions:

```
GET sports.core.api.espn.com/v2/sports/soccer/leagues/{league}
  /events/{matchId}/competitions/{matchId}/plays?limit=300
```

Verified fields per play:

| Field | Use |
|-------|-----|
| `id` | Dedup |
| `type.id` / `type.text` | Category map |
| `text` / `alternativeText` | Description (EN by default; PT with `lang=pt&region=br` — confirmed 2026-10-22) |
| `clock.displayValue` | Minute |
| `period.number` | Half |
| `priority` | Prefer true |
| `scoringPlay` | Skip if already handled as goal via keyEvents |
| `participants[]` | Athlete refs (often `$ref` only — name may be embedded in `text`) |
| `team.$ref` | Team id parse from URL |
| flags: `yellowCard`, `redCard`, `penaltyKick`, `ownGoal` | Cross-check / skip duplicates |

Sample volume (one bra.1 match): **~1 298 plays**; Pass alone ~half. Unfiltered posting is non-compliant with Mastodon rate limits and product quality.

### Recommended v1 allowlist

Post **only** these `type.id` values (extend after live observation):

| typeId | ESPN text | Category | Post? |
|--------|-----------|----------|-------|
| `106` | Shot On Target | `SHOT_ON_TARGET` | Yes |
| `117` | Shot Off Target | `SHOT_OFF_TARGET` | Yes |
| `77` | Save | `SAVE` | Yes |
| `135` | Shot Blocked | `SHOT_BLOCKED` | Optional (flag, default off — noisy) |
| `95` | Corner Awarded | `CORNER` | Optional (flag, default off) |
| `68` | Offside | `OFFSIDE` | Optional (default off) |
| `66` | Foul | — | **No** (spam; cards already covered) |
| `118` | Pass | — | **No** |
| `70`/`98`/… goals | Goal* | — | **No** — keep on `keyEvents` path only |
| `94`/`93` cards | — | — | **No** — keyEvents only |
| `76` sub | — | — | **No** |

Also skip if:

- `scoringPlay === true` (goal path owns it)
- `isEventPosted(play.id)` already true (same id space as keyEvents when shared)
- Dedup key: prefer `play-{matchId}-{play.id}` to avoid colliding with keyEvent ids if namespaces overlap

### Product behavior

| Item | Decision |
|------|----------|
| When | During `status === 'in'`, inside `pollMatchEvents` / live loop |
| Frequency | Same poll as keyEvents (live interval ~60s) |
| Cap | `ENHANCED_PLAYS_MAX_PER_MATCH` default **12**; stop posting new enhanced plays after cap (still process keyEvents) |
| Priority filter | If `ENHANCED_PLAYS_REQUIRE_PRIORITY=true` (default **true**), only `priority === true` |
| Feature flag | `config.events.enhancedPlays` ← `EVENT_ENHANCED_PLAYS` (default **false** until stable) |
| Catch-up on restart | Only post plays newer than match join time **or** last N minutes; do not dump full history (see state) |
| Language | Titles via i18n; 📝 body = ESPN `text`, requested in PT (`lang=pt&region=br`) when `DEFAULT_LANGUAGE` is pt-* |

### Suggested toots (pt-BR)

Shot on target:

```
🎯 CHUTE NO GOL

🏟️ Bahia 1 x 0 Chapecoense
⏱️ 17'
👤 Santiago Ramos Mingo

📝 Attempt saved. …

#Bahia #Chapecoense #Brasileirao
```

Save:

```
🧤 DEFESA

🏟️ …
⏱️ 4'
👤 Matheus

📝 …
```

Shot off target:

```
📤 CHUTE PARA FORA
…
```

### Mastodon compliance checklist (PBP-specific)

- [ ] **Rate limit:** allowlist + cap + existing 2s delay; never post > ~12 enhanced/match.
- [ ] **500 chars:** truncate `text` to leave room for hashtags (shared helper).
- [ ] **No media** in v1 (saves media quota for goals/highlights).
- [ ] **429:** existing `retryWithBackoff` / `isRetryableError` already handles; do not bypass `postStatus`.
- [ ] **Spam / timeline quality:** default flag **off**; document that enabling on multi-league + multi-live days multiplies volume.
- [ ] **No `postThread` for each play** (would multiply requests); one status per play max.
- [ ] **Idempotency:** persist posted play ids in `postedEventIds` (same disk state as today).

### Implementation plan

#### 4.1 Discovery spike (before merge)

1. ~~Confirm whether plays support `lang=pt` / `region=br` on core or site API.~~ **Done (2026-10-22):** core plays honor `lang=pt&region=br` on bra.1, bra.2, Libertadores and eng.1; play ids are identical across languages. `parsePlayerFromPlayText` handles the PT templates (334/334 shot/save/offside plays over 9 matches).
2. Full-match type histogram for 2–3 bra.1 games (script under `scripts/audit-espn-plays.js`).
3. Confirm id overlap between `keyEvents[].id` and `plays[].id` (if same, shared dedup is enough).
4. Measure payload size / latency of `plays?limit=300` vs pagination (`pageIndex`).

Deliverable: short note in this file or `docs/espn-plays-audit.md`.

#### 4.2 `src/api/espn.js`

- Add `getMatchPlays(matchId, leagueCode, { limit = 300 } = {})`:
  - Fetch core plays URL
  - Normalize:
    ```js
    {
      id, typeId, typeText, description, minute,
      period, priority, scoringPlay,
      teamId, // parsed from team.$ref
      playerName, // from text heuristics OR resolved athlete if cheap
      flags: { yellowCard, redCard, penaltyKick, ownGoal }
    }
    ```
  - Cache TTL: align with `eventsTtlMs` (30s) — plays change often while live.
  - Pagination: if `pageCount > 1`, either increase `limit` or walk pages **only for catch-up once**; live polls should request recent page or high limit carefully (watch ESPN load).

**Player names:** core plays often give athlete `$ref` only. v1: parse name from `text` (ESPN narratives usually include `"Player (Team) …"`) using existing `parsePlayerFromEventDescription` patterns. v2: optional athlete resolve cache (extra HTTP — avoid in hot path).

#### 4.3 `src/bot/eventProcessor.js` (or new `playProcessor.js`)

Prefer a dedicated `processEnhancedPlays(plays, match)` to avoid bloating `categorizeEvent`:

1. Filter allowlist typeIds from config.
2. Filter `priority` if required.
3. Skip `scoringPlay` / card flags if those categories are enabled via keyEvents.
4. Sort by clock/period ascending.
5. For each play:
   - `eventId = \`play-${match.id}-${play.id}\``
   - if `isEventPosted` → skip
   - if match enhanced count ≥ max → break
   - format + `postStatus` + `markEventPosted`
6. Track per-match counter in memory (`matchState`) reset on `clearMatchState`.

**Catch-up policy (restart mid-match):**

- On first poll after `addActiveMatch`, set `enhancedPlaysCursor = Date.now() - 2 * pollInterval` or store last seen play id.
- Only emit plays with `wallclock` / `modified` after cursor **or** last 5 plays if timestamps missing.
- Never backfill entire first half after restart (would spam).

#### 4.4 Formatters + i18n

- `formatShotOnTarget`, `formatShotOffTarget`, `formatSave` (or one `formatEnhancedPlay(category, …)`).
- Dictionary keys under `ui.shot_on_target`, `ui.shot_off_target`, `ui.save`, etc.

#### 4.5 Config / env

```bash
# Play-by-play enhanced events (default off)
EVENT_ENHANCED_PLAYS=false
ENHANCED_PLAYS_REQUIRE_PRIORITY=true
ENHANCED_PLAYS_MAX_PER_MATCH=12
# Comma-separated ESPN type ids
ENHANCED_PLAY_TYPE_IDS=106,117,77
```

Wire in `config.events` + `config.enhancedPlays`.

#### 4.6 Integration point

In `matchMonitor.js` live branch (where `getLiveEvents` + `processEvents` run):

```text
const [events, plays] = await Promise.all([
  getLiveEvents(...),
  config.events.enhancedPlays ? getMatchPlays(...) : null,
]);
await processEvents(events, match);
if (plays) await processEnhancedPlays(plays, match);
```

Prefer **one** shared summary fetch long-term (separate backlog: consolidate summary calls). Plays are a **different** endpoint — unavoidable extra request when enabled.

#### 4.7 Tests

| File | Cases |
|------|--------|
| `tests/espn.plays.test.js` | Normalize sample fixture; team id from `$ref`; empty items |
| `tests/playProcessor.test.js` | Allowlist filter; priority filter; cap; scoringPlay skip; dedup; catch-up cursor |
| `tests/formatter.enhancedPlays.test.js` | Each category ≤ 500 chars with long description |

Use fixtures under `tests/fixtures/plays-bra1-sample.json` (sanitized live sample).

#### 4.8 Docs

- `API_DOCUMENTATION.md`: plays endpoint, allowlist, rate-limit note.
- `.env.example` flags.
- Update this backlog status when shipped.

### Acceptance criteria

- [x] Default **off**; enabling is opt-in.
- [x] With defaults, ≤ 12 enhanced posts/match and only allowlisted typeIds.
- [x] No duplicate posts after restart for the same play id.
- [x] No goal/card/sub double-posts vs keyEvents path.
- [x] All statuses ≤ 500 characters; go through `postStatus` (delays + 429).
- [x] Multi-match live day: no uncontrolled fan-out (caps per match).
- [x] Unit tests (fixture-based); enable with `EVENT_ENHANCED_PLAYS=true` + `DRY_RUN=true` for soak.

### Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Mastodon 429 / timeline spam | Default off; priority + allowlist + per-match cap; existing delay |
| EN-only play text | Resolved: core API serves PT with `lang=pt&region=br` (PT drops goalkeeper name on saved shots) |
| Athlete `$ref` without name | Parse from `text`; unknown → `translate('common.unknown_player')` |
| Extra ESPN load | 30s cache; only when flag on and match `in` |
| Id collision with keyEvents | Prefixed dedup keys `play-…` |
| Catch-up dump | Cursor / wallclock gate on activate |
| Instance with custom max_characters < 500 | Uncommon; still target 500; optional future `GET /api/v2/instance` for `configuration.statuses.max_characters` |

### Effort

| Phase | Size |
|-------|------|
| Spike (audit + lang + id overlap) | **S** (0.5 day) |
| v1 allowlist pipeline + formatters + tests | **M** (1.5–2.5 days) |
| v2 (corners optional, athlete resolve, PT plays) | **M** later |

---

## Suggested delivery order

1. **Feature 3 (Officials)** — low risk, clear UX, reuses pre-match window and Mastodon path.
2. **Feature 4 spike** — confirm volume/lang/ids before coding the processor.
3. **Feature 4 v1** — shots + saves only, flag default `false`, ship behind env for bra.1 soak.
4. Optional: character-length guard shared by all formatters.
5. Optional: consolidate summary fetches (orthogonal perf win; helps officials via `gameInfo`).

---

## Out of scope (this backlog)

- Betting odds posts (product/ethics — see `API_DOCUMENTATION.md`).
- Full commentary dump / Pass-level plays.
- Win probability (not supported for `bra.1`).
- Leaders / top scorers (not supported for `bra.1`).
- Lineups (empty for bra.1 at time of research).
- Changing Mastodon visibility or multi-account posting.

---

## References

- Mastodon rate limits: https://docs.joinmastodon.org/api/rate-limits/
- Mastodon post status: https://docs.joinmastodon.org/methods/statuses/
- Project: `src/api/mastodon.js` (`postStatus`, `postThread`, media limits)
- Project: `API_DOCUMENTATION.md` §2
- Live verification: bra.1 event `401879459` (plays, officials), `401841148` (pre-match odds/scoreboard)
