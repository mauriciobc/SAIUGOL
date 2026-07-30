# Instruções para agentes de IA — SAIUGOL

Bot Mastodon que monitora partidas de futebol (ESPN) e posta eventos ao vivo (gols, cartões, etc.). Node.js ESM, sem framework.

---

## Arquitetura em poucas linhas

- **Entrada:** `src/index.js` — ordem: carrega config (lazy) → i18n → verifica Mastodon (`verifyCredentials`) → `initialize()` do monitor → **`await whenReady()`** (state) → `startMonitoring()` → `startMentionListener(...)`. No shutdown: **`stopMonitoring()`** antes de `shutdownState()`. O `whenReady()` **precisa** ser aguardado antes do primeiro poll para evitar race após restart.
- **Orquestração:** `src/bot/matchMonitor.js` — por liga: `getTodayMatches(league.code)` → `matchesToSnapshotMap(matches)` → `computeDiff(...)` → trata só **match_start** e **match_end**; **score_changed** é retornado pelo diff mas **intencionalmente não é usado** pelo monitor (placar vem dos eventos ESPN). Poll elástico via `setTimeout` + **`stopMonitoring()`** para cancelar o timer. Cada poll chama `logMetrics()`; erros de liga/digest/preview incrementam `recordBotError()`.
- **Estado:** `src/state/matchState.js` — Maps em memória: **activeMatches**, **postedEventIds**, **pendingGoals**, **pendingPenalties**, **pendingDelayStarts**, **previousSnapshots**, **recoveredActiveKeys**. `whenReady()` restaura do disco; `saveStateNow()` persiste tudo (schema **1.2**).
- **Confirmação ESPN:** `src/bot/confirmationLifecycle.js` — `decideConfirmationStep` (FSM pura) usada por gols, pênaltis perdidos e atrasos de partida em `eventProcessor.js`.
- **Parsers de texto:** `src/domain/eventTextParsers.js` — fonte única para substituição, scorer, texto provisório e motivo de atraso; reexportados por `formatter.js` / `espn.js`.
- **Formatters:** `src/bot/formatter.js` é barrel fino sobre `src/bot/formatters/` (scoring, cards, match phases, digest).
- **Categorização:** `src/bot/eventCategorization.js` — `categorizeEvent` + mapas `ID_TO_CATEGORY` / keywords; reexportado por `eventProcessor.js`.
- **Contrato de snapshot:** `src/state/snapshotContract.js` — `id`, `score`, `status` ('pre'|'in'|'post'), `gameTime`.
- **Diff:** `src/state/diffEngine.js` — ações `match_start` | `match_end` | `score_changed`; chave composta **`leagueCode:matchId`**.
- **Persistência:** `src/state/persistence.js` — `loadState()` / `saveState(..., pendingGoals, pendingPenalties, pendingDelayStarts)`; **version `'1.2'`**; **STATE_DIR** (env) ou `/app/data`; escrita atômica (.tmp + rename).
- **APIs ESPN:** `src/api/espn.js` — funções exigem `leagueCode`; cache + retry + **`getBreaker('espn')`** em chamadas de rede; métricas via `recordEspnRequest`.
- **Config:** `src/config.js` — **lazy**: import não valida; `getConfig()` (e o Proxy `config`) validam no primeiro acesso. Ligas em `src/data/leagues.js`.

---

## Fluxo de dados (resumido)

1. **Poll:** Por liga, `getTodayMatches(league.code)` usa data `getDateStringFor(hoje, config.timezone)`.
2. **Snapshot → Diff:** `matchesToSnapshotMap` → `computeDiff` → monitor trata match_start/match_end; merge com `mergePreviousSnapshots`.
3. **Ao vivo:** getLiveEvents + getMatchDetails → normalizeMatchData → eventProcessor (FSM de confirmação + `recordEventPosted`) → formatters → Mastodon.
4. **Persistência:** Save grava postedEventIds, matchSnapshots, activeMatchKeys, lastDigestDate, lastNotificationId, pendingGoals, pendingPenalties, **pendingDelayStarts** (v1.2).

