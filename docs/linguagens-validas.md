# Linguagens válidas

Este documento lista as opções de idioma suportadas pelo SAIUGOL e como configurá-las.

---

## 1. Idioma dos posts (títulos e rótulos) – `DEFAULT_LANGUAGE`

Controla o idioma dos **títulos e rótulos** dos toots (ex.: "⚽ GOOOOL!", "🔄 SUBSTITUIÇÃO", "Entra:", "Sai:"). O valor é usado pelo serviço de i18n, que carrega um dicionário em `src/services/dictionaries/{locale}.json`.

### Linguagens válidas (com dicionário instalado)

| Valor      | Arquivo                    | Status   |
|-----------|----------------------------|----------|
| **pt-BR** | `src/services/dictionaries/pt-BR.json` | ✅ Suportado (único dicionário incluído) |

### Outros valores

- Qualquer outro código (ex.: `en`, `es`) pode ser definido em `DEFAULT_LANGUAGE`, mas **só funciona corretamente** se existir o arquivo correspondente em `src/services/dictionaries/` (ex.: `en.json`).
- Se o arquivo não existir, o bot inicia, porém `translate()` devolve a **chave** em vez do texto traduzido (ex.: `ui.goal_announcement` em vez de "⚽ GOOOOL!").

### Formato do código

- Use código **locale** com hífen (ex.: `pt-BR`). O código é normalizado para o nome do arquivo: parte antes do hífen em minúsculas, parte depois em maiúsculas (ex.: `pt-br` → `pt-BR.json`).

### Exemplo no .env

```env
DEFAULT_LANGUAGE=pt-BR
```

---

## 2. Idioma das descrições da API ESPN – `ESPN_USE_PT_DESCRIPTIONS`

Controla se o summary da ESPN é chamado **com** ou **sem** parâmetros de idioma. Isso afeta o texto das **descrições** (bloco 📝) que vêm da API (gols, cartões, substituições).

### Opções válidas

| Valor no .env | Comportamento | Idioma das descrições (📝) |
|---------------|----------------|----------------------------|
| **`true`**    | Summary chamado com `&lang=pt&region=br` (API web) | Português brasileiro |
| **`false`** ou não definido | Summary chamado sem lang/region (API default) | Inglês |

Ambas as opções são **válidas**. Se o usuário não definir PT no .env, o uso de summary em inglês é intencional.

### Exemplo no .env

```env
# Descrições em português (recomendado para público BR)
ESPN_USE_PT_DESCRIPTIONS=true

# Descrições em inglês (API default)
# ESPN_USE_PT_DESCRIPTIONS=false
```

---

## 3. Resumo

| Configuração | Linguagens/valores válidos | Observação |
|--------------|----------------------------|------------|
| **DEFAULT_LANGUAGE** | `pt-BR` (único com dicionário incluído) | Outros códigos exigem criar `dictionaries/{locale}.json`. |
| **ESPN_USE_PT_DESCRIPTIONS** | `true` (PT) ou `false`/não definido (EN) | Não há outros pares lang/region expostos no código. |
