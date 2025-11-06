# Testes para Structured Extraction

Este diretório contém diferentes tipos de testes para a Edge Function de Structured Extraction.

## Estrutura de Testes

### 1. Testes Unitários

**Arquivo**: `structured-extraction.test.ts`

Testa validações básicas, schemas Zod, e estrutura da função.

```bash
deno test --allow-all supabase/functions/structured-extraction/tests/structured-extraction.test.ts
```

### 2. Testes de Cenários

**Arquivo**: `structured-extraction-scenarios.test.ts`

Testa diferentes cenários de uso:
- Diferentes tipos de schemas (objetos, arrays, aninhados)
- Casos de erro e validação
- Diferentes tamanhos de texto
- Limites e edge cases

```bash
deno test --allow-all supabase/functions/structured-extraction/tests/structured-extraction-scenarios.test.ts
```

### 3. Teste E2E Básico

**Arquivo**: `run-e2e-test.ts`

Teste simples end-to-end com chamada real à API OpenAI.

```bash
deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-e2e-test.ts
```

**Requisitos**: `OPENAI_API_KEY` no `.env`

### 4. Testes de Cenários E2E

**Arquivo**: `run-scenarios-test.ts`

Testa múltiplos cenários reais com chamadas à API:
- Extração simples
- Schemas aninhados
- Arrays de objetos
- Campos opcionais
- Validação de tipos (email, URL)

```bash
deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-scenarios-test.ts
```

**Requisitos**: `OPENAI_API_KEY` no `.env`

## Executar Todos os Testes

```bash
# Testes unitários e de cenários (sem chamadas à API)
deno test --allow-all supabase/functions/structured-extraction/tests/

# Testes E2E (requer OPENAI_API_KEY)
deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-e2e-test.ts
deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-scenarios-test.ts
```

## Cobertura de Testes

### ✅ Testes Unitários Cobrem:
- Validação de entrada (texto vazio, null, undefined)
- Validação de schemas Zod
- Diferentes tipos de schemas (objetos, arrays, aninhados)
- Validação de request
- Diferentes modelos
- Casos de erro

### ✅ Testes de Cenários Cobrem:
- 12+ cenários diferentes
- Schemas com validações (email, URL, números positivos)
- Edge cases (objetos vazios, arrays vazios, valores default)
- Diferentes tamanhos de texto
- Prompts variados
- Logger e observabilidade

### ✅ Testes E2E Cobrem:
- Chamadas reais à API OpenAI
- 5+ cenários diferentes de uso real
- Validação de resultados
- Performance e métricas

## Adicionar Novos Testes

Para adicionar um novo cenário de teste:

1. **Teste Unitário**: Adicione em `structured-extraction-scenarios.test.ts`
2. **Teste E2E**: Adicione um novo objeto no array `SCENARIOS` em `run-scenarios-test.ts`

Exemplo:

```typescript
{
  name: "Novo Cenário",
  text: "Texto de exemplo...",
  schema: z.object({
    field: z.string(),
  }),
  prompt: "Instruções de extração...",
}
```

