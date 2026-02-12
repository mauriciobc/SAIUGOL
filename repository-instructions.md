# Instruções para agentes de IA — SAIUGOL

Bot Mastodon que monitora partidas de futebol (ESPN) e posta eventos ao vivo (gols, cartões, etc.). Node.js ESM, sem framework.

---

## Arquitetura em poucas linhas

- **Entrada:** `src/index.js` — ordem: carrega config → i18n → verifica Mastodon (`verifyCredentials`) → `initialize()` do monitor → **`await whenReady()`** (state) → `startMonitoring()`. O `whenReady()` **precisa** ser aguardado antes do primeiro poll para evitar race após restart (o poll usa `getPreviousSnapshot` restaurado do disco).
- **Orquestração:** `src/bot/matchMonitor.js` — por liga: `getTodayMatches(league.code)` → `matchesToSnapshotMap(matches)` → `computeDiff(leagueCode, newSnapshotMap, getPreviousSnapshot)` → trata só **match_start** e **match_end** (post + addActiveMatch / handleMatchEnd + clearMatchState); **score_changed** é retornado pelo diff mas não é usado pelo monitor. Merge de snapshots com `mergePreviousSnapshots(allSnapshotEntries)`. Para partidas ao vivo chama `pollMatchEvents` (getLiveEvents + getMatchDetails → `normalizeMatchData` → eventProcessor → formatter → Mastodon). **Intervalo até o próximo poll:** se há partida ao vivo → `pollIntervalLiveMs`; se só há "pre" com `startTime` → próximo poll = min(horário 10 min antes da partida, `pollIntervalHibernationMs`, `pollScheduleRefreshMaxMs`), senão `pollIntervalAlertMs`; sem "pre" → `pollIntervalHibernationMs`. O schedule é revalidado no máximo a cada `pollScheduleRefreshMaxMs` (ex.: 1h).
- **Estado:** `src/state/matchState.js` — Maps em memória: **activeMatches** (chave = `matchId` string), **postedEventIds** (Set), **lastScores** (chave = matchId), **previousSnapshots** (chave = `leagueCode:matchId`), **recoveredActiveKeys** (Set de `leagueCode:matchId`). Inicialização chama `loadState()` e restaura esses dados; `whenReady()` resolve quando o load termina; fora de test inicia timer de save; shutdown chama `stopPeriodicSave()` e `saveStateNow()`.
- **Contrato de snapshot:** `src/state/snapshotContract.js` — formato único para diff: `id`, `score`, `status` ('pre'|'in'|'post'), `gameTime`. `matchesToSnapshotMap(matches)` e `espnEventToSnapshot(event)` leem o JSON normalizado da ESPN; alterações na API ESPN devem ser refletidas aqui (e no normalizador em `espn.js`).
- **Diff:** `src/state/diffEngine.js` — recebe `leagueCode`, mapa novo keyed por **matchId**, e callback `getPreviousSnapshot(compositeKey)`. Retorna `actions` (match_start, match_end, score_changed) e `snapshotEntries` (pares `[compositeKey, snapshot]`) para merge. Chave composta sempre **`leagueCode:matchId`** (ex.: `bra.1:401547893`).
- **Persistência:** `src/state/persistence.js` — `loadState()` retorna `{ postedEventIds: Set, matchSnapshots: object, activeMatchKeys: string[] }`; `saveState(postedEventIds, matchSnapshots, activeMatchKeys)` aceita Map ou objeto em matchSnapshots. Diretório: **STATE_DIR** (env) ou `/app/data`. Escrita atômica (arquivo .tmp + rename).
- **APIs ESPN:** `src/api/espn.js` — todas as funções **exigem leagueCode** (ex.: bra.1): `getTodayMatches(leagueCode)`, `getMatchDetails(matchId, leagueCode)`, `getLiveEvents(matchId, leagueCode)`, `getHighlights(matchId, leagueCode)`. Data do scoreboard: `getDateStringFor(new Date(), config.timezone)` em `dateUtils.js`. Cache (NodeCache), retry e (opcional) DEBUG_API.
- **Config:** `src/config.js` — lê env na carga; ligas em `src/data/leagues.js`. Validação falha cedo (throw). **LEAGUE_CODES** ou **LEAGUE_CODE** (fallback bra.1); **TIMEZONE** ou **TZ** (IANA); token: **MASTODON_ACCESS_TOKEN**, **MASTODON_ACCESS_TOKEN_FILE** ou secret Docker.