---

## Variáveis de ambiente e uso em código

- **Listagem única:** Variáveis no **Dockerfile** / `.env.example`. Em produção sobrescreva no runtime — em especial **MASTODON_ACCESS_TOKEN**.
- **STATE_DIR:** Onde fica `state.json`. Default `/app/data`. Testes devem usar dir temporário.
- **NODE_ENV=test:** Desliga timer de save periódico; logger silent.
- **DRY_RUN=true:** Não posta; falha de credencial não encerra o processo.
- **LEAGUE_CODES** / **LEAGUE_CODE**, **TIMEZONE** / **TZ**, **DEBUG_API**, **DEBUG_EVENTS**, **LOG_LEVEL**, intervalos de poll elástico (`POLL_INTERVAL_*`, `POLL_WINDOW_BEFORE_MATCH_MS`, `POLL_SCHEDULE_REFRESH_MAX_MS`).

Não inventar variáveis: novas entradas seguem o padrão em `config.js` (`parseEnvInt`, etc.).

---

## Regras de chaves e identificadores

- **matchId:** Sempre string em lookups (`mid` em matchState).
- **compositeKey:** Sempre **`leagueCode:matchId`**.
- **eventId:** Formatos estáveis (`${matchId}-match-start`, `${matchId}-${event.id}`, `${matchId}-delay-start-${minute}`, etc.).

---

## Desenvolvimento e testes

- **Scripts npm:** `npm start`, `npm run dev`, `npm test`.
- **Helpers manuais (fora de `src/`):** `npm run test:post`, `npm run test:translation`, `npm run check:leagues`, `npm run find:matches`, `npm run mock:stream`, etc. — todos sob `scripts/`.
- **Testes:** `node:test` em `tests/*.test.js`. Setar **STATE_DIR** e **MASTODON_ACCESS_TOKEN** (≥10 chars) nos testes que importam config/state.
- **Integração:** `tests/integration.test.js` chama ESPN/Mastodon reais com `leagueCode` explícito.

---

## Convenções do projeto

- Comentários e logs em português; identificadores em inglês.
- Hot path de bot usa pino (`createChild` / loggers de componente), não `console.*`.
- Correção de bugs: seguir `.cursor/rules/ai-fix-protocol.mdc`.

---

## Arquivos-chave por tema

| Tema | Arquivos |
|------|----------|
| Entrada e ciclo de vida | `src/index.js`, `src/bot/matchMonitor.js` (`stopMonitoring`) |
| Config lazy | `src/config.js` (`getConfig`, Proxy `config`) |
| Estado e persistência | `src/state/matchState.js`, `src/state/persistence.js` (v1.2 + pendingDelayStarts) |
| Confirmação / categorização | `src/bot/confirmationLifecycle.js`, `src/bot/eventCategorization.js`, `src/bot/eventProcessor.js` |
| Formatters | `src/bot/formatter.js` + `src/bot/formatters/*` |
| Parsers de domínio | `src/domain/eventTextParsers.js` |
| Métricas / breaker | `src/utils/metrics.js`, `src/utils/circuitBreaker.js` (ESPN wired) |
| ESPN / Mastodon | `src/api/espn.js`, `src/api/mastodon.js` |
| Helpers manuais | `scripts/` (não colocar em `src/`) |

---

## Integração externa

- **ESPN:** Scoreboard / summary / CDN fallback; circuit breaker `espn`; PT via **ESPN_USE_PT_DESCRIPTIONS=true**.
- **Mastodon:** Token por env / `_FILE` / Docker secret; `recordMastodonPost` nas postagens.
- **Estado em disco:** Um arquivo em STATE_DIR; **version `1.2`** inclui pendingGoals, pendingPenalties e pendingDelayStarts.

Se algo ficar obscuro ou faltar (fluxo, variável, teste), indique o trecho para iterar.
