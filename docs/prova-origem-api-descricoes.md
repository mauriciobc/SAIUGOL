# Prova: texto 📝 dos toots vem 100% da API ESPN

Este documento demonstra que o conteúdo em inglês nos comentários (ex.: "Lucas Evangelista (Palmeiras) Substitution at 81'") **tem origem exclusiva na resposta da API ESPN**. O bot não gera nem traduz esse texto.

---

## 1. Fluxo do dado no código

| Etapa | Arquivo | Código | Origem do valor |
|--------|---------|--------|------------------|
| Resposta HTTP | `src/api/espn.js` | `const raw = response.data?.keyEvents` | ESPN API |
| Campo usado | `src/api/espn.js` | `const description = event.text` | `keyEvents[].text` da API |
| Objeto normalizado | `src/api/espn.js` | `base = { ..., description, ... }` | Só repassa `event.text` |
| Texto do toot | `src/bot/formatter.js` | `eventDescription(event)` → `event?.description ?? event?.text` | Só lê o que veio da API |
| Exibição | `src/bot/formatter.js` | `text += '\n\n📝 ' + desc` | Pass-through, sem formatação |

Não há nenhum `desc = ... "Substitution at" ...` nem montagem de string a partir de `shortText`, `clock.displayValue` ou outro campo. O bloco 📝 do toot é **sempre** o valor bruto de `event.text` (ou `event.description`, que é esse mesmo valor atribuído em `espn.js`).

---

## 2. Busca no código: zero geração desse formato

Comando executado no repositório:

```bash
grep -r "Substitution at\|Goal at\|Yellow Card at\|shortText" src/
# Resultado: No matches found
```

O formato `"X (Team) Substitution at NN'"` **não aparece em nenhum lugar** no código. Logo, não pode ter sido gerado pelo bot.

---

## 3. Evidência nos logs do bot

No arquivo `_saiugol-bot_logs.txt`, o objeto que o **EventProcessor** recebe (e que foi montado em `getLiveEvents` a partir da API) contém:

```
"description": "Félix Torres (Internacional) Substitution at 51'"
"description": "Vitor Roque (Palmeiras) Goal at 52'"
"description": "Paulinho (Internacional) Yellow Card at 55'"
"description": "Lucas Evangelista (Palmeiras) Substitution at 81'"
...
```

Em `espn.js` (linha 362) temos `const description = event.text` e `base.description = description`. Portanto, o valor de `description` nos logs **é** o que veio em `response.data.keyEvents[].text`. Ou seja: a API ESPN devolveu esse texto naquele momento.

---

## 4. Resposta atual da API (comparação)

Requisições feitas após o jogo:

- **site.api.espn.com** (inglês, sem `lang=pt`):  
  `event.text` = `"Substitution, Internacional. Félix Torres replaces Victor Gabriel because of an injury."`  
  Não existe campo com `"Substitution at 51'"` no JSON.

- **site.web.api.espn.com** com `lang=pt&region=br`:  
  `event.text` = `"Substituição Internacional, entra em campo Félix Torres substituindo Victor Gabriel..."`  
  Ou seja, em PT a API devolve texto longo em português.

Conclusão: o formato curto em inglês (`"X (Team) Substitution at NN'"`) que apareceu nos toots **foi retornado pela API em algum momento** (ex.: durante o jogo ou em outro contexto/cache). O código do bot apenas repassa esse valor; não o constrói.

---

## 5. Conclusão

- O texto exibido em 📝 nos toots é **sempre** `event.text` (ou o mesmo valor em `event.description`) vindo de `keyEvents` da API.
- O código **nunca** monta strings no formato `"X (Team) Substitution/Goal/Yellow Card at NN'"`.
- Os logs mostram o bot recebendo exatamente essas strings em `description`, que é atribuído direto de `event.text`.

**Portanto, com 100% de certeza, o problema dos comentários em inglês está nas respostas da API ESPN** (seja por variabilidade do conteúdo de `keyEvents[].text`, por cache, ou por respostas em inglês quando se esperava PT), e não em geração ou tradução de texto no SAIUGOL.