---

## Fluxo de dados (resumido)

1. **Poll:** Por liga, `getTodayMatches(league.code)` usa data `getDateStringFor(hoje, config.timezone)` → lista de partidas normalizadas.
2. **Snapshot:** Lista → `matchesToSnapshotMap` → mapa **matchId → MatchSnapshot** (só matchId como chave no mapa novo).
3. **Diff:** `computeDiff(leagueCode, newSnapshotMap, getPreviousSnapshot)` — internamente monta `compositeKey = leagueCode:matchId` e chama `getPreviousSnapshot(compositeKey)`. Retorna ações + entries; o monitor trata apenas match_start e match_end; faz merge com `mergePreviousSnapshots(allSnapshotEntries)`.
4. **Partidas ao vivo:** Para cada partida com status "in", getLiveEvents + getMatchDetails → **normalizeMatchData** (matchMonitor) → eventProcessor (eventId, isEventPosted/markEventPosted) → formatter → postStatus/postThread.
5. **Persistência:** Save grava postedEventIds (array), matchSnapshots (objeto keyed por compositeKey), activeMatchKeys (array de compositeKeys das partidas "in"). No load, activeMatchKeys viram **recoveredActiveKeys**; no primeiro poll, partidas com compositeKey em recoveredActiveKeys entram no fluxo de catch-up (já ao vivo ao reiniciar).

---

## Variáveis de ambiente e uso em código

- **STATE_DIR:** Onde fica `state.json`. Default `/app/data`. Testes **devem** setar para diretório temporário (ex.: mkdtempSync) e restaurar no afterEach para não poluir estado real.
- **NODE_ENV=test:** Desliga o timer de save periódico em matchState; logger em nível silent. Sem isso, testes de state podem deixar timers ativos.
- **DRY_RUN=true:** Nenhum post é enviado; `verifyCredentials` ainda é chamado, mas falha de credencial **não** encerra o processo (só encerra quando `!config.bot.dryRun`).
- **LEAGUE_CODES** (ou LEAGUE_CODE): Lista de ligas; usado em `config.activeLeagues`. Códigos válidos em `src/data/leagues.js`.
- **TIMEZONE / TZ:** IANA; usado em config.timezone e em `getDateStringFor` para a data do scoreboard ESPN. Não confundir com locale de exibição (i18n).
- **DEBUG_API=true:** Logs extras em chamadas ESPN (espn.js). **LOG_LEVEL:** Usado pelo logger (ex.: 'info', 'debug').
- **POLL_WINDOW_BEFORE_MATCH_MS:** Janela em ms antes do horário agendado para começar a pollar (default 600000 = 10 min). Só aplica quando há partidas "pre" com `startTime` válido.
- **POLL_SCHEDULE_REFRESH_MAX_MS:** Máximo de ms entre polls quando só há partidas "pre" (refresh do schedule; default 3600000 = 1h). Garante que mudanças de horário/adiamentos sejam capturadas.

Não inventar variáveis: as que afetam comportamento vêm de `config.js` e de persistence/espn/logger; novas entradas de config devem seguir o padrão (parseEnvInt, resolveTimezone, etc.).

---

## Regras de chaves e identificadores

