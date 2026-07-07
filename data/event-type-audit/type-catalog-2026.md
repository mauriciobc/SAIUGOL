# Catálogo de tipos de evento ESPN (2026)

Gerado em: 2026-07-07T17:05:47.726Z
Amostra: 50 partidas | 16 typeIds únicos | 0 gaps
Seed: 42 | Ano: 2026

---

## Resumo executivo

- **Partidas amostradas:** 50
- **Ligas com partidas:** bra.1, fifa.world
- **TypeIds únicos:** 16
- **Gaps (sem mapeamento no bot):** 0

---

## Catálogo completo

| typeId | EN | PT | Freq | Mapeamento atual | Recomendado |
|--------|----|----|------|------------------|-------------|
| 70 | Goal | Gol | 93 | GOAL | GOAL |
| 76 | Substitution | Substituição | 460 | SUBSTITUTION | SUBSTITUTION |
| 80 | Kickoff | Começo | 48 | MATCH_START | MATCH_START |
| 81 | Halftime | Intervalo | 48 | HALF_TIME | HALF_TIME |
| 82 | Start 2nd Half | Começo do 2º tempo | 48 | SECOND_HALF_START | SECOND_HALF_START |
| 83 | End Regular Time | Fim do Tempo Regulamentar | 48 | — | SKIP |
| 93 | Red Card | Cartão vermelho | 9 | RED_CARD | RED_CARD |
| 94 | Yellow Card | Cartão amarelo | 173 | YELLOW_CARD | YELLOW_CARD |
| 97 | Own Goal | Gol contra | 4 | GOAL | GOAL |
| 98 | Penalty - Scored | Gol de pênalti | 9 | GOAL | GOAL |
| 114 | Penalty - Saved | Pênalti - defendido | 2 | PENALTY_MISSED | PENALTY_MISSED |
| 129 | Start Delay | Jogo atrasado | 161 | MATCH_DELAY_START | MATCH_DELAY_START |
| 130 | End Delay | Fim do atraso | 161 | MATCH_DELAY_END | MATCH_DELAY_END |
| 137 | Goal - Header | Gol de cabeça | 17 | GOAL | GOAL |
| 138 | Goal - Free-kick | Goal - Falta | 4 | GOAL | GOAL |
| 173 | Goal - Volley | Gol - Voleio | 9 | GOAL | GOAL |

---

## Gaps prioritários

*Nenhum gap prioritário encontrado na amostra.*

---

## Hidratação / pausas (typeId 129 e 130)

### typeId 129 — Start Delay / Jogo atrasado

- Frequência na amostra: 161
- Ligas: fifa.world

