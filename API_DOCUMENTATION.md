# API Documentation

This document describes all external APIs used by the SAIUGOL Mastodon bot.

## ESPN API Compliance Summary

| Endpoint | Status | Source |
|----------|--------|--------|
| `/apis/site/v2/sports/soccer/{league}/scoreboard` | ✅ Documented | Public-ESPN-API |
| `/cdn.espn.com/core/{league}/scoreboard?xhr=1` | ✅ Documented | Public-ESPN-API (CDN) |
| `/apis/site/v2/sports/soccer/{league}/summary?event={id}` | ⚠️ Undocumented for soccer | Common pattern (NFL/NBA) |

**Note:** The `/summary` endpoint is documented for NFL, NBA, and MLB but not explicitly for soccer. It is functional and widely used for Brasileirão data.

**Notation used in this document** (documentation status and usage status are independent — a field can be officially undocumented by ESPN yet already consumed by the bot, or documented yet unused):
- `(UNDOCUMENTED for Soccer)` / `(DOCUMENTED)` next to an endpoint or section heading — whether ESPN's own Public-ESPN-API docs cover it.
- *verified live; not consumed by bot* next to a field — we confirmed it in a real API response, but the normalizer currently drops it before it reaches bot logic.

**Betting odds note:** Several endpoints below (scoreboard `competition.odds`, summary `odds`/`pickcenter`/`hasOdds`) expose live betting lines (moneyline, spread, over/under) from third-party sportsbooks. This is confirmed present wherever it's mentioned, but deliberately **not recommended for use** — a football-scores bot surfacing betting odds is a product/ethics decision, not a data-availability one. Field tables below reference this note rather than repeating it.

---

## 1. ESPN API

### Overview
The bot uses ESPN's public API to fetch Brazilian Serie A (Brasileirão) match data. No API key is required.

### Base URL
```
https://site.api.espn.com/apis/site/v2/sports/soccer
```

**CDN Fallback URL:**
```
https://cdn.espn.com/core/soccer
```

The bot automatically falls back to the CDN endpoint if the main API fails.

### League Identifier
- `bra.1` - Brasileirão Serie A (Brazilian First Division)

### Endpoints Used

#### 1.1 Get Today's Scoreboard (DOCUMENTED)
**Endpoint:** `/{league}/scoreboard?dates={YYYYMMDD}`

**URL:** `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=20260202`

**Method:** GET

**Description:** Retrieves all scheduled and live matches for the specified date. This endpoint is documented in the Public-ESPN-API repository.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `dates` | string | Date in YYYYMMDD format (defaults to today) |

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `events[].id` | string | Unique match identifier |
| `events[].date` | string | ISO 8601 match start time |
| `events[].competitions[].venue.fullName` | string | Stadium name |
| `events[].competitions[].status.type.name` | string | Match status (e.g., "STATUS_IN_PROGRESS") |
| `events[].competitions[].status.type.state` | string | Match state (pre, in, post) |
| `events[].competitions[].status.displayClock` | string | Game clock (e.g., "45'") |
| `events[].competitions[].competitors[]` | array | Teams with scores |
| `events[].competitions[].competitors[].homeAway` | string | "home" or "away" |
| `events[].competitors[].team.id` | string | Team ID |
| `events[].competitors[].team.displayName` | string | Team display name |
| `events[].competitors[].score` | string | Team score |
| `events[].competitors[].team.logo` | string | Team crest URL (PNG), e.g. `https://a.espncdn.com/i/teamlogos/soccer/500/6086.png` — *verified live; not consumed by bot* |
| `events[].competitors[].form` | string | Last-5-match results, most recent last, e.g. `"LWDWW"` — *verified live; not consumed by bot* |
| `events[].competitors[].records[].summary` | string | Season record, e.g. `"6-4-7"` (W-D-L) — *verified live; not consumed by bot* |
| `events[].competitors[].leaders[].leaders[0].athlete.displayName` / `.value` | string / number | Team's top scorer name and goal count — *verified live; not consumed by bot* |
| `events[].competitions[].venue.address.city` / `.country` | string | Match city/country — *verified live; not consumed by bot* |
| `events[].competitions[].odds` | array | Betting odds/lines — see betting odds note above |

