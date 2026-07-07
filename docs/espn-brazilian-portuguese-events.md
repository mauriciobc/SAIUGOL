# Descrições de eventos em português brasileiro (ESPN)

Para receber descrições de eventos (gols, substituições, cartões, etc.) em **português brasileiro**, use a API “web” com `lang=pt` e `region=br`:

- **URL base**: `https://site.web.api.espn.com/apis/site/v2/sports/soccer`
- **Exemplo summary**: `…/bra.1/summary?event=401840990&lang=pt&region=br`

A API “default” (`site.api.espn.com` sem `lang`) devolve textos em **inglês**.

**No SAIUGOL:** defina `ESPN_USE_PT_DESCRIPTIONS=true` no `.env` para o bot usar essa API e receber descrições em PT. Os tipos de evento em português (“Gol”, “substituição”, etc.) e o padrão de substituição (“entra em campo X substituindo Y.”) já são reconhecidos pelo código.

**Catálogo completo (auditoria 2026):** [`data/event-type-audit/type-catalog-2026.json`](../data/event-type-audit/type-catalog-2026.json) — gerado por `node scripts/audit-espn-event-types.js`.

---

## Catálogo de typeIds (EN → PT → categoria do bot)

Mapeamento observado em amostra de 50 partidas de 2026 (`bra.1`, `fifa.world`). A coluna **Categoria bot** reflete `ID_TO_CATEGORY` + fallback por texto em [`src/bot/eventProcessor.js`](../src/bot/eventProcessor.js).

| typeId | Inglês (API default) | Português (lang=pt) | Categoria bot | Notas |
|--------|----------------------|---------------------|---------------|-------|
| 70 | Goal | Gol | GOAL | |
| 76 | Substitution | Substituição | SUBSTITUTION | |
| 80 | Kickoff | Começo | MATCH_START | Kickoff também postado via diffEngine (`{matchId}-match-start`) |
| 81 | Halftime | Intervalo | HALF_TIME | |
| 82 | Start 2nd Half | Começo do 2º tempo | SECOND_HALF_START | |
| 83 | End Regular Time | Fim do Tempo Regulamentar | END_REGULAR_TIME | Fim do 2º tempo (90 min); distinto de fim de jogo |
| 84 | Start Extra Time | Começo da prorrogação | EXTRA_TIME_START | |
| 85 | Halftime Extra Time | Intervalo da prorrogação | EXTRA_TIME_HALF | |
| 86 | Start 2nd Half Extra Time | Começo do 2º tempo da prorrogação | EXTRA_TIME_SECOND_HALF | |
| 87 | End Extra Time | Fim da prorrogação | EXTRA_TIME_END | |
| 88 | Start Shootout | Começo da disputa de pênaltis | SHOOTOUT_START | |
| 89 | End Match | Fim de jogo | — (SKIP) | Bloqueado por `SKIP_TYPE_IDS`; evita duplicar `handleMatchEnd` |
| 93 | Red Card | Cartão vermelho | RED_CARD | Mapeado por typeId |
| 94 | Yellow Card | Cartão amarelo | YELLOW_CARD | |
| 97 | Own Goal | Gol contra | GOAL | |
| 98 | Penalty - Scored | Gol de pênalti | GOAL | |
| 114 | Penalty - Saved | Pênalti - defendido | PENALTY_MISSED | Texto PT usa hífen: `pênalti - defendido` |
| 129 | Start Delay | Jogo atrasado | MATCH_DELAY_START | Mensagem contextual (hidratação/lesão/genérico); dedup por minuto |
| 130 | End Delay | Fim do atraso | MATCH_DELAY_END | Retomada após pausa; dedup por minuto |
| 137 | Goal - Header | Gol de cabeça | GOAL | |
| 138 | Goal - Free-kick | Gol de falta | GOAL | Mapeado por typeId |
| 167 | VAR - (Red) Card Upgrade | VAR - (Red) Card Upgrade | VAR | Mapeado por typeId |
| 173 | Goal - Volley | Gol - Voleio | GOAL | |

