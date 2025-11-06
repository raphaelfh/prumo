# Structured Extraction Edge Function

Edge Function para extração estruturada usando Instructor.js.

## Funcionalidades

- **Extração estruturada**: Extrai dados estruturados de texto usando Instructor.js
- **Schemas Zod**: Suporte a schemas Zod complexos (objetos, arrays, aninhados)
- **Módulo reutilizável**: Usa módulo compartilhado `_shared/extraction/instructor-extractor.ts` (DRY)
- **Interface simples**: API KISS (Keep It Simple, Stupid) - apenas texto, schema e prompt

## Arquitetura

```
structured-extraction/index.ts (handler principal)
    ↓
InstructorExtractor.extract() (módulo compartilhado)
    ├─ Validação de entrada
    ├─ Retry automático
    └─ Chamada ao Instructor.js
```

## Requisitos

### Variáveis de Ambiente

Configure no dashboard do Supabase (Edge Functions → Settings) ou no arquivo `supabase/.env`:

- `OPENAI_API_KEY`: Chave da API OpenAI
- `SUPABASE_URL`: URL do projeto (configurado automaticamente)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (configurado automaticamente)

## Deploy

```bash
supabase functions deploy structured-extraction
```

## Uso

### Request

```typescript
POST /functions/v1/structured-extraction
Content-Type: application/json
Authorization: Bearer <user_token>  // Opcional se requireAuth=false

{
  "text": "Texto a extrair dados estruturados...",
  "schema": {
    // Schema Zod (objeto ou array)
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "year": { "type": "number" }
    }
  },
  "prompt": "Extraia o título e o ano do texto fornecido",
  "options": {
    "model": "gpt-4o-mini",  // opcional: "gpt-4o-mini" | "gpt-4o" | "gpt-5"
    "temperature": 0.0,       // opcional
    "maxTokens": 1000         // opcional
  },
  "requireAuth": false  // opcional: requer autenticação se true
}
```

### Response (Sucesso)

```json
{
  "ok": true,
  "data": {
    "title": "Título extraído",
    "year": 2024
  },
  "metadata": {
    "model": "gpt-4o-mini",
    "duration": 1234.56
  },
  "traceId": "uuid-do-trace"
}
```

### Response (Erro)

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Text cannot be empty"
  }
}
```

## Exemplos

### Exemplo 1: Extração simples

```typescript
const response = await fetch('/functions/v1/structured-extraction', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: "Artigo: Machine Learning in Healthcare. Autor: John Doe. Ano: 2024",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
        year: { type: "number" }
      }
    },
    prompt: "Extraia o título, autor e ano do artigo",
    options: {
      model: "gpt-4o-mini"
    }
  })
});

const result = await response.json();
console.log(result.data); // { title: "...", author: "...", year: 2024 }
```

### Exemplo 2: Schema aninhado

```typescript
const schema = {
  type: "object",
  properties: {
    article: {
      type: "object",
      properties: {
        title: { type: "string" },
        authors: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  }
};

// Usar schema no request...
```

## Testes

### Testes Unitários

```bash
cd supabase/functions/structured-extraction
deno test --allow-all tests/structured-extraction.test.ts
```

### Teste E2E

```bash
# Garantir que OPENAI_API_KEY está no .env
deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-e2e-test.ts
```

## Princípios de Design

- **DRY (Don't Repeat Yourself)**: Reutiliza módulo compartilhado `_shared/extraction/instructor-extractor.ts`
- **KISS (Keep It Simple, Stupid)**: Interface simples - apenas texto, schema e prompt
- **Modularidade**: Separação clara entre handler, extractor e configuração

## Diferenças vs LangChain

- **Interface mais simples**: Não requer configuração de agent/tools
- **Menos dependências**: Instructor.js é mais leve que LangChain
- **Foco em extração**: Otimizado especificamente para structured output

