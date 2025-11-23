# Correção: Extração de Token Usage do LangChain

## Problema Identificado

Os tokens não estavam sendo extraídos corretamente, mostrando `0` em todos os campos.

## Causa Raiz

Com `createAgent` + `providerStrategy`, o LangChain retorna os tokens de uso em uma estrutura aninhada diferente:

**Formato do Retorno:**
```typescript
{
  messages: [
    { /* HumanMessage */ },
    { 
      response_metadata: {
        usage: {
          prompt_tokens: 9565,
          completion_tokens: 527,
          total_tokens: 10092
        }
      }
    }
  ],
  structuredResponse: { /* dados extraídos */ }
}
```

O problema era que estávamos buscando apenas em `result.response_metadata`, mas os tokens estão em `result.messages[].response_metadata.usage`.

## Correção Aplicada

### Antes
```typescript
const usage = 
  typedResult.response_metadata?.usage ||
  typedResult.usage_metadata ||
  {};
```

### Depois
```typescript
// 1. Tentar do resultado direto
let usage = 
  typedResult.response_metadata?.usage ||
  typedResult.response_metadata?.tokenUsage ||
  typedResult.usage_metadata ||
  {};

// 2. Se não encontrou, buscar nas mensagens (comum em createAgent)
if (!usage || Object.keys(usage).length === 0) {
  const lastMessage = typedResult.messages?.[typedResult.messages.length - 1];
  if (lastMessage) {
    usage = 
      lastMessage.response_metadata?.usage ||
      lastMessage.response_metadata?.tokenUsage ||
      lastMessage.usage_metadata ||
      usage;
  }
}

// 3. Tentar de todas as mensagens
if (!usage || Object.keys(usage).length === 0) {
  for (const msg of typedResult.messages || []) {
    const msgUsage = 
      msg.response_metadata?.usage ||
      msg.response_metadata?.tokenUsage ||
      msg.usage_metadata;
    if (msgUsage && Object.keys(msgUsage).length > 0) {
      usage = msgUsage;
      break;
    }
  }
}
```

## Resultado

Agora os tokens são extraídos corretamente:
- ✅ **Prompt tokens**: 9,565 (enviados)
- ✅ **Completion tokens**: 527 (recebidos)
- ✅ **Total tokens**: 10,092

## Logs de Debug Adicionados

Adicionamos logs detalhados para ajudar no debugging futuro:

1. **Agent result structure**: Mostra toda a estrutura do resultado
2. **Token usage extracted**: Mostra o objeto de usage encontrado
3. **LLM extraction response sample**: Preview da resposta completa (1000 chars)

## Melhorias Adicionais

1. ✅ Separação de tokens em `tokensPrompt` e `tokensCompletion` no resultado
2. ✅ Cálculo automático de total se prompt + completion estiverem disponíveis
3. ✅ Logs estruturados com todos os detalhes
4. ✅ Preview da resposta da LLM nos logs de debug

## Exemplo de Uso Agora

```typescript
const result = await pipeline.run(pdfBuffer, options);

console.log(`Tokens enviados: ${result.metadata.tokensPrompt}`);
console.log(`Tokens recebidos: ${result.metadata.tokensCompletion}`);
console.log(`Total: ${result.metadata.tokensUsed}`);
```

## Nota Importante

O LangChain pode retornar tokens em diferentes formatos dependendo da versão:
- `response_metadata.usage` (formato OpenAI padrão)
- `usage_metadata` (formato LangChain padrão)
- `messages[].response_metadata.usage` (formato createAgent)

Nossa implementação agora tenta todos esses formatos para máxima compatibilidade.

