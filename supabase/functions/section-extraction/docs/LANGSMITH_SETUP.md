# Configuração LangSmith para Section Extraction

## Como Funciona o LangSmith Tracing

O LangSmith funciona **automaticamente** quando as variáveis de ambiente estão configuradas. Não precisa importar nada adicional - o LangChain já vem com suporte integrado.

## Variáveis de Ambiente Necessárias

Adicione estas variáveis no seu `.env`:

```bash
# OpenAI (obrigatório)
OPENAI_API_KEY=sk-proj-...

# LangSmith (opcional, mas recomendado)
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=section-extraction  # Opcional - usa "default" se não especificado
```

## Variáveis Aceitas

O LangChain aceita tanto `LANGSMITH_*` quanto `LANGCHAIN_*` (compatibilidade):

- `LANGSMITH_API_KEY` ou `LANGCHAIN_API_KEY`
- `LANGSMITH_TRACING` ou `LANGCHAIN_TRACING`
- `LANGSMITH_PROJECT` ou `LANGCHAIN_PROJECT`
- `LANGSMITH_ENDPOINT` ou `LANGCHAIN_ENDPOINT` (opcional, para self-hosted)

## Como Obter a API Key LangSmith

1. Acesse https://smith.langchain.com
2. Faça login ou crie conta
3. Vá em **Settings** → **API Keys**
4. Copie a API key (começa com `lsv2_pt_...`)
5. Adicione no `.env`

## Verificação Automática

O script `run-e2e-test.ts` agora:
1. ✅ Carrega variáveis do `.env`
2. ✅ Configura `Deno.env.set()` antes de usar LangChain
3. ✅ Habilita `LANGSMITH_TRACING=true` automaticamente se API key estiver presente
4. ✅ Mostra logs indicando se LangSmith está configurado

## Logs Esperados

Quando LangSmith está configurado corretamente, você verá:

```
✅ LANGSMITH_API_KEY configurada
✅ LANGSMITH_TRACING=true (habilitado automaticamente)
✅ LANGSMITH_PROJECT=section-extraction
```

## Verificar Traces no LangSmith

1. Após executar o teste, acesse https://smith.langchain.com
2. Vá em **Traces** ou **Projects**
3. Procure pelo projeto "section-extraction" (ou "default")
4. Você verá os traces da execução com:
   - Tempo de execução de cada etapa
   - Tokens usados
   - Input/output completo
   - Erros (se houver)

## Importante para Serverless

Em ambientes serverless (como Edge Functions), o LangChain já trata automaticamente o flush dos traces. Mas se precisar garantir, você pode adicionar:

```typescript
import { Client } from "langsmith";

const client = new Client();
// ... código ...
await client.awaitPendingTraceBatches();
```

Mas isso **não é necessário** no nosso caso porque o LangChain faz isso automaticamente quando as variáveis estão configuradas.

## Não Precisa Instalar Nada

O `langsmith` já vem como dependência do `langchain@1`, então **não precisa instalar nada adicional**. Apenas configure as variáveis de ambiente!

