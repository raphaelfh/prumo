# Section Extraction Edge Function

Edge Function para extração de IA focada em uma seção específica (entity type) de um template de extração.

## Funcionalidades

- **Extração granular**: Extrai apenas uma seção por vez, permitindo controle fino pelo usuário
- **Schema enriquecido**: Cada campo retorna metadata (confidence_score, reasoning, evidence)
- **Observabilidade**: Transparência completa sobre de onde a IA extraiu informações
- **Suporte a cardinalidades**: Funciona com "one" (única instância) e "many" (múltiplas instâncias)
- **Pipeline isolado**: Implementação própria, não reutiliza módulos compartilhados

## Arquitetura

```
section-extraction/index.ts (handler principal)
    ↓
SectionExtractionPipeline.run()
    ├─ SectionPDFProcessor → Extrai texto do PDF
    ├─ SectionTemplateBuilder → Constrói schema Zod enriquecido + prompt
    ├─ SectionLLMExtractor → Extrai dados com LangChain (providerStrategy)
    ├─ getInstances() → Busca instâncias existentes do entity_type
    ├─ buildFieldMapping() → Mapeia campos para instâncias
    └─ SectionDBWriter → Salva em extraction_runs e ai_suggestions
```

## Requisitos

### Variáveis de Ambiente

Configure no dashboard do Supabase (Edge Functions → Settings):

- `OPENAI_API_KEY`: Chave da API OpenAI
- `SUPABASE_URL`: URL do projeto (configurado automaticamente)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (configurado automaticamente)

## Deploy

```bash
supabase functions deploy section-extraction
```

## Uso

### Request

```typescript
POST /functions/v1/section-extraction
Content-Type: application/json
Authorization: Bearer <user_token>
x-client-trace-id: <optional_uuid>

{
  "projectId": "uuid",
  "articleId": "uuid",
  "templateId": "uuid",
  "entityTypeId": "uuid",  // Nova: seção específica a extrair
  "options": {
    "model": "gpt-4o"  // opcional: "gpt-4o-mini" | "gpt-4o" | "gpt-5" (padrão: gpt-4o para economizar custos)
  }
}
```

### Response (Sucesso)

```json
{
  "ok": true,
  "data": {
    "runId": "uuid",
    "status": "completed",
    "suggestionsCreated": 12,
    "metadata": {
      "pdfPages": 15,
      "tokensUsed": 4500,
      "duration": 8500
    }
  },
  "traceId": "uuid"
}
```

### Response (Erro)

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "No instances found for this section. Please create at least one instance before extracting.",
    "details": {
      "entityTypeId": "uuid",
      "entityTypeName": "source_of_data",
      "cardinality": "one"
    }
  }
}
```

## Schema Enriquecido

### Estrutura de Dados Retornada pelo LLM

Cada campo extraído retorna uma estrutura enriquecida:

```typescript
{
  fieldName: {
    value: any,                    // Valor extraído
    confidence_score: number,      // 0.0 - 1.0
    reasoning: string,            // Justificativa/raciocínio
    evidence?: {                   // Trecho do texto (opcional)
      text: string,
      page_number?: number
    }
  }
}
```

### Mapeamento para Banco de Dados

- `value` → `ai_suggestions.suggested_value.value` (JSONB)
- `confidence_score` → `ai_suggestions.confidence_score` (DECIMAL)
- `reasoning` → `ai_suggestions.reasoning` (TEXT)
- `evidence` → `ai_suggestions.metadata.evidence` (JSONB - coluna metadata separada)

## Comportamento

### Cardinality "one"

- Busca 1 instância existente do entity_type
- Se não existir: retorna erro pedindo para criar instância
- Extrai dados para essa única instância

### Cardinality "many"

- Busca TODAS as instâncias existentes do entity_type
- Se não houver instâncias: retorna erro pedindo para criar
- Extrai dados para TODAS as instâncias (cada uma recebe suas próprias sugestões)

## Tratamento de Erros

| ErrorCode | Status | Descrição |
|-----------|--------|-----------|
| VALIDATION_ERROR | 400 | Input inválido (UUIDs malformados, campos faltando) |
| AUTH_ERROR | 401 | Não autenticado |
| NOT_FOUND | 404 | PDF não encontrado OU instâncias não encontradas |
| LLM_ERROR | 500 | Falha na extração LLM (com retry automático) |
| DB_ERROR | 500 | Falha no banco de dados |

## Observabilidade

Logs estruturados em JSON:

```json
{
  "timestamp": "2025-01-15T18:00:00.000Z",
  "level": "info",
  "message": "Pipeline completed successfully",
  "context": {
    "traceId": "uuid",
    "runId": "uuid",
    "userId": "uuid",
    "entityTypeId": "uuid"
  },
  "data": {
    "duration": "8500ms",
    "suggestionsCreated": 12,
    "tokensUsed": 4500
  }
}
```

## Diferenças em relação ao pdf-extraction

| Aspecto | pdf-extraction | section-extraction |
|---------|---------------|-------------------|
| Escopo | Extração completa (todas as seções) | Extração granular (1 seção) |
| Schema | Simples (valor apenas) | Enriquecido (value + metadata) |
| Instâncias | Cria automaticamente | Requer instâncias existentes |
| Uso | Extração em lote | Extração sob demanda (via botão) |
| Observabilidade | Básica | Completa (reasoning, evidence) |

## Próximos Passos

- [ ] Suporte a chunking inteligente para PDFs muito grandes
- [ ] Cache de schemas construídos (similar ao TemplateBuilder de _shared)
- [ ] Suporte a Unstructured API como alternativa ao pdf-parse
- [ ] Streaming de resultados (opcional)
- [ ] Rate limiting por usuário

