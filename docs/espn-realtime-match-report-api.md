# Relatório ao vivo da ESPN: como o site usa a API

Inspeção da página de partida ao vivo (ex.: Atlético-MG x Remo, jogoId 401840990) em https://www.espn.com.br/futebol/partida/_/jogoId/401840990

## O que a página mostra (tempo real)

- **Placar**: 2–1, minuto 72'
- **Status**: Segundo tempo, "in" (em andamento)
- **Última jogada**: "Substituição Remo, entra em campo Zé Welison substituindo Leonel Picco."
- **Linha do tempo**: INI, 22', 42', INT, 55', 61', 64', 66', 70', 71', 72' (gols e substituições)
- **Escalações**, **estatísticas** (posse, chutes, cartões, escanteios, defesas)

---

## APIs usadas pelo site ESPN.com.br (rede)

### 1. Scoreboard header (dados “ao vivo” do jogo)

- **URL**: `https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header`
- **Query**: `sport=soccer&league=bra.1&region=br&lang=pt&contentorigin=deportes&configuration=STREAM_MENU&platform=web&features=sfb-all,cutl&tz=America/Sao_Paulo&postalCode=29100-010&playabilitySource=playbackId`
- **Uso**: Lista de jogos do dia + para o jogo atual: `status`, `clock`, `period`, `competitors` (times e placar), `situation.lastPlay` (última jogada em texto), `fullStatus`, odds, etc.
- **Cache**: `max-age=10` (atualização frequente em tempo real).

Resposta relevante (exemplo para 401840990):

- `status`: `"in"`
- `summary` / `clock`: `"72'"`
- `period`: 2
- `fullStatus.displayClock`: `"72'"`
- `situation.lastPlay.text`: último evento (ex.: substituição)
- `competitors`: home/away com `score`, `displayName`, `abbreviation`, etc.

### 2. Fastcast (pub/sub – estado completo do jogo)

- **URL**: `https://fcast.espncdn.com/FastcastService/pubsub/profiles/12000/topic/gp-soccer-{league}-{lang}-{eventId}/message/{messageId}/checkpoint`
- **Exemplo**: `.../topic/gp-soccer-bra.1-pt-401840990/message/275/checkpoint`
- **Uso**: Polling (ou long-poll) de um “checkpoint” que devolve um JSON grande com estado atual do jogo: `boxscore`, `form` (últimos jogos dos times), e provavelmente eventos/play-by-play em outras mensagens.
- **Cache**: `max-age=3589` no checkpoint (o cliente deve pedir o próximo `messageId` para atualizações).

Ou seja: o **tempo real** no site é feito com **scoreboard header** (rápido, leve) + **Fastcast** (estado completo / eventos).

### 3. Outras chamadas do site (contexto)

- `site.web.api.espn.com/apis/site/v2/content/3597486/categories?lang=pt` – categorias/navegação
- `site.web.api.espn.com/apis/personalized/site/v2/streams/401840990?...` – disponibilidade de transmissão
- Taboola/Adobe/analytics – não afetam dados esportivos

---

## O que o SAIUGOL usa hoje

| Recurso        | Site ESPN.com.br                         | SAIUGOL (espn.js) |
|----------------|------------------------------------------|-------------------|
| Lista de jogos | `site.web.api.espn.com` scoreboard/header | `site.api.espn.com` …/scoreboard?dates=… |
| Detalhe/jogo   | Fastcast checkpoint + header             | `site.api.espn.com` …/summary?event={id} |
| Eventos (gols, etc.) | Dentro do Fastcast / header (lastPlay) | `getLiveEvents()` via …/summary?event= (keyEvents) |

- **Base URL do projeto**: `https://site.api.espn.com/apis/site/v2/sports/soccer`
- **Endpoints**: `/{leagueCode}/scoreboard?dates=YYYYMMDD` e `/{leagueCode}/summary?event={matchId}`

Ou seja: o site usa **site.web.api.espn.com** (personalizado, com header “ao vivo”) e **Fastcast**; o bot usa **site.api.espn.com** (scoreboard + summary). São “APIs diferentes” do mesmo ecossistema ESPN.

---

## Resumo

1. **Tempo real no site**: Scoreboard **header** (atualização a cada ~10 s) + **Fastcast** (checkpoint por `messageId`) para estado completo e eventos.
2. **SAIUGOL**: Usa a API “pública” **scoreboard** e **summary**; `getLiveEvents()` já usa `summary?event=` (keyEvents), que é a fonte equivalente de “eventos ao vivo” sem depender do Fastcast.
3. Se no futuro quiserem algo mais “ao vivo” (ex.: apenas placar + último evento com menos latência), pode-se testar o **scoreboard header** em `site.web.api.espn.com` (requer mesmo `league`, `region`, `lang`, etc.). O Fastcast é mais complexo (topic, messageId, checkpoint) e provavelmente desnecessário para o bot.

---

*Documento gerado a partir de inspeção de rede na página de partida ao vivo da ESPN (BR), fev/2026.*
