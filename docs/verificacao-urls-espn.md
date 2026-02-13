# Verificação: endpoints e formação de URLs ESPN

Todos os tipos de uso da API ESPN no projeto foram verificados. Resumo abaixo.

---

## 1. Onde as URLs são formadas

| Função / uso | Arquivo | URL usada | Respeita `ESPN_USE_PT_DESCRIPTIONS`? |
|--------------|---------|-----------|-------------------------------------|
| **getTodayMatches** (scoreboard) | `src/api/espn.js` | `BASE_URL` ou `CDN_URL` + `/{leagueCode}/scoreboard?dates={date}` ou CDN `?xhr=1&dates=...&league={leagueCode}` | Não (scoreboard não usa PT) |
| **getMatchDetails** | `src/api/espn.js` | `getSummaryUrl(leagueCode, matchId)` | Sim |
| **getLiveEvents** | `src/api/espn.js` | `getSummaryUrl(leagueCode, matchId)` | Sim |
| **getHighlights** | `src/api/espn.js` | `getSummaryUrl(leagueCode, matchId)` | Sim |
| **fetch-espn-events-to-markdown.js** | `scripts/` | Antes: só `BASE_URL` + summary sem lang. Ajustado para usar mesma lógica de summary com PT quando env. | Sim (após ajuste) |

---

## 2. Formação correta das URLs

### getSummaryUrl (summary para detalhes, eventos ao vivo e highlights)

```js
// src/api/espn.js
function getSummaryUrl(leagueCode, matchId) {
    const base = config.espn.usePortugueseDescriptions ? WEB_BASE_URL : BASE_URL;
    const qs = config.espn.usePortugueseDescriptions ? '&lang=pt&region=br' : '';
    return `${base}/${leagueCode}/summary?event=${matchId}${qs}`;
}
```

- **PT:** `https://site.web.api.espn.com/apis/site/v2/sports/soccer/{leagueCode}/summary?event={matchId}&lang=pt&region=br`
- **EN:** `https://site.api.espn.com/apis/site/v2/sports/soccer/{leagueCode}/summary?event={matchId}`

Ordem e nome dos parâmetros estão corretos; `leagueCode` (ex.: `bra.1`) e `matchId` (numérico) não precisam de encoding na prática.

### Scoreboard

- **Principal:** `https://site.api.espn.com/apis/site/v2/sports/soccer/{leagueCode}/scoreboard?dates={YYYYMMDD}`
- **CDN fallback:** `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&dates={YYYYMMDD}&league={leagueCode}`

Ambos corretos. O scoreboard hoje não usa a API web nem `lang=pt`; só lista de jogos, placar e status (nomes em EN quando vierem da API).

---

## 3. Tipos de “evento” e endpoint usado

Todos os **eventos ao vivo** (gol, cartão, substituição, VAR, intervalo, etc.) vêm do **summary** via `getLiveEvents` → `getSummaryUrl`. Ou seja:

- Um único endpoint (summary) com uma única URL (getSummaryUrl) cobre todos os tipos de evento.
- Não há outro path ou query para “tipos” diferentes; a diferenciação é só no conteúdo de `keyEvents[]` (type.text, etc.).

Resumo:

- **Lista de jogos do dia** → scoreboard (BASE_URL ou CDN).
- **Detalhe do jogo (header, placar, etc.)** → summary (getSummaryUrl).
- **Eventos ao vivo (keyEvents)** → summary (getSummaryUrl).
- **Highlights (videos)** → summary (getSummaryUrl).

Todos os usos de summary no bot passam por `getSummaryUrl`, então estão consistentes e corretos para PT quando `ESPN_USE_PT_DESCRIPTIONS=true`.

---

## 4. Conclusão

- **Chamadas e URLs estão corretas** para todos os tipos de uso no `src/api/espn.js`: scoreboard, details, live events e highlights.
- **Summary** está centralizado em `getSummaryUrl` e respeita `ESPN_USE_PT_DESCRIPTIONS` para detalhes, eventos e highlights.
- **Scoreboard** não usa PT; é decisão atual (se no futuro quiser nomes em PT no feed, dá para usar a API web com `lang=pt` no scoreboard).
- **Script** `scripts/fetch-espn-events-to-markdown.js` foi ajustado para usar a mesma lógica de URL do summary (PT quando `ESPN_USE_PT_DESCRIPTIONS=true`).

---

## 5. Endpoints sem lang=pt e corpo do toot

**Endpoints que não usam/suportam lang=pt:**

| Endpoint | Uso no código | Conteúdo no body do toot? |
|----------|----------------|----------------------------|
| **Scoreboard** (`getTodayMatches`) | Lista de jogos do dia | **Não** — retorna só lista (id, times, placar, status). Nunca é usado como descrição (📝) no toot. |

**Summary sem lang=pt:** Quando o usuário **não** define `ESPN_USE_PT_DESCRIPTIONS=true` no `.env`, o summary é chamado sem `&lang=pt&region=br` e a API devolve descrições em inglês. Isso é **válido** — o usuário optou por não usar PT. O bloco 📝 (descrição da API) continua sendo incluído no toot nesse caso; apenas o scoreboard não fornece e não deve fornecer descrição no body. Linguagens válidas para o projeto: `docs/linguagens-validas.md`.
