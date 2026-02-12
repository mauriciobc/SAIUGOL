# Investigação: posts fantasmas (trigger events)

Cada post listado como "fantasma" pelo script de comparação foi confrontado com o relatório ESPN e com o fluxo do bot (diffEngine → matchMonitor → eventProcessor / handleMatchEnd) para identificar o **gatilho real** e por que não casou no relatório.

---

## 1. match_end — Chapecoense 3 x 3 Coritiba

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| 🏁 FIM DE JOGO! Chapecoense 3 x 3 Coritiba | Não aparece como linha na tabela de keyEvents |

**Gatilho real:**  
O fim de jogo **não** vem de `keyEvents` da API. O bot dispara o post quando o **diffEngine** detecta mudança de status da partida de `in` (ao vivo) para `post` (finalizado). O `matchMonitor` chama `handleMatchEnd(match)` e o post é identificado pelo ID sintético `{matchId}-match-end` (ex.: `401840989-match-end`).

**Por que aparece como fantasma:**  
O script de comparação monta a lista de "esperados" **só** a partir da tabela de eventos do relatório (keyEvents). O relatório não inclui evento "Full time" / "Match end" nessa tabela, então não existe nenhum evento esperado para casar com esse post. Ou seja: o post é **legítimo**; ele é "fantasma" apenas porque o critério de comparação é baseado só em keyEvents.

**Conclusão:** Não é fantasma de dado. Gatilho = **mudança de status da partida para "post"** (fim de jogo). Partida correta: **401840989** (Chapecoense x Coritiba).

---

## 2. match_start — Atlético-MG x Remo

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| 🏁 COMEÇA O JOGO! Atlético-MG x Remo | Sim: existe **Kickoff** (id: 80) para Atlético-MG x Remo |

**Gatilho real:**  
Pode vir de dois caminhos:

1. **diffEngine:** status da partida muda de `pre` → `in` → o `matchMonitor` posta com ID `{matchId}-match-start` (ex.: `401840990-match-start`) e não usa keyEvents para isso.
2. **keyEvents:** o primeiro evento da partida é Kickoff; o eventProcessor também poderia postar como MATCH_START, mas o monitor já evita duplicata checando `isEventPosted(\`${matchId}-match-start\`)`.

Na prática o post vem do **diffEngine** (match_start ao entrar em "in"). A partida é **401840990** (Atlético-MG x Remo).

**Por que aparece como fantasma:**  
No relatório, o Kickoff tem **minuto vazio** na tabela. O `parseReport` do script de comparação normaliza minuto vazio para `"0'"`. Na timeline, o post "COMEÇA O JOGO" normalmente **não** tem `⏱️` no texto, então o script extrai minuto `""`. O `findMatchingReal` exige `r.minute === expectedEv.minute` → `"" !== "0'"` → não casa. Ou seja: o evento esperado **existe** (Kickoff), mas o casamento falha por diferença de normalização de minuto (vazio vs "0'").

**Conclusão:** Post legítimo. Gatilho = **mudança de status para "in"** (começa o jogo). Fantasma apenas por **critério de matching** (minuto vazio vs "0'").

---

## 3. goal 82' — Mirassol 2 x 1 Cruzeiro (Matheus Pereira)

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| ⚽ GOOOOL! Mirassol 2 x 1 Cruzeiro ⏱️ 82' 👤 Ma[theus Pereira?] | Não há gol aos 82'. Matheus Pereira só aparece como **cartão amarelo aos 8'**. |

**Gatilho plausível:**  
O relatório (espn-events-report) foi gerado **depois** (em um único fetch). No momento em que o bot fez o poll, a API ESPN pode ter retornado:

- um evento com `type.text` que entrou em GOAL (ex.: "Goal" ou "Penalty - Scored") e **minuto 82'**, com participante que o formatter interpretou como "Matheus Pereira", ou
- um evento que naquele momento tinha minuto/jogador incorretos e depois foi corrigido na API.

Não há no código nenhum caminho que transforme cartão amarelo em gol (categorização é por `event.type`). Então a explicação mais plausível é **dado transiente da API**: em algum poll, a ESPN retornou um evento de gol aos 82' (possivelmente com jogador errado ou tipo/minuto corrigidos depois). Sem o log bruto do EventProcessor na hora exata do post não dá para confirmar o payload.

**Conclusão:** Gatilho plausível = **evento keyEvents com type de gol e minuto 82'** no momento do poll, com dados que depois não batem com o relatório (possível correção/atualização da API ou bug da fonte).

---