**Usage in Code:** `src/api/espn.js:95` - `getTodayMatches()`

---

#### 1.2 Get Match Summary (UNDOCUMENTED for Soccer)
**Endpoint:** `/{league}/summary?event={matchId}`

**URL:** `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/summary?event={matchId}`

**Method:** GET

**Description:** Retrieves detailed information about a specific match. This endpoint is documented for NFL, NBA, and MLB but not explicitly for soccer in the Public-ESPN-API docs.

**Response Top-Level Keys (verified against a live response — full list, more than previously documented):**
| Key | Type | Description |
|-----|------|-------------|
| `header` | object | Match metadata and competition details |
| `keyEvents[]` | array | Match events (goals, cards, substitutions) |
| `videos[]` | array | Highlight videos |
| `boxscore` | object | Team & player stats (see 1.2.1) |
| `rosters` | array | Starting lineups, formations, substitutes (see 1.2.2) |
| `commentary` | array | Play-by-play commentary |
| `standings` | object | Full current league table (see 1.2.3) — *verified live; not consumed by bot* |
| `gameInfo` | object | Venue, attendance, match officials/referee (see 1.2.4) — *verified live; not consumed by bot* |
| `format` | object | Competition format details |
| `lastFiveGames` | object | Recent form for both teams |
| `headToHeadGames` | object | Historical head-to-head results |
| `leaders` | array | Top performers (goals, assists, etc.) for this competition |
| `broadcasts` | array | TV/streaming broadcast info |
| `pickcenter` / `odds` / `hasOdds` | object/array/bool | Betting odds and win-probability data — see betting odds note above |
| `news` | array | Related news article links |
| `wallclockAvailable` | boolean | Whether real-time clock data is available |
| `meta` | object | Response metadata |

**Usage in Code:** `src/api/espn.js:295,399,497` currently only reads `header`, `keyEvents`, and `videos` from this response — the rest (`standings`, `gameInfo`, `rosters`, `boxscore`) is fetched on every call already made but discarded before it reaches the normalizer.

**Header Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `header.id` | string | Match ID |
| `header.date` | string | ISO 8601 match start time |
| `header.competitions[0].status.type.name` | string | Match status (e.g., "STATUS_FULL_TIME") |
| `header.competitions[0].status.type.state` | string | Match state (pre, in, post) |
| `header.competitions[0].competitors[]` | array | Teams with scores |
| `header.competitions[0].venue.fullName` | string | Stadium name |

**Sample Header:**
```json
{
  "header": {
    "id": "704518",
    "competitions": [{
      "status": {
        "type": {
          "name": "STATUS_FULL_TIME",
          "state": "post"
        }
      },
      "competitors": [
        {"homeAway": "home", "team": {"displayName": "Nottingham Forest"}, "score": "7"},
        {"homeAway": "away", "team": {"displayName": "Brighton"}, "score": "0"}
      ],
      "venue": {"fullName": "City Ground"}
    }]
  },
  "keyEvents": 24,
  "videos": 0
}
```

**Usage in Code:**
- `src/api/espn.js:295` - `getMatchDetails()`
- `src/api/espn.js:399` - `getLiveEvents()`
- `src/api/espn.js:497` - `getHighlights()`

---

#### 1.2.1 Boxscore — Match Stats (UNDOCUMENTED, verified in live response)

**Path:** `boxscore.teams[]` (two entries, one per team)

| Field | Type | Description |
|-------|------|-------------|
| `boxscore.teams[].team.logo` | string | Team crest URL (same as scoreboard) |
| `boxscore.teams[].statistics[]` | array | Per-team match stats: `foulsCommitted`, `yellowCards`, `redCards`, `offsides`, `wonCorners`, `saves`, `possessionPct`, `totalShots`, `shotsOnTarget`, `shotPct`, and more — each entry is `{ name, displayValue, label }` |

Useful for a post-match "match stats" toot (possession, shots on target, corners, cards) — no extra request needed, this is part of the summary response already fetched for `keyEvents`/`videos`.

---

#### 1.2.2 Rosters — Lineups (UNDOCUMENTED, verified in live response)

