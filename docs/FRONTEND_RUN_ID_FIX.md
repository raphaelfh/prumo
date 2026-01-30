# Frontend run_id → assessment_run_id Fix

**Date**: 2026-01-29
**Related**: BACKEND_RUN_ID_MIGRATION.md
**Purpose**: Fix frontend code to use new `assessment_run_id` field in `ai_suggestions` table

## Problem

Depois de aplicar a migração 0033 no backend, o frontend ainda estava tentando:
1. Fazer JOIN com `ai_assessment_runs` sem especificar qual FK usar (ambíguo)
2. Acessar `suggestion.run_id` que foi renomeado para `assessment_run_id`

**Erro no Console**:
```
Could not find a relationship between 'ai_suggestions' and 'ai_assessment_runs' in the schema cache
```

## Root Cause

A tabela `ai_suggestions` agora tem **duas FKs** apontando para tabelas de runs diferentes:
- `extraction_run_id` → `extraction_runs` (para extraction suggestions)
- `assessment_run_id` → `ai_assessment_runs` (para assessment suggestions)

Quando o frontend faz:
```typescript
.select('*, ai_assessment_runs!inner (...)')
```

O Supabase não sabe qual FK usar (é ambíguo). Precisamos especificar explicitamente:
```typescript
.select('*, ai_assessment_runs!ai_suggestions_assessment_run_id_fkey!inner (...)')
```

## Solution

### Files Modified (3 arquivos)

#### 1. Service: aiAssessmentSuggestionService.ts

**Linha 137-149**: Especificado FK explicitamente no JOIN
```typescript
// ANTES
const query = supabase
  .from('ai_suggestions')
  .select(`
    *,
    ai_assessment_runs!inner (  // ❌ Ambíguo
      project_id,
      article_id,
      instrument_id,
      extraction_instance_id
    )
  `)

// DEPOIS
const query = supabase
  .from('ai_suggestions')
  .select(`
    *,
    ai_assessment_runs!ai_suggestions_assessment_run_id_fkey!inner (  // ✅ FK explícita
      project_id,
      article_id,
      instrument_id,
      extraction_instance_id
    )
  `)
```

**Linha 300**: Atualizado acesso ao run_id
```typescript
// ANTES
.eq('id', suggestion.run_id)

// DEPOIS
.eq('id', suggestion.assessment_run_id)
```

#### 2. Types: assessment.ts

**Interface AIAssessmentSuggestion (linha 209-222)**:
```typescript
// ANTES
export interface AIAssessmentSuggestion {
  id: string;
  run_id: string;  // ❌ Campo antigo
  assessment_item_id: string;
  ...
}

// DEPOIS
export interface AIAssessmentSuggestion {
  id: string;
  assessment_run_id: string;  // ✅ Para assessment suggestions
  assessment_item_id: string;
  ...
}
```

**Interface AIAssessmentSuggestionRaw (linha 243-258)**:
```typescript
// ANTES
export interface AIAssessmentSuggestionRaw {
  id: string;
  run_id: string;  // ❌ Campo antigo
  ...
}

// DEPOIS
export interface AIAssessmentSuggestionRaw {
  id: string;
  assessment_run_id: string;        // ✅ FK para ai_assessment_runs
  extraction_run_id: string | null; // ✅ FK para extraction_runs (não usado)
  ...
}
```

#### 3. Utils: assessment-utils.ts

**Função normalizeAIAssessmentSuggestion (linha 232-244)**:
```typescript
// ANTES
return {
  id: raw.id,
  run_id: raw.run_id,  // ❌
  ...
};

// DEPOIS
return {
  id: raw.id,
  assessment_run_id: raw.assessment_run_id,  // ✅
  ...
};
```

## Foreign Key Name Reference

Para especificar FKs explicitamente no Supabase, use o padrão:
```
{table_name}_{column_name}_fkey
```

Exemplos para `ai_suggestions`:
- `ai_suggestions_assessment_run_id_fkey` - FK para `ai_assessment_runs`
- `ai_suggestions_extraction_run_id_fkey` - FK para `extraction_runs`

Você pode verificar os nomes das FKs com:
```sql
SELECT constraint_name, table_name, column_name
FROM information_schema.key_column_usage
WHERE table_name = 'ai_suggestions'
  AND constraint_name LIKE '%_fkey';
```

## Testing Checklist

### ✅ Verificações Necessárias

1. **Carregamento de Sugestões**:
   - Acessar seção de Quality Assessment
   - Verificar que sugestões de AI carregam sem erro
   - Console não deve mostrar erro de relationship

2. **Aceitação de Sugestões**:
   - Clicar em "Accept" em uma sugestão
   - Verificar que a resposta é salva corretamente
   - Status da sugestão deve mudar para "accepted"

3. **Rejeição de Sugestões**:
   - Clicar em "Reject" em uma sugestão aceita
   - Verificar que a resposta é removida
   - Status deve mudar para "rejected"

4. **Histórico de Sugestões**:
   - Visualizar histórico de um item
   - Verificar que mostra todas as sugestões passadas

### 🔍 Logs Esperados

Console deve mostrar:
```
🤖 [useAIAssessmentSuggestions] Carregando sugestões...
📊 [loadSuggestions] Processando N sugestão(ões) do banco
✅ [loadSuggestions] Sugestão adicionada: ai_suggestion_{itemId}
🎯 [loadSuggestions] Total de N sugestão(ões) únicas mapeadas
```

## Additional Issue: Missing assessments VIEW (404 errors)

### Problem
After fixing the relationship error, accessing the quality assessment page resulted in:
```
Erro ao carregar artigos: Erro ao carregar artigos
Failed to load resource: the server responded with a status of 404 (Not Found)
GET /rest/v1/assessments
```

### Root Cause
Migration 0032_cleanup_legacy_assessment.sql removed the `assessments` VIEW because "app not in production yet", but frontend still queries `/rest/v1/assessments` endpoint.

### Solution
Created migration 20260129120420_restore_assessments_compatibility_view.sql to restore the VIEW:

- **VIEW**: `assessments` - Aggregates `assessment_responses` back to flat JSONB format
- **Triggers**: INSTEAD OF triggers redirect INSERT/UPDATE/DELETE to `assessment_instances` + `assessment_responses`
- **Security**: `security_invoker=true` - Uses permissions of calling user
- **Permissions**: Granted SELECT, INSERT, UPDATE, DELETE to `authenticated` and `service_role`

**Files**:
- [Migration 20260129120420](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/supabase/migrations/20260129120420_restore_assessments_compatibility_view.sql?type=file&root=%252F) - Restore assessments VIEW

### Notes
- Migration file was initially created with Portuguese comments (UTF-8 encoding issue)
- Rewritten with ASCII-only comments to avoid PostgreSQL encoding errors
- VIEW is temporary compatibility layer - will be removed when frontend is refactored

## Relacionado

- [BACKEND_RUN_ID_MIGRATION.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/BACKEND_RUN_ID_MIGRATION.md?type=file&root=%252F) - Mudanças no backend
- [ASSESSMENT_AI_SUGGESTIONS_FIX.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/ASSESSMENT_AI_SUGGESTIONS_FIX.md?type=file&root=%252F) - Análise original do problema
- [Migration 0033](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/supabase/migrations/0033_ai_suggestions_assessment_support.sql?type=file&root=%252F) - SQL da migração

---

**Status**: ✅ Complete - Frontend atualizado para usar assessment_run_id + assessments VIEW restored
**Last Updated**: 2026-01-29
