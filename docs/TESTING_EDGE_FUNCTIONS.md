# Guia de Testes para Edge Functions

Este guia explica como testar Edge Functions no Review Hub usando Deno Test.

## 🚀 Início Rápido

```bash
# 1. Testar todas as edge functions
./scripts/test-edge-functions.sh

# 2. Testar uma função específica
./scripts/test-edge-functions.sh ai-assessment

# 3. Testar manualmente (dentro da pasta da função)
cd supabase/functions/ai-assessment
deno test --allow-all
```

## Visão Geral

As Edge Functions do Supabase são executadas em Deno, então usamos o framework de testes nativo do Deno (`Deno.test`) junto com as assertions do stdlib (`https://deno.land/std@0.208.0/assert/mod.ts`).

## Estrutura de Testes

### Organização de Arquivos

```
supabase/functions/
  nome-da-funcao/
    index.ts          # Código da função
    pipeline.ts       # Lógica de negócio (se aplicável)
    tests/
      nome-da-funcao.test.ts    # Testes unitários
      run-e2e-test.ts            # Testes end-to-end (opcional)
```

### Exemplos no Projeto

- `section-extraction/tests/` - Testes completos de pipeline
- `model-extraction/tests/` - Testes de extração de modelos

## Tipos de Teste

### 1. Testes Unitários

Testam componentes isolados com mocks:

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { YourFunction } from "../pipeline.ts";

// Mock do Supabase Client
function createMockSupabaseClient(): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { id: "test-id" },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test("nome do teste - descrição", async () => {
  const mockSupabase = createMockSupabaseClient();
  const function = new YourFunction(mockSupabase);
  
  const result = await function.method();
  assertEquals(result, expectedValue);
});
```

### 2. Testes de Validação de Input

Validação de schemas Zod e tratamento de erros:

```typescript
import { z } from "npm:zod@3.23.8";

const InputSchema = z.object({
  projectId: z.string().uuid(),
  articleId: z.string().uuid(),
});

Deno.test("valida input com zod - rejeita payload inválido", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invalid: "data" }),
  });
  
  const result = await handler({ request });
  assertEquals(result.status, 400);
  
  const body = await result.json();
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "VALIDATION_ERROR");
});
```

### 3. Testes de Integração (E2E)

Testam o fluxo completo com dados reais (opcional):

```typescript
Deno.test("Pipeline E2E - Execução completa", async () => {
  const logger = new Logger({ traceId: "e2e-test" });
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  const pdfBuffer = await Deno.readFile("./test.pdf");
  const result = await pipeline.run(pdfBuffer, config);
  
  assertEquals(result.status, "completed");
  assertEquals(result.suggestionsCreated > 0, true);
});
```

## Como Executar Testes

### Método 1: Usando o Script Helper

```bash
# Testar todas as funções
./scripts/test-edge-functions.sh