**Path:** `rosters[]` (two entries, one per team)

| Field | Type | Description |
|-------|------|-------------|
| `rosters[].team` | object | Team info |
| `rosters[].formation` | string | Formation, e.g. `"3-4-3"` |
| `rosters[].roster[]` | array | Players: `{ active, starter, jersey, athlete: { displayName, ... }, position, subbedIn, subbedOut, formationPlace, stats }` |

`starter: true/false` distinguishes the starting XI from the bench. Timing caveat: not yet confirmed how far before kickoff this populates (may only appear once lineups are officially confirmed, sometimes at or near kickoff) — needs empirical checking before relying on it for a "predicted lineup" post.

---

#### 1.2.3 Standings — Full League Table (UNDOCUMENTED, verified in live response)

**Path:** `standings.groups[0].standings.entries[]`

| Field | Type | Description |
|-------|------|-------------|
| `entries[].team` | string | Team name (confirmed as a plain string in our captured sample — `"Palmeiras"` — not a nested team object; other ESPN sports/leagues have been seen returning a team object here, so re-verify if a league other than `bra.1` behaves differently) |
| `entries[].id` / `.uid` / `.link` | string | Team ID, ESPN UID, and ESPN club page URL |
| `entries[].logo[]` | array | Team crest, same shape as `team.logos[]` elsewhere (`{ href, width, height, rel }`) |
| `entries[].stats[]` | array | `{ name, displayName, abbreviation, value, displayValue }` entries, including `gamesPlayed`, `wins`, `losses`, `ties`, `points`, `pointDifferential`, and **`rank`** (the team's table position — directly usable, no need to derive it from sorting `points`/`pointDifferential` yourself) |

Gives the full current table for the competition in one call — the same summary call already made per live match. The `rank` stat plus `points` is enough to annotate match-start/match-end posts with each team's league position (e.g. "Palmeiras (1º, 41 pts)") without any extra computation.

---

#### 1.2.4 Game Info — Venue, Attendance, Officials (UNDOCUMENTED, verified in live response)

**Path:** `gameInfo`

| Field | Type | Description |
|-------|------|-------------|
| `gameInfo.venue.fullName` / `.address.{city,country}` | string | Venue and location |
| `gameInfo.attendance` | number | Attendance figure |
| `gameInfo.officials[].displayName` | string | Match officials, referee first (`order: 1`) |

---

#### 1.3 Get Live Events (UNDOCUMENTED for Soccer)
**Endpoint:** `/{league}/summary?event={matchId}` (same as summary)

**URL:** `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/summary?event={matchId}`

**Method:** GET

**Description:** Retrieves key events (goals, cards, substitutions, VAR reviews) for a match.

**Key Events Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `keyEvents[].id` | string | Event ID |
| `keyEvents[].type.text` | string | Event type description |
| `keyEvents[].clock.displayValue` | string | Event minute (e.g., "45'") |
| `keyEvents[].team.displayName` | string | Team name |
| `keyEvents[].text` | string | Event description |
| `keyEvents[].period.number` | number | Match period |

**Event Types Verified:**
| Type | Description |
|------|-------------|
| `Kickoff` | Match start |
| `Goal` | Regular goal |
| `Goal - Header` | Header goal |
| `Penalty - Scored` | Penalty goal |
| `Own Goal` | Own goal |
| `Yellow Card` | Yellow card |
| `Red Card` | Red card (if any) |
| `Substitution` | Player change with description |
| `Halftime` | First half end |
| `Start 2nd Half` | Second half begin |
| `End Regular Time` | Full time |

**Sample Response:**
```json
{
  "type": "Goal - Header",
  "minute": "25'",
  "team": "Nottingham Forest",
  "description": "Goal! Morgan Gibbs-White (Nottingham Forest) header from the left side of the six yard box to the high centre of the goal. Assisted by Anthony Elanga with a cross following a corner."
}
```

**Usage in Code:** `src/api/espn.js:399` - `getLiveEvents()`

---

#### 1.4 Get Highlights (UNDOCUMENTED for Soccer)
**Endpoint:** `/{league}/summary?event={matchId}` (same as summary)

**URL:** `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/summary?event={matchId}`

**Method:** GET

**Description:** Retrieves video highlights for a match.

**Video Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `videos[].headline` | string | Video title |
| `videos[].links.source.mezzanine.href` | string | Best quality video URL |
| `videos[].links.source.HD.href` | string | HD quality video URL |
| `videos[].links.source.href` | string | Default quality video URL |
| `videos[].links.mobile.source.href` | string | Mobile MP4 video URL |
| `videos[].duration` | number | Duration in seconds |
| `videos[].thumbnail` | string | Thumbnail image URL (verified in API) |

**Priority Order:** mezzanine > HD > source.href > mobile.source.href

**Sample Video:**
```json
{
  "headline": "Neymar's stunning goal",
  "links": {
    "source": {
      "mezzanine": {"href": "https://example.com/video.m3u8"},
      "HD": {"href": "https://example.com/video_720.mp4"}
    },
    "mobile": {"href": "https://example.com/video_360.mp4"}
  },
  "duration": "2:34",
  "thumbnail": "https://example.com/thumb.jpg"
}
```

**Usage in Code:** `src/api/espn.js` - `getHighlights()` returns `{ url, title, thumbnail? }`.

---

#### 1.4.1 Media disponível na API ESPN (verificado em respostas reais)

| Fonte | Campo | Formato | Exemplo |
|-------|--------|--------|--------|
| **Scoreboard** (`/scoreboard`) | `event.competitions[0].competitors[].team.logo` | string | `https://a.espncdn.com/i/teamlogos/soccer/500/7635.png` |
| **Summary** (header) | `header.competitions[0].competitors[].team.logos` | array | `[{ href, width, height, rel: ["full","default"] }, { rel: ["full","dark"] }]` |
| **Summary** (videos) | `videos[].thumbnail` | string | `https://a.espncdn.com/media/motion/.../...jpg` |
| **Summary** (videos) | `videos[].links.source` | object | `mezzanine.href`, `HD.href`, `href`, e `mobile.source.href` para MP4 |

Os objetos normalizados em `getTodayMatches` / `getMatchDetails` atualmente **não** expõem `logo`/`logos`; apenas `id` e `name` dos times. Para usar logos em toots ou UI, é necessário estender o normalizador para incluir `homeTeam.logo` / `awayTeam.logo` a partir do scoreboard (`team.logo`) ou do summary (`team.logos[0].href`).

---

#### 1.5 CDN Scoreboard (DOCUMENTED)
**Endpoint:** `/core/{league}/scoreboard?xhr=1`

**URL:** `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&dates=20260202`

**Method:** GET

**Description:** CDN-optimized endpoint for fast/live scoreboard data. This is used as a fallback when the main API fails.

**Usage in Code:** `src/api/espn.js:103` - Fallback in `getTodayMatches()`

---

### Caching

The bot implements response caching to reduce API calls:

| Endpoint | Cache TTL | Location |
|----------|-----------|----------|
| Scoreboard | 30 seconds | `src/api/espn.js:20` |
| Match Details | 60 seconds | `src/api/espn.js:21` |
| Live Events | 30 seconds | `src/api/espn.js:22` |
| Highlights | 120 seconds | `src/api/espn.js:23` |

**Environment Variables for Cache:**
| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_SCOREBOARD_TTL_MS` | 30000 | Scoreboard cache TTL in ms |
| `CACHE_DETAILS_TTL_MS` | 60000 | Details cache TTL in ms |
| `CACHE_EVENTS_TTL_MS` | 30000 | Events cache TTL in ms |
| `CACHE_HIGHLIGHTS_TTL_MS` | 120000 | Highlights cache TTL in ms |

---

### Rate Limiting & Resilience
No official rate limits are documented. The implementation includes:
- Automatic retry with exponential backoff
- Configurable max attempts (default: 3)
- Configurable delays between retries (initial: 1s, max: 10s)
- Request timeout (default: 10 seconds)
- Circuit breaker pattern for failure isolation
- CDN endpoint fallback for scoreboard requests

---

## 2. Mastodon API

### Overview
The bot uses the Mastodon API (via Megalodon library) to post match updates and highlights.

### Authentication
- Uses OAuth2 access token
- Token configured via `MASTODON_ACCESS_TOKEN` environment variable
- Instance URL configured via `MASTODON_INSTANCE` environment variable

### Base URL Format
```
https://{instance}/api/v1
```

### Endpoints Used

#### 2.1 Post Status (Toot)
**Endpoint:** `/api/v1/statuses`

**Method:** POST

**Description:** Posts a new status (toot) to Mastodon.

**Request Body:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | Yes | The status text (max 500 characters) |
| `visibility` | string | No | Post visibility: public, unlisted, private, direct |
| `in_reply_to_id` | string | No | ID of status to reply to (for threads) |

**Usage in Code:** `src/api/mastodon.js:45` - `postStatus(text, options)`

---

#### 2.2 Verify Account Credentials
**Endpoint:** `/api/v1/accounts/verify_credentials`

**Method:** GET

**Description:** Verifies the bot's authentication credentials.

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `username` | string | Bot's username |
| `id` | string | Bot's account ID |
| `display_name` | string | Bot's display name |

**Usage in Code:** `src/api/mastodon.js:122` - `verifyCredentials()`

---

### Rate Limiting

**Official docs:** [Mastodon API – Rate limits](https://docs.joinmastodon.org/api/rate-limits/)

**Response headers (when rate limit applies):**
| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Requests permitted per time period |
| `X-RateLimit-Remaining` | Requests you can still make |
| `X-RateLimit-Reset` | Timestamp when the limit resets |

**Default limits (per instance):**
- **Per account:** 300 requests per 5 minutes (all endpoints).
- **Per account (media):** `POST /api/v1/media` — 30 requests per 30 minutes.
- **Per account (delete/unreblog):** 30 requests per 30 minutes.
- **Per IP:** 300 requests per 5 minutes (all endpoints).

When the limit is exceeded, the server returns **HTTP 429 Too Many Requests** and may include a **`Retry-After`** header (seconds to wait before retrying).

**This project’s behavior:**
- Configurable delays between posts (`DELAY_BETWEEN_POSTS_MS`, default 2s) and a global throttle so no two posts are sent closer than that.
- On 429: retry delay is taken from `Retry-After` when present, otherwise 60s (up to 5 min), then retry; other errors use exponential backoff.
- 401/403 are not retried.

---

## 3. Logging (Pino)

### Overview
The bot uses [Pino](https://getpino.io/) for structured JSON logging.

### Log Levels
| Level | Description |
|-------|-------------|
| `info` | Normal operational messages |
| `warn` | Recoverable issues, retries |
| `error` | Errors that may require attention |
| `debug` | Detailed API request/response logging (when `DEBUG_API=true`) |

### Components
| Component | Purpose |
|-----------|---------|
| `espn-api` | ESPN API interactions |
| `mastodon-api` | Mastodon API interactions |
| `bot` | Bot lifecycle and monitoring |
| `cache` | Cache operations |
| `retry` | Retry logic |
| `circuit-breaker` | Circuit breaker state changes |
| `metrics` | Metrics collection |

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum log level to output |
| `DEBUG_API` | `false` | Enable detailed API debugging |

---

## 4. Metrics

### Overview
The bot collects metrics for API health monitoring.

### Metrics Tracked

#### ESPN Metrics
| Metric | Description |
|--------|-------------|
| `requests` | Total API requests |
| `cacheHits` | Responses served from cache |
| `cacheMisses` | Cache misses requiring API calls |
| `successRate` | Percentage of successful requests |
| `avgLatencyMs` | Average API response time |

#### Mastodon Metrics
| Metric | Description |
|--------|-------------|
| `posts` | Total posts attempted |
| `successRate` | Percentage of successful posts |
| `avgLatencyMs` | Average post response time |

#### Bot Metrics
| Metric | Description |
|--------|-------------|
| `matchesProcessed` | Total matches processed |
| `eventsPosted` | Total events posted to Mastodon |
| `errors` | Total errors encountered |

### Accessing Metrics
```javascript
import { getMetrics, logMetrics } from './src/utils/metrics.js';

const metrics = getMetrics();
logMetrics(); // Logs metrics to console
```

---

## 5. Circuit Breaker

### Overview
The bot implements a circuit breaker pattern to prevent cascade failures when external APIs are unavailable.

### States
| State | Description |
|-------|-------------|
| `CLOSED` | Normal operation - requests pass through |
| `OPEN` | Failure threshold reached - requests rejected |
| `HALF_OPEN` | Testing recovery - limited requests allowed |

### Configuration
| Option | Default | Description |
|--------|---------|-------------|
| `failureThreshold` | 5 | Failures before opening circuit |
| `successThreshold` | 2 | Successes in HALF_OPEN to close |
| `timeoutMs` | 30000 | Time before attempting HALF_OPEN |
| `halfOpenMaxCalls` | 3 | Max calls in HALF_OPEN state |

---

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `MASTODON_INSTANCE` | Mastodon instance URL (e.g., `https://mastodon.social`) |
| `MASTODON_ACCESS_TOKEN` | OAuth2 access token for the bot account |

### Optional (with defaults)
| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | 60000 | Match polling interval in milliseconds |
| `DRY_RUN` | false | If true, don't actually post to Mastodon |
| `DELAY_BETWEEN_POSTS_MS` | 2000 | Delay between posts |
| `DELAY_BETWEEN_THREAD_POSTS_MS` | 1000 | Delay between thread posts |
| `DELAY_BEFORE_HIGHLIGHTS_MS` | 30000 | Delay before fetching highlights |
| `RETRY_MAX_ATTEMPTS` | 3 | Maximum retry attempts for failed API calls |
| `RETRY_INITIAL_DELAY_MS` | 1000 | Initial retry delay |
| `RETRY_MAX_DELAY_MS` | 10000 | Maximum retry delay |
| `REQUEST_TIMEOUT_MS` | 10000 | HTTP request timeout in ms |
| `TIMEZONE` | UTC | IANA timezone for scoreboard date (e.g. `America/Sao_Paulo`). Use league local time to match ESPN API; recommended for Brasileirão. |
| `LOG_LEVEL` | `info` | Logging level |
| `DEBUG_API` | `false` | Enable API debugging |

---

## Dependencies Used

| Package | Version | Purpose |
|---------|---------|---------|
| `axios` | ^1.6.0 | HTTP client for ESPN API requests |
| `megalodon` | ^7.0.0 | Mastodon API client library |
| `dotenv` | ^16.3.0 | Environment variable loading |
| `node-cache` | ^5.1.2 | In-memory caching |
| `pino` | ^8.0.0 | Structured logging |

---

## Error Handling

### ESPN API Errors
- Network errors are retried with exponential backoff
- Non-retryable errors (e.g., invalid response format) return empty arrays
- Missing expected fields in responses are logged as warnings
- Circuit breaker opens after 5 consecutive failures
- CDN fallback attempts if main API fails

### Mastodon API Errors
- Authentication errors (401/403) are not retried
- Other errors are retried with exponential backoff
- Failed posts return `null` instead of throwing
- Circuit breaker protects against cascading failures

---

## Response Data Normalization

The bot normalizes ESPN API responses to a consistent format:

```javascript
{
    id: string,           // Match ID
    homeTeam: {
        id: string,       // Team ID
        name: string      // Team name
    },
    awayTeam: {
        id: string,
        name: string
    },
    homeScore: number,
    awayScore: number,
    status: string,       // Match status
    state: string,        // Match state (pre/in/post)
    venue: string,        // Stadium name
    startTime: string,    // ISO 8601 date
    minute: string        // Current game time
}
```

This normalization is implemented in:
- `src/api/espn.js` - Normalization in `getTodayMatches()`, `getMatchDetails()`
- `src/bot/matchMonitor.js` - `normalizeMatchData()`

**Fields verified present in raw ESPN responses but currently dropped by normalization** (see 1.1 and 1.2.1–1.2.4 for details): `team.logo` (crest), `competitor.form`, `competitor.records[].summary`, `competitor.leaders[]` (top scorer), `standings`, `boxscore.teams[].statistics[]`, `rosters[]` (lineups/formation), `gameInfo` (attendance, officials, venue address). None of these require a new endpoint or extra request — they're part of responses the bot already fetches every poll or per live match.