**760467** (fifa.world, 22'):
- EN: Delay in match for a drinks break.
- PT: Partida interrompida devido a pausa para hidratação.

**760467** (fifa.world, 22'):

**760467** (fifa.world, 45'):
- EN: Delay in match because of an injury Michal Sadílek (Czechia).
- PT: Partida interrompida devido a uma lesão Michal Sadílek (Tcheca).

### typeId 130 — End Delay / Fim do atraso

- Frequência na amostra: 161
- Ligas: fifa.world

**760467** (fifa.world, 26'):
- EN: Delay over. They are ready to continue.
- PT: Partida recomeça.

**760467** (fifa.world, 26'):

---

## Diff sugerido para ID_TO_CATEGORY

```js
// Adicionar ao ID_TO_CATEGORY em src/bot/eventProcessor.js
```

---

## Partidas amostradas

| Data | Liga | Partida | Eventos |
|------|------|---------|---------|
| 20260426 | bra.1 | Red Bull Bragantino x Palmeiras (0-1) | 18 |
| 20260402 | bra.1 | Santos x Remo (2-0) | 22 |
| 20260624 | fifa.world | Czechia x Mexico (0-3) | 38 |
| 20260624 | fifa.world | Morocco x Haiti (4-2) | 45 |
| 20260625 | fifa.world | Tunisia x Netherlands (1-3) | 26 |
| 20260401 | bra.1 | Internacional x São Paulo (1-1) | 20 |
| 20260401 | bra.1 | Cruzeiro x Vitória (3-0) | 21 |
| 20260426 | bra.1 | Atlético-MG x Flamengo (0-4) | 20 |
| 20260627 | fifa.world | Croatia x Ghana (2-1) | 32 |
| 20260624 | fifa.world | Bosnia-Herzegovina x Qatar (3-1) | 46 |
| 20260425 | bra.1 | Bahia x Santos (2-2) | 25 |
| 20260627 | fifa.world | Panama x England (0-2) | 39 |
| 20260619 | fifa.world | Brazil x Haiti (3-0) | 37 |
| 20260426 | bra.1 | Fluminense x Chapecoense (2-1) | 23 |
| 20260502 | bra.1 | Palmeiras x Santos (1-1) | 18 |
| 20260401 | bra.1 | Coritiba x Vasco da Gama (1-1) | 19 |
| 20260625 | fifa.world | Japan x Sweden (1-1) | 35 |
| 20260516 | bra.1 | Palmeiras x Cruzeiro (1-1) | 20 |
| 20260225 | bra.1 | Coritiba x São Paulo (0-1) | 22 |
| 20260204 | bra.1 | Palmeiras x Vitória (5-1) | 25 |
| 20260619 | fifa.world | Türkiye x Paraguay (0-1) | 64 |
| 20260401 | bra.1 | Botafogo x Mirassol (3-2) | 25 |
| 20260510 | bra.1 | Remo x Palmeiras (1-1) | 20 |
| 20260624 | fifa.world | Scotland x Brazil (0-3) | 34 |
| 20260627 | fifa.world | Algeria x Austria (3-3) | 36 |
| 20260225 | bra.1 | Bahia x Chapecoense (0-0) | 0 |
| 20260225 | bra.1 | Flamengo x Mirassol (0-0) | 0 |
| 20260624 | fifa.world | South Africa x South Korea (1-0) | 23 |
| 20260625 | fifa.world | Türkiye x United States (3-2) | 40 |
| 20260619 | fifa.world | Scotland x Morocco (0-1) | 36 |
| 20260425 | bra.1 | Remo x Cruzeiro (0-1) | 18 |
| 20260225 | bra.1 | Grêmio x Atlético-MG (2-1) | 21 |
| 20260510 | bra.1 | Grêmio x Flamengo (0-1) | 17 |
| 20260405 | bra.1 | Flamengo x Santos (3-1) | 20 |
| 20260627 | fifa.world | Jordan x Argentina (1-3) | 39 |
| 20260510 | bra.1 | Santos x Red Bull Bragantino (2-0) | 21 |
| 20260402 | bra.1 | Chapecoense x Atlético-MG (0-4) | 19 |
| 20260624 | fifa.world | Switzerland x Canada (2-1) | 28 |
| 20260204 | bra.1 | Grêmio x Botafogo (5-3) | 25 |
| 20260225 | bra.1 | Red Bull Bragantino x Athletico-PR (1-1) | 23 |
| 20260225 | bra.1 | Cruzeiro x Corinthians (1-1) | 21 |
| 20260625 | fifa.world | Paraguay x Australia (0-0) | 30 |
| 20260402 | bra.1 | Palmeiras x Grêmio (2-1) | 20 |
| 20260625 | fifa.world | Ecuador x Germany (2-1) | 35 |
| 20260425 | bra.1 | São Paulo x Mirassol (1-0) | 16 |
| 20260516 | bra.1 | Fluminense x São Paulo (2-1) | 22 |
| 20260510 | bra.1 | Vasco da Gama x Athletico-PR (1-0) | 20 |
| 20260401 | bra.1 | Fluminense x Corinthians (3-1) | 24 |
| 20260426 | bra.1 | Athletico-PR x Vitória (3-1) | 27 |
| 20260405 | bra.1 | Grêmio x Remo (0-0) | 19 |
