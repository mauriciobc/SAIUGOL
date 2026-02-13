# Descrições de eventos em português brasileiro (ESPN)

Para receber descrições de eventos (gols, substituições, cartões, etc.) em **português brasileiro**, use a API “web” com `lang=pt` e `region=br`:

- **URL base**: `https://site.web.api.espn.com/apis/site/v2/sports/soccer`
- **Exemplo summary**: `…/bra.1/summary?event=401840990&lang=pt&region=br`

A API “default” (`site.api.espn.com` sem `lang`) devolve textos em **inglês**.

**No SAIUGOL:** defina `ESPN_USE_PT_DESCRIPTIONS=true` no `.env` para o bot usar essa API e receber descrições em PT. Os tipos de evento em português (“Gol”, “substituição”, etc.) e o padrão de substituição (“entra em campo X substituindo Y.”) já são reconhecidos pelo código.

---

## Tipos de evento (type.text) em PT

| Inglês (API default) | Português (lang=pt) |
|----------------------|---------------------|
| Kickoff              | Começo              |
| Goal                 | Gol                 |
| Goal - Header        | Gol de cabeça       |
| Penalty - Scored     | Pênalti convertido  |
| Substitution         | substituição        |
| Yellow Card          | Cartão amarelo      |
| Red Card             | Cartão vermelho     |
| Halftime             | Meio tempo          |
| Start 2nd Half       | Começo do 2º tempo  |
| Full Time            | Fim de jogo         |

O bot reconhece tanto os termos em inglês quanto em português para classificar o tipo do evento.

---

## Padrões de texto (event.text) em PT

### Começo do jogo
- `Início do primeiro tempo.`

### Gol
- `Gol! Atlético Mineiro 1, Remo 0. Hulk (Atlético Mineiro) finalização com o pé direito do meio da área ao ângulo superior direito.`
- Nome do artilheiro: mesmo padrão `Nome (Time)` após “Gol!” — o parser aceita tanto `Goal!` quanto `Gol!`.

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
