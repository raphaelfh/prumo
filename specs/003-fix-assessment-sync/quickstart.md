# Quickstart: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Branch**: `003-fix-assessment-sync` | **Date**: 2026-02-19

## Prerequisites

- Node 18+, npm
- Supabase local running (`supabase start`)
- Backend running (`cd backend && uv run uvicorn app.main:app --reload --port 8000`)
- Frontend running (`npm run dev`)

## Implementation Guide

### Step 1: Investigate Key Mismatch (ISSUE 2 — Critical)

**Goal**: Confirmar se `item.id` no frontend bate com `effectiveItemId` no serviço.

1. Abrir o browser em `http://localhost:8080` e navegar para Assessment
2. Abrir DevTools Console
3. Clicar "Avaliar com IA" em um item
4. Observar os logs:
   - `🤖 [useSingleAssessment] Iniciando avaliação { itemId: "XXX" }` → anotar o `itemId`
   - `✅ [loadSuggestions] Sugestão adicionada: ai_suggestion_YYY` → anotar o `YYY`
5. Se `XXX !== YYY`, confirma key mismatch
6. Verificar no banco: `SELECT assessment_item_id, project_assessment_item_id FROM ai_suggestions WHERE id = '<suggestion_id>'`

**Fix se confirmado**: Em `aiAssessmentSuggestionService.ts`, ajustar a resolução de `effectiveItemId` para priorizar o campo que corresponde ao `item.id` do frontend. Ou adicionar lógica de normalização.

### Step 2: Fix onSuccess Flow (ISSUE 1 + ISSUE 3)

**File**: `src/pages/AssessmentFullScreen.tsx`

Refatorar o callback `onSuccess` do `useSingleAssessment`:

```typescript
// ANTES (buggy):
onSuccess: async (suggestionId) => {
  setTriggeringItemId(null); // ← Limpa loading prematuramente
  (async () => {
    await new Promise(resolve => setTimeout(resolve, 1500)); // ← Delay desnecessário
    let result = await refreshSuggestions();
    let foundSuggestions = result.count > 0; // ← Sempre true se existem sugestões antigas
    // ... polling
  })();
}

// DEPOIS (fixed):
onSuccess: async (suggestionId) => {
  try {
    // Refresh direto — sugestão já existe no banco quando onSuccess é chamado
    const result = await refreshSuggestions();

    if (result.count === 0) {
      // Fallback: 1 retry com delay curto
      await new Promise(resolve => setTimeout(resolve, 1000));
      await refreshSuggestions();
    }
  } catch (error) {
    console.error('❌ Erro ao recarregar sugestões:', error);
  } finally {
    // Limpar loading APÓS refresh (sempre, mesmo em erro)
    setTriggeringItemId(null);
  }
}
```

**Mudanças-chave**:
- `setTriggeringItemId(null)` movido para `finally` (após refresh)
- Removido delay de 1.5s (sugestão já existe no banco)
- Removido polling complexo (1 retry simples como fallback)
- Removido IIFE desnecessário

### Step 3: Fix Key Mapping (se Issue 2 confirmada)

**File**: `src/services/aiAssessmentSuggestionService.ts`

Se o key mismatch for confirmado, ajustar em `loadSuggestions`:

```typescript
// ANTES:
const effectiveItemId = item.assessment_item_id || item.project_assessment_item_id;

// DEPOIS (priorizar project_assessment_item_id se ambos existirem):
const effectiveItemId = item.project_assessment_item_id || item.assessment_item_id;
```

Ou, se necessário, adicionar lógica baseada no tipo de instrumento:

```typescript
const effectiveItemId = (() => {
  // Para instrumentos por projeto, usar project_assessment_item_id
  if (item.project_assessment_item_id) return item.project_assessment_item_id;
  // Para instrumentos globais, usar assessment_item_id
  return item.assessment_item_id;
})();
```

### Step 4: Verify AssessmentItemInput Rendering

**File**: `src/components/assessment/AssessmentItemInput.tsx`

Confirmar que `hasPendingSuggestion` detecta sugestões recém-criadas:

```typescript
// Verificar esta condição:
const hasPendingSuggestion = aiSuggestion?.status === 'pending';
```

Se a condição estiver correta, nenhuma mudança é necessária neste componente.

### Step 5: Verify MemoizedAssessmentItemInput

**File**: `src/components/assessment/DomainAccordion.tsx` (ou onde o memo é definido)

Se `AssessmentItemInput` é memoizado com `React.memo`, verificar que a função de comparação inclui `aiSuggestion`:

```typescript
// Verificar que aiSuggestion é comparado
const MemoizedAssessmentItemInput = React.memo(
  AssessmentItemInput,
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.value === next.value &&
      prev.aiSuggestion === next.aiSuggestion && // ← Deve estar incluído
      prev.isTriggerLoading === next.isTriggerLoading &&
      // ...
    );
  }
);
```

Se `aiSuggestion` não estiver na comparação, o componente NÃO re-renderiza quando a sugestão muda.

### Step 6: Fix Batch Assessment onComplete (Same Pattern)

**File**: `src/pages/AssessmentFullScreen.tsx`

Aplicar o mesmo fix do Step 2 ao `onComplete` do `useBatchAssessment`:

```typescript
// ANTES (buggy):
onComplete: async () => {
  await new Promise(resolve => setTimeout(resolve, 1500));
  let result = await refreshSuggestions();
  // ... polling
}

// DEPOIS (fixed):
onComplete: async () => {
  try {
    const result = await refreshSuggestions();
    if (result.count === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await refreshSuggestions();
    }
  } catch (error) {
    console.error('❌ Erro ao recarregar sugestões após batch:', error);
  }
}
```

## Testing Checklist

### Manual Testing

1. **Navegação**: Ir para Assessment de qualquer artigo
2. **Trigger AI**: Clicar "Avaliar com IA" em um item sem sugestão
3. **Verificar loading**: Spinner aparece e permanece até a sugestão carregar
4. **Verificar card**: Após loading, card de sugestão aparece com:
   - Badge "IA sugere"
   - Nível sugerido (ex: "no information")
   - Badge de confiança (ex: "80%")
   - Botões Aceitar/Rejeitar
5. **Verificar confiança popover**: Clicar no badge de confiança → popover com reasoning
6. **Aceitar**: Clicar "Aceitar" → radio button selecionado, card muda para "IA aceita"
7. **Rejeitar**: Em novo item, avaliar com IA → clicar "Rejeitar" → card some, radio button inalterado
8. **Toast**: Após avaliação, toast mostra nível sugerido + confiança + tokens
9. **Múltiplos itens**: Avaliar 2+ itens em sequência, cada um com loading independente

### Edge Cases

1. **Item já avaliado**: Avaliar com IA um item que já tem resposta manual → sugestão aparece, ao aceitar substitui resposta anterior
2. **Erro do backend**: Simular erro (ex: desligar backend) → mensagem de erro, estado inalterado
3. **Re-avaliação**: Rejeitar sugestão → botão "Avaliar com IA" reaparece → avaliar novamente → nova sugestão aparece
4. **Navegação entre domínios**: Trigger AI → navegar para outro domínio → voltar → loading preservado
