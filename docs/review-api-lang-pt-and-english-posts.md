# Revisão: chamadas sem lang=PT e consistência dos posts em inglês

Revisão do codebase para (1) identificar qualquer chamada à API ESPN sem `lang=pt` quando deveria ter; (2) verificar se os posts em inglês são consistentes com o uso desses endpoints. **Nenhuma correção foi aplicada** até termos certeza da causa raiz.

---

## 1. Inventário de todas as chamadas à API ESPN

### 1.1 `src/api/espn.js` (único módulo que monta URLs e faz HTTP à ESPN)

| Função | URL usada | Usa `lang=pt`? | Dado que afeta o toot? |
|--------|-----------|----------------|-------------------------|
| **getTodayMatches** | `BASE_URL` ou `CDN_URL` + `.../scoreboard?dates=...` | **Não** (scoreboard não tem parâmetro lang) | **Não** – retorna lista de jogos (id, times, placar, status). Não retorna `keyEvents` nem descrição. |
| **getMatchDetails** | `getSummaryUrl(leagueCode, matchId)` | **Sim**, quando `config.espn.usePortugueseDescriptions === true` | **Não** – retorna header (times, placar, estádio). Não retorna o texto da descrição do evento. |
| **getLiveEvents** | `getSummaryUrl(leagueCode, matchId)` | **Sim**, quando `config.espn.usePortugueseDescriptions === true` | **Sim** – retorna `keyEvents`; `keyEvents[].text` vira `event.description` e é o **único** conteúdo que vai no bloco 📝 do toot. |
| **getHighlights** | `getSummaryUrl(leagueCode, matchId)` | **Sim**, quando `config.espn.usePortugueseDescriptions === true` | Opcional – `videos[].headline` pode ser EN/PT; não é o mesmo campo que as descrições de eventos. |

Resumo: **Nenhuma chamada que alimenta o texto 📝 do toot (descrição do evento) é feita sem passar por `getSummaryUrl`.** A única fonte desse texto é `getLiveEvents` → `getSummaryUrl` → `keyEvents[].text`.

### 1.2 Uso de `getSummaryUrl`

- `getSummaryUrl` é a **única** função que monta a URL do summary.
- Ela usa `config.espn.usePortugueseDescriptions` (carregado uma vez na inicialização a partir de `process.env.ESPN_USE_PT_DESCRIPTIONS === 'true'`).
- Quando `true`: `WEB_BASE_URL` + `&lang=pt&region=br`.
- Quando `false` ou não definido: `BASE_URL`, sem query de idioma.

Não existe outro path no bot que chame summary com URL construída à mão (por exemplo, só `BASE_URL` + summary). Ou seja, **não há chamada “esquecida” sem lang=pt** no fluxo que gera o texto dos toots.

### 1.3 Chamadas que não usam lang=pt (e por que não explicam os toots em inglês)

- **getTodayMatches (scoreboard):** usa só `site.api.espn.com` ou CDN. Não usa `lang=pt`.  
  O scoreboard **não** contém `keyEvents` nem descrições de eventos; só lista de partidas. Portanto, **não pode** ser a origem do texto em inglês nos toots.

- **Script `fetch-espn-events-to-markdown.js`:**  
  - Scoreboard: usa `BASE_URL` (sem lang).  
  - Summary: usa `getSummaryUrl` do script (com `ESPN_USE_PT_DESCRIPTIONS`).  
  O script não posta toots; só gera relatório em markdown. Não afeta o conteúdo postado pelo bot.

### 1.4 Quem chama as funções ESPN no bot

- **matchMonitor.js:**  
  - `getTodayMatches(league.code)` – scoreboard (sem lang; não gera descrição).  
  - `getMatchDetails(matchId, league.code)` – summary via `getSummaryUrl` (respeita PT).  
  - `getLiveEvents(matchId, league.code)` – summary via `getSummaryUrl` (respeita PT); **única fonte** das descrições que viram 📝.

- **eventProcessor.js:**  
  - `getHighlights(match.id, match.league?.code)` – summary via `getSummaryUrl` (respeita PT).

Todos os consumidores de summary no bot usam o módulo `src/api/espn.js`, que centraliza a URL em `getSummaryUrl`. Não há chamada direta a `BASE_URL`/summary em nenhum outro arquivo do bot.