- **matchId:** Sempre normalizar para string em lookups (ex.: `String(matchId)` ou helper `mid` em matchState). activeMatches e lastScores usam **matchId** como chave.
- **compositeKey:** Sempre **`leagueCode:matchId`** (ex.: `bra.1:123`). Usado em: previousSnapshots, activeMatchKeys (persistido), recoveredActiveKeys, snapshotEntries do diff, e no callback `getPreviousSnapshot(compositeKey)`.
- **eventId (postedEventIds):** Formato estável para evitar duplicata: ex. `${matchId}-match-start`, `${matchId}-${event.id}` no eventProcessor. Catch-up de match start usa o mesmo formato que o handler de match_start (ver teste em matchState.init.test.js).

---

## Desenvolvimento e testes

- **Scripts:** `npm start`, `npm run dev` (node --watch), `npm test` (NODE_ENV=test + node --test).
- **Testes:** `node:test` em `tests/*.test.js`. Para persistência/state: setar **STATE_DIR** para dir temporário antes de importar matchState/persistence e restaurar no afterEach (ex.: persistence.test.js, matchState.init.test.js).
- **Um arquivo:** `NODE_ENV=test node --test tests/persistence.test.js`.
- **Integração:** `tests/integration.test.js` chama ESPN e Mastodon reais. O teste usa uma liga de teste (`TEST_LEAGUE`, ex.: `'bra.1'`) e **passa leagueCode em todas as chamadas ESPN**: `getTodayMatches(leagueCode)`, `getMatchDetails(matchId, leagueCode)`, `getLiveEvents(matchId, leagueCode)`, `getHighlights(matchId, leagueCode)`, mantendo as assinaturas alinhadas com produção.
- **Fixtures:** `tests/fixtures/` (ex.: matchScheduleFixture.js) para dados reutilizáveis em testes.
- **Dry-run:** `DRY_RUN=true` para testar sem postar; credencial ainda é validada, mas falha não derruba o processo.

---

## Convenções do projeto

- Comentários e logs em português; identificadores (funções, variáveis) em inglês.
- Timezone: data do scoreboard = “hoje” em `config.timezone`; usar `getDateStringFor(date, timezone)` (dateUtils), testável sem env.
- Correção de bugs: seguir `.cursor/rules/ai-fix-protocol.mdc` (detectar → hipóteses → correção mínima → validar com testes).

---

## Arquivos-chave por tema

| Tema | Arquivos |
|------|----------|
| Entrada e ciclo de vida | `src/index.js`, `src/bot/matchMonitor.js` (testes: `tests/matchMonitor.test.js`) |
| Estado e persistência | `src/state/matchState.js`, `src/state/persistence.js`, `src/state/snapshotContract.js`, `src/state/diffEngine.js` |
| Contrato e diff | `src/state/snapshotContract.js` (MatchSnapshot, normalizeStatus, matchesToSnapshotMap) |
| Eventos e posts | `src/bot/eventProcessor.js`, `src/bot/formatter.js`, `normalizeMatchData` em matchMonitor.js, `src/api/mastodon.js` |
| Config e ligas | `src/config.js`, `src/data/leagues.js` |
| ESPN e data | `src/api/espn.js`, `src/utils/dateUtils.js` |
| Testes state/persistence | `tests/persistence.test.js`, `tests/matchState.init.test.js`, `tests/snapshotContract.test.js`, `tests/timezoneMatchState.test.js`, `tests/fixtures/` |

---

## Integração externa

- **ESPN:** Scoreboard (dates=YYYYMMDD), summary (event=id), CDN fallback; sem API key. PT: **ESPN_USE_PT_DESCRIPTIONS=true** (site.web.api.espn.com, lang=pt&region=br).
- **Mastodon:** Token por env, _FILE ou Docker secret; verifyCredentials na subida; postStatus/postThread.
- **Estado em disco:** Um arquivo em STATE_DIR; versão no JSON (ex.: 1.1). Set/Map serializados como array e objeto; chaves de matchSnapshots e activeMatchKeys são compositeKey (leagueCode:matchId).

Se algo ficar obscuro ou faltar (fluxo, variável, teste), indique o trecho para iterar.