---

## Pausas / hidratação (typeId 129 e 130)

A ESPN usa **Start Delay** / **End Delay** para qualquer interrupção temporária, não só hidratação:

| typeId | EN | PT | Exemplo EN | Exemplo PT |
|--------|----|----|------------|------------|
| 129 | Start Delay | Jogo atrasado | `Delay in match for a drinks break.` | `Partida interrompida devido a pausa para hidratação.` |
| 129 | Start Delay | Jogo atrasado | `Delay in match because of an injury ...` | `Partida interrompida devido a uma lesão de ...` |
| 130 | End Delay | Fim do atraso | `Delay over. They are ready to continue.` | `Partida recomeça.` |

Comum na Copa do Mundo (`fifa.world`). O bot posta esses eventos como `MATCH_DELAY_START` / `MATCH_DELAY_END`, com mensagem contextual parseada da descrição (hidratação, lesão ou genérico). A ESPN envia dois eventos por pausa (um por time); o bot deduplica por minuto e prefere o que tem descrição. Toggle: `EVENT_MATCH_DELAY=false` para desativar.

---

## Padrões de texto (event.text) em PT

### Começo do jogo
- `Início do primeiro tempo.`

### Gol
- `Gol! Atlético Mineiro 1, Remo 0. Hulk (Atlético Mineiro) finalização com o pé direito do meio da área ao ângulo superior direito.`
- Nome do artilheiro: mesmo padrão `Nome (Time)` após “Gol!” — o parser aceita tanto `Goal!` quanto `Gol!`.

### Pênalti defendido
- `Pênalti defendido! Lionel Messi (Argentina) perdeu uma oportunidade única...`

### Meio tempo / segundo tempo
- `Fim do primeiro tempo, Atlético Mineiro 1, Remo 1.`
- `Início do segundo tempo Atlético Mineiro 1, Remo 1.`

### Substituição (PT)
- `Substituição Atlético Mineiro, entra em campo Dudu substituindo Ángelo Preciado.`
- Padrão: **entra em campo** `[quem entra]` **substituindo** `[quem sai]`**.**

O parser usa o regex:  
`entra em campo\s+(nome)\s+substituindo\s+(nome)\.`  
para extrair “entra” e “sai” quando a descrição está em português.

### Cartão
- `João Pedro (Remo) recebe cartão amarelo por falta dura.`  
  (ou variantes; o tipo vem em `type.text`: "Cartão amarelo" / "Cartão vermelho".)

---

## PT descriptions vs. dicionário (i18n)

- **Descrições em PT (API):** usadas para **parsing** (nome do artilheiro, quem entra/sai na substituição) e para campos opcionais como o motivo do cartão (`event.reason`). O texto bruto da API não substitui o texto do post.
- **Dicionário (i18n):** continua a definir os **títulos e rótulos** dos posts (ex.: "Gol!", "Substituição", "Entra:", "Sai:"). O idioma do post é controlado por `DEFAULT_LANGUAGE`. Atualmente só **pt-BR** tem dicionário incluído; ver `docs/linguagens-validas.md`. Ativar PT descriptions não desativa o i18n.

## Resumo

- **Querer descrições em português** → usar `site.web.api.espn.com` com `lang=pt` e `region=br` no summary (e, se aplicável, scoreboard).
- **Tipos** → `type.text` vem em PT ("Gol", "substituição", "Meio tempo", etc.); o código trata PT e EN (incl. cartão vermelho/amarelo, own goal/autogol).
- **Substituição** → texto em PT usa “entra em campo X substituindo Y.”; os parsers em `espn.js` e `formatter.js` reconhecem esse padrão.
- **Gol** → texto em PT usa “Gol!” em vez de “Goal!”; o parser de artilheiro aceita os dois.
- **Auditoria** → rodar `SAMPLE_SIZE=50 YEAR=2026 node scripts/audit-espn-event-types.js` para atualizar o catálogo em `data/event-type-audit/`.