---

## 2. Consistência dos posts em inglês com o uso dos endpoints

### 2.1 Formato dos posts em inglês observados

Exemplos (do perfil @saiugol e dos logs):

- `"Lucas Evangelista (Palmeiras) Substitution at 81'"`
- `"Agustín Giay (Palmeiras) Substitution at 81'"`
- `"Vitor Roque (Palmeiras) Goal at 52'"`
- `"Paulinho (Internacional) Yellow Card at 55'"`
- `"Félix Torres (Internacional) Substitution at 51'"`

Ou seja: padrão **curto** `"X (Team) [Substitution|Goal|Yellow Card] at NN'"`.

### 2.2 O que a API devolve hoje quando chamada **sem** lang=pt (EN)

Requisição direta a `site.api.espn.com/.../summary?event=401840997` (sem `lang=pt`):

- **Substitution:**  
  `"text": "Substitution, Palmeiras. Lucas Evangelista replaces Allan."`  
  (formato **longo**, não “X (Team) Substitution at 81'”.)
- **Yellow card:**  
  `"text": "Paulinho Paula (Internacional) is shown the yellow card for a bad foul."`  
  (frase longa, não “X (Team) Yellow Card at 55'”.)
- **Goal:**  
  `"text": "Goal! Internacional 1, Palmeiras 2. Vitor Roque (Palmeiras) right footed shot..."`  
  (longo, não “Vitor Roque (Palmeiras) Goal at 52'”.)

Conclusão: o formato **exato** dos posts em inglês que vimos **não coincide** com o formato atual da API em inglês (sem lang=pt). A API EN que testamos devolve descrições longas, não o padrão curto “X (Team) … at NN'”.

### 2.3 Implicação

- **Se** a causa fosse apenas “chamada sem lang=pt”, seria de esperar o mesmo formato que a API EN devolve hoje (frases longas em inglês). Não é o que apareceu nos toots.
- O formato curto em inglês sugere pelo menos uma das seguintes possibilidades:
  1. A API ESPN às vezes devolve esse formato curto (em EN ou em outro contexto), mesmo com `lang=pt` (variação/inconsistência da API).
  2. Em algum momento no passado a API EN devolveu esse formato curto.
  3. Outro fator (ex.: cache, outro endpoint ou variante de resposta) que não está reproduzido nos testes atuais.

Por isso, **não é possível afirmar que a causa raiz dos posts em inglês é “falta de lang=pt” nas chamadas**. Os posts em inglês **não** estão claramente consistentes com “sempre chamamos o endpoint EN (sem lang=pt)” no formato que a API EN nos devolve hoje.

---

## 3. Conclusão da revisão

1. **Chamadas sem lang=pt:**  
   - No fluxo do **bot**, **não há** chamada à API ESPN que alimente o texto 📝 do toot e que bypass ou ignore `getSummaryUrl`.  
   - A única fonte desse texto é `getLiveEvents` → `getSummaryUrl`, que **usa** lang=pt quando `ESPN_USE_PT_DESCRIPTIONS=true`.  
   - O único endpoint que não usa lang=pt é o **scoreboard** (getTodayMatches), e ele **não** fornece descrições de eventos.

2. **Consistência com os posts em inglês:**  
   - O formato dos posts em inglês (“X (Team) Substitution/Goal/Yellow Card at NN'”) **não** bate com o formato atual da API em inglês (descrições longas).  
   - Portanto, **não estamos em condições de dizer que a causa raiz é “chamada sem lang=pt”**. Pode ser variabilidade da API ou outro fator.

3. **Recomendação:**  
   - **Não aplicar correções** que assumam que a causa raiz é “falta de lang=pt” (por exemplo, forçar lang=pt em mais lugares ou “corrigir” supostas chamadas faltantes), até que se tenha evidência mais clara (por exemplo: log de startup com `espnUsePtDescriptions`, reprodução do formato curto em EN com uma URL específica, ou confirmação da ESPN sobre formatos de resposta).  
   - Opcional: em ambiente de produção, garantir que o log de startup (`espnUsePtDescriptions: true/false`) seja persistido para as próximas ocorrências de toots em inglês.
