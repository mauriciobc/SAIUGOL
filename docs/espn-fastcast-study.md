# ESPN Fastcast Study - Final Report

## Executive Summary

After a comprehensive study, we found that **ESPN's Fastcast pub/sub endpoint is not accessible** (returns 404). However, we discovered an alternative: the **Scoreboard Header API** can serve as a lightweight trigger mechanism.

**Status**: ✅ **IMPLEMENTED** - The Header-First strategy is now integrated into `matchMonitor.js`.

---

## Findings

### 1. Fastcast Endpoint (Pub/Sub)

**Status: NOT ACCESSIBLE**

Tested multiple URL patterns:
- `https://fcast.espncdn.com/FastcastService/pubsub/profiles/12000/topic/gp-soccer-{league}-{lang}-{eventId}`
- `https://fcast.espncdn.com/FastcastService/pubsub/profiles/12000/topic/gp-soccer-{league}-pt-{eventId}/message/{messageId}/checkpoint`
- Various SSE and stream patterns

All returned **404 Not Found**.

**Conclusion**: Fastcast is internal to ESPN's frontend and not accessible via public API.

### 2. Scoreboard Header API (Alternative)

**Status: ACCESSIBLE ✓**

| Feature | Details |
|---------|---------|
| URL | `https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header` |
| Auth | None required |
| Parameters | `sport=soccer&league={code}&region=br&lang=pt` |
| Response size | ~70KB (vs ~80KB for scoreboard) |
| Cold call | ~900-1200ms |
| Cached call | ~0-5ms |
| **lastPlay text** | **In Portuguese** (when `lang=pt`) |

### 3. Data Comparison

| Field | Header API | Scoreboard API |
|-------|------------|----------------|
| Match ID | ✓ | ✓ |
| Status | ✓ | ✓ |
| Clock | ✓ | ✓ |
| Scores | ✓ | ✓ |
| Team names | ✓ | ✓ |
| **lastPlay (PT)** | **✓** | ✗ |
| Key events | ✗ | ✓ |
| Statistics | ✗ | ✓ |
| Season details | ✗ | ✓ |

---

## Implementation

### How It Works

The Header-First strategy works as follows:

```
Poll Interval (e.g., 60s):
  1. Get all matches from Scoreboard API (for snapshot/diff)
  2. For each LIVE match:
     a. Get status from Header API (cached, fast)
     b. Compare with previous Header state
     c. IF changed → Call Summary API → Post to Mastodon
     d. ELSE → Skip Summary API (save API call)
```

### Configuration

Enable/disable via environment variable:

```bash
# Enable (default)
USE_HEADER_FIRST_STRATEGY=true

# Disable (use old approach - always call Summary)
USE_HEADER_FIRST_STRATEGY=false
```

### Metrics

The logs now show:
```
[MatchMonitor] Stats: X partidas ativas, Y eventos postados, Header checks: H, Summary saved: S (próximo poll em Zs)
```

- **Header checks**: Number of times Header API was called
- **Summary saved**: Number of times Summary API was SKIPPED (no changes detected)

### Files Modified

- `src/bot/matchMonitor.js` - Integrated Header-First strategy
- `src/config.js` - Added `useHeaderFirstStrategy` config option
- `.env.example` - Added `USE_HEADER_FIRST_STRATEGY` documentation

### Files Created

- `src/api/fastcast.js` - Header API client module
- `docs/espn-fastcast-study.md` - This document
- `scripts/test-*.js` - Test and discovery scripts

---

## Expected Benefits

| Scenario | Old Approach | With Header-First |
|----------|--------------|-------------------|
| Live match, no events | Call Summary every poll | Skip Summary if no change |
| Live match, events occur | Call Summary every poll | Call Summary when change detected |
| API calls per hour (1 live match, no events) | ~60 calls | ~60 Header + ~0-5 Summary |

The strategy reduces Summary API calls when the match state hasn't changed, while still detecting all important events (goals, substitutions, etc.) via the Header's `lastPlay` field.

---

## Recommendations

1. **Enable by default** - The Header-First strategy is enabled by default
2. **Monitor metrics** - Watch the "Summary saved" counter in logs
3. **Disable if issues** - Set `USE_HEADER_FIRST_STRATEGY=false` if problems arise
4. **Don't rely on Fastcast** - It's internal and inaccessible

---

*Generated: February 2026*