# Testar uma função específica
./scripts/test-edge-functions.sh ai-assessment
```

### Método 2: Comandos Diretos do Deno

#### Executar todos os testes de uma função

```bash
cd supabase/functions/nome-da-funcao
deno test --allow-all
```

#### Executar um arquivo específico

```bash
deno test tests/nome-do-teste.test.ts --allow-all
```

#### Executar com watch mode (desenvolvimento)

```bash
deno test --watch --allow-all
```

#### Executar testes com coverage

```bash
deno test --coverage=coverage --allow-all
deno coverage coverage
```

#### Executar testes específicos por nome

```bash
deno test --allow-all --filter "valida input"
```

## Padrões de Teste Recomendados

### 1. Validação de Input

Sempre teste validação de schemas Zod:

```typescript
Deno.test("rejeita input inválido", async () => {
  // Teste campos obrigatórios faltando
  // Teste tipos incorretos
  // Teste valores fora do range esperado
});
```

### 2. Tratamento de Erros

Teste cenários de erro:

```typescript
Deno.test("retorna erro 401 quando não autenticado", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    // Sem Authorization header
  });
  
  const result = await handler({ request });
  assertEquals(result.status, 401);
});
```

### 3. Formato de Resposta Padronizado

Verifique o formato JSON padronizado:

```typescript
Deno.test("retorna formato padronizado", async () => {
  const result = await handler({ request });
  const body = await result.json();
  
  assertEquals(body.ok, true);
  assertEquals(typeof body.data, "object");
  assertEquals(typeof body.traceId, "string");
});
```

### 4. CORS Headers

Teste headers CORS:

```typescript
Deno.test("inclui headers CORS", async () => {
  const result = await handler({ request });
  
  assertEquals(result.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(result.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});
```

### 5. Rate Limiting

Teste rate limiting (se implementado):

```typescript
Deno.test("retorna 429 quando rate limit excedido", async () => {
  // Simular múltiplas requisições
  // Verificar status 429
});
```

## Mocking no Deno

### Mock do Supabase Client

```typescript
function createMockSupabaseClient(
  customResponses?: Record<string, any>
): SupabaseClient {
  return {
    from: (table: string) => {
      // Retornar resposta customizada se fornecida
      if (customResponses?.[table]) {
        return customResponses[table];
      }
      
      // Resposta padrão
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: { id: "default-id" },
              error: null,
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: { id: "new-id" },
              error: null,
            }),
          }),
        }),
      };
    },
    auth: {
      getUser: () => Promise.resolve({
        data: { user: { id: "test-user-id" } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}
```

### Mock de Requisições HTTP

```typescript
// Mock fetch global
globalThis.fetch = async (input: RequestInfo | URL) => {
  if (input.toString().includes("api.openai.com")) {
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ result: "mock" }),
    }), { status: 200 });
  }
  return new Response("Not found", { status: 404 });
};
```

## Boas Práticas

### 1. Isolamento

- Cada teste deve ser independente
- Use mocks para evitar dependências externas
- Limpe dados de teste após execução

### 2. Nomes Descritivos

```typescript
// ✅ Bom
Deno.test("assessArticle - valida input com zod", async () => {});
Deno.test("assessArticle - retorna erro em caso de rate limit", async () => {});

// ❌ Ruim
Deno.test("test 1", async () => {});
Deno.test("test validation", async () => {});
```

### 3. Arrange-Act-Assert

Organize testes em três fases:

```typescript
Deno.test("exemplo - estrutura clara", async () => {
  // Arrange: preparar dados e mocks
  const mockSupabase = createMockSupabaseClient();
  const function = new YourFunction(mockSupabase);
  
  // Act: executar ação
  const result = await function.method();
  
  // Assert: verificar resultado
  assertEquals(result.status, "success");
});
```

### 4. Testar Edge Cases

- Valores vazios
- Valores nulos
- Strings muito longas
- Arrays vazios
- Números negativos ou zero

### 5. Logging em Testes

Use logs estruturados para debug:

```typescript
Deno.test("exemplo com logs", async () => {
  const traceId = "test-trace";
  console.log(JSON.stringify({
    traceId,
    test: "exemplo",
    step: "iniciando",
  }));
  
  // ... código do teste ...
  
  console.log(JSON.stringify({
    traceId,
    test: "exemplo",
    step: "completo",
    result: "sucesso",
  }));
});
```

## Exemplo Completo

Veja `supabase/functions/section-extraction/tests/pipeline.test.ts` para um exemplo completo de testes unitários.

## Troubleshooting

### Erro: "Module not found"

Verifique imports no `deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "zod": "npm:zod@3.23.8"
  }
}
```

### Erro: "Permission denied"

Use `--allow-all` ou flags específicas:

```bash
deno test --allow-net --allow-read --allow-env --allow-write
```

### Erro: "Type error"

Verifique tipos TypeScript. Use `as unknown as Type` para casting em mocks quando necessário.

## Integração com CI/CD

Para rodar testes em CI:

```yaml
# .github/workflows/test.yml
- name: Test Edge Functions
  run: |
    cd supabase/functions/section-extraction
    deno test --allow-all
```

## Referências

- [Deno Test Documentation](https://deno.land/manual/testing)
- [Deno Assertions](https://deno.land/std/assert)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