## 4. goal 76' — Mirassol 2 x 1 Cruzeiro (Antonio Galeano)

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| ⚽ GOOOOL! Mirassol 2 x 1 Cruzeiro ⏱️ 76' 👤 An[tonio Galeano?] | Não há gol aos 76'. Antonio Galeano só aparece em **substituição aos 71'** (entra no lugar de Eduardo). |

**Gatilho plausível:**  
Mesma lógica do 82': em algum poll a API pode ter devolvido um evento classificado como gol com minuto 76' e participante que resultou em "Antonio Galeano" no post. O relatório atual não tem esse gol; pode ser evento removido/corrigido depois ou dado inconsistente da API no momento do post.

**Conclusão:** Gatilho plausível = **evento keyEvents com type de gol e minuto 76'** no momento do poll. Jogador "Antonio Galeano" pode ter vindo desse evento ou de parsing/participants incorreto.

---

## 5. goal 75' — Mirassol 3 x 1 Cruzeiro (Antonio Galeano)

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| ⚽ GOOOOL! Mirassol **3 x 1** Cruzeiro ⏱️ 75' 👤 An[tonio Galeano?] | Não há gol aos 75'. Placar 3 x 1 nunca ocorreu (após 53' foi 2 x 1; depois 85' 2 x 2). |

**Gatilho plausível:**  
Dois problemas no mesmo post: minuto 75' e placar 3 x 1. O placar no post vem de `match.homeScore` / `match.awayScore` no momento do poll (getMatchDetails). Então em algum momento a API pode ter devolvido:

- score 3 x 1 (ex.: atualização atrasada ou incorreta), e
- um evento de gol com minuto 75'.

Isso reforça a hipótese de **dados transientes/incorretos da API** no instante do poll (score e/ou keyEvent), depois corrigidos no estado que o relatório reflete.

**Conclusão:** Gatilho plausível = **keyEvents com gol aos 75'** + **score 3 x 1** no snapshot da partida naquele poll. Ambos podem ter sido corrigidos depois pela ESPN.

---

## 6. substitution 70' — Mirassol 2 x 1 Cruzeiro

| Post (timeline) | No relatório ESPN? |
|-----------------|--------------------|
| 🔄 SUBSTITUIÇÃO Mirassol 2 x 1 Cruzeiro ⏱️ 70' | No relatório há substituições aos **71'** (Antonio Galeano, Everton Galdino), não 70'. |

**Gatilho real (com alta confiança):**  
O mesmo par de substituições aos 71' (Mirassol: Antonio Galeano e Everton Galdino) é o único candidato. O minuto do evento vem de `event.clock?.displayValue` na resposta da API. Se em algum poll a API retornou `displayValue: "70'"` e depois passou a "71'", o bot teria postado "70'".

**Conclusão:** Gatilho = **evento de substituição aos 71'** retornado com **clock.displayValue "70'"** no momento do poll (diferença de um minuto, possivelmente arredondamento ou atraso da fonte).

---

## Resumo

| Post fantasma | Gatilho / correspondência | Tipo |
|---------------|---------------------------|------|
| match_end Chapecoense 3 x 3 Coritiba | Status partida → `post` (fim de jogo). ID `401840989-match-end`. | Legítimo; relatório não lista match_end. |
| match_start Atlético-MG x Remo | Status partida → `in` (começa o jogo). Existe Kickoff no relatório; casamento falha por minuto "" vs "0'". | Legítimo; falha de matching. |
| goal 82' Mirassol (Matheus Pereira) | Possível evento de gol 82' na API no momento do poll; depois não presente/corrigido no relatório. | Dado transiente/incorreto da API. |
| goal 76' Mirassol (Antonio Galeano) | Idem: evento de gol 76' no poll; relatório não tem. | Dado transiente/incorreto da API. |
| goal 75' Mirassol 3 x 1 (Antonio Galeano) | Gol 75' + score 3 x 1 no poll; relatório com minutos e placar diferentes. | Dado transiente/incorreto da API. |
| substitution 70' Mirassol | Mesmo evento das substituições aos 71', com clock "70'" no poll. | Mesmo evento; diferença de 1 minuto no clock. |

**Recomendações:**

1. **match_end / match_start:** Tratar no script de comparação como eventos especiais: considerar "esperado" match_end quando a partida existe no relatório e está finalizada; considerar match_start quando existe Kickoff (e aceitar minuto vazio como equivalente a "0'" ou omitir minuto no matching para MATCH_START).
2. **Gols 75'/76'/82':** Se possível, guardar em log o payload bruto de keyEvents (ou ao menos type + minute + participant) quando postar, para cruzar depois com relatórios e confirmar se a API mandou esses eventos.
3. **Substituição 70' vs 71':** Opcional: no comparador, aceitar diferença de 1 minuto para substituições (70' ↔ 71') para reduzir falsos fantasmas.
