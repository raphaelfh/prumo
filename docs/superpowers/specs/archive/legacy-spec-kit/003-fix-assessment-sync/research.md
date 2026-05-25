# Research: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Branch**: `003-fix-assessment-sync` | **Date**: 2026-02-19

## Root Cause Analysis

### Problema reportado

Após o backend retornar sucesso na avaliação com IA, o frontend não exibe o card de sugestão — o radio button permanece inalterado e o usuário precisa de ação manual.

### Investigação do fluxo de dados

O fluxo completo foi rastreado arquivo por arquivo:

```
handleTriggerAI(itemId)
  → useSingleAssessment.assessItem(request)
    → AssessmentService.assessSingleItem() → POST /api/v1/ai-assessment/ai
      → Backend cria ai_suggestion no banco e retorna { ok, data: { id, selectedLevel, ... } }
    → Toast de sucesso ("Avaliação concluída! Sugestão: ...")
    → onSuccess(suggestionId) callback
      → setTriggeringItemId(null)  ← [ISSUE 1: loading limpo antes do refresh]
      → IIFE async:
        → delay 1.5s
        → refreshSuggestions() → loadSuggestions()
          → AIAssessmentSuggestionService.loadSuggestions()
            → Supabase query: ai_suggestions JOIN ai_assessment_runs
            → Mapeia para Record<string, AIAssessmentSuggestion>
              → key: ai_suggestion_${effectiveItemId}
              → effectiveItemId = assessment_item_id || project_assessment_item_id  ← [ISSUE 2: XOR key]
        → result.count > 0 ?  ← [ISSUE 3: sempre true se já existem sugestões]
          → Se sim: para polling
          → Se não: retry até 5 vezes
  → setSuggestions(newSuggestions) → re-render
    → AssessmentFormPanel → DomainAccordion
      → aiSuggestions?.[getAssessmentSuggestionKey(item.id)]  ← [ISSUE 4: key do componente]
        → AssessmentItemInput recebe aiSuggestion prop
          → hasPendingSuggestion? → Renderiza card
```

### Issues identificadas

#### ISSUE 1: Loading state limpo antes do refresh (Severidade: Baixa)

**Local**: `AssessmentFullScreen.tsx`, linha 163
```typescript
setTriggeringItemId(null); // Loading para ANTES do refresh
```

`triggeringItemId` é limpo no início do `onSuccess`, antes do polling começar. O spinner desaparece mas a sugestão ainda não apareceu — gap visual de ~1.5s+ sem feedback.

**Impacto**: UX confusa — o spinner desaparece mas nada aparece. Não é o bug principal, mas contribui para a sensação de que "nada aconteceu".

**Fix**: Mover `setTriggeringItemId(null)` para DEPOIS do `refreshSuggestions()` retornar com sucesso.

#### ISSUE 2: XOR key mismatch (Severidade: ALTA — possível root cause principal)

**Local**: `aiAssessmentSuggestionService.ts`, linha 192
```typescript
const effectiveItemId = item.assessment_item_id || item.project_assessment_item_id;
```

Vs `DomainAccordion.tsx`:
```typescript
aiSuggestion={aiSuggestions?.[getAssessmentSuggestionKey(item.id)]}
```

O `item.id` no DomainAccordion vem de `items` (lista de assessment items). Se esses itens são de uma tabela `project_assessment_items`, o `item.id` é o `project_assessment_item_id`. Mas no banco, a sugestão pode ter sido armazenada no campo `assessment_item_id` (global) OU `project_assessment_item_id` (project-scoped).

**Se o backend armazenar no campo errado**, a chave do serviço (`ai_suggestion_${assessment_item_id}`) não bate com a chave do componente (`ai_suggestion_${project_assessment_item_id}`), e a sugestão NUNCA é encontrada pelo componente.

**Verificação necessária**: Confirmar qual campo o backend usa para armazenar o item ID na tabela `ai_suggestions` quando o endpoint `/api/v1/ai-assessment/ai` é chamado. Comparar com o campo que `DomainAccordion` usa (`item.id`).

**Fix**: Normalizar a chave para usar sempre o mesmo ID que o componente frontend usa. Se necessário, ajustar a query `loadSuggestions` para mapear corretamente.

#### ISSUE 3: Polling condicional com lógica falha (Severidade: Média)

**Local**: `AssessmentFullScreen.tsx`, linhas 172-178
```typescript
let result = await refreshSuggestions();
let foundSuggestions = result.count > 0;
if (foundSuggestions) {
  return; // Para imediatamente se qualquer sugestão existe
}
```

A condição `result.count > 0` verifica se QUALQUER sugestão existe (incluindo accepted/rejected de avaliações anteriores). Se o usuário já avaliou outros itens, `count > 0` é sempre `true` e o polling para na primeira tentativa — sem garantir que a NOVA sugestão foi encontrada.

**Impacto**: O polling é ineficaz quando já existem sugestões anteriores. Porém, se o backend já completou antes do `onSuccess` (o que é esperado — o API call retornou), a sugestão JÁ deveria estar no banco. O delay de 1.5s é desnecessário nesse caso.

**Fix**: Remover o polling e fazer refresh direto, ou mudar a condição para verificar a existência da sugestão ESPECÍFICA (por item ID) ao invés de `count > 0`.

#### ISSUE 4: Verificação de renderização do card (Severidade: Baixa)

**Local**: `AssessmentItemInput.tsx`, linha 179
```typescript
{hasPendingSuggestion && aiSuggestion && (
  <Card className="p-4 bg-purple-50/50 ...">
```

`hasPendingSuggestion` provavelmente verifica `aiSuggestion?.status === 'pending'`. Se a sugestão chegar com status diferente, o card não aparece.

**Verificação necessária**: Confirmar a definição de `hasPendingSuggestion`.

**Fix**: Verificar que sugestões recém-criadas sempre chegam com status `'pending'`.

### Conclusão: Root cause provável

A combinação das Issues 1, 2 e 3 cria o bug:
1. O loading spinner desaparece prematuramente (Issue 1)
2. A sugestão PODE não ser encontrada por key mismatch (Issue 2)
3. O polling para imediatamente sem esperar pela sugestão correta (Issue 3)
4. Resultado: o usuário vê o toast "Avaliação concluída!" mas nada muda na interface

## Design Decisions

### Decision 1: Estratégia de refresh pós-AI

- **Decision**: Substituir polling por refresh direto com fallback
- **Rationale**: O backend retorna sucesso APÓS criar a sugestão no banco. Quando `onSuccess` é chamado, a sugestão já existe. O delay de 1.5s e o polling são desnecessários. Um refresh direto é suficiente, com 1 retry como fallback.
- **Alternatives considered**:
  - Manter polling atual: Rejeitado — lógica `count > 0` é falha
  - WebSocket/Realtime: Over-engineering para um cenário síncrono
  - Retornar sugestão completa no response da AI: Exigiria mudança no backend (fora do escopo)

### Decision 2: Normalização de keys (XOR pattern)

- **Decision**: Investigar e normalizar o mapeamento de IDs no serviço `loadSuggestions`. Garantir que `effectiveItemId` sempre corresponde ao `item.id` usado nos componentes.
- **Rationale**: O pattern XOR (`assessment_item_id || project_assessment_item_id`) é necessário para suportar instrumentos globais e por projeto, mas a resolução deve ser consistente entre backend e frontend.
- **Alternatives considered**:
  - Mudar o backend para unificar: Fora do escopo
  - Usar lookup reverso no frontend: Complexo e frágil

### Decision 3: Gestão do loading state

- **Decision**: Manter `triggeringItemId` ativo até o card de sugestão aparecer (ou até o refresh falhar). Mover o `setTriggeringItemId(null)` para depois do refresh.
- **Rationale**: O spinner é o único feedback visual entre o clique e o resultado. Removê-lo prematuramente causa confusão.
- **Alternatives considered**:
  - Estado de loading separado (ex: "refreshing"): Adiciona complexidade sem benefício claro
  - Toast como único feedback: Insuficiente — o toast some e o campo permanece vazio

### Decision 4: Reutilização de componentes AI

- **Decision**: Os componentes de UI já existem e funcionam (`AISuggestionInline`, `AISuggestionConfidence`, `AISuggestionDetailsPopover`, `AISuggestionEvidence`). Não são necessárias alterações nos componentes visuais. O fix é na camada de hooks/estado.
- **Rationale**: A investigação mostrou que `AssessmentItemInput.tsx` já renderiza o card de sugestão corretamente quando recebe `aiSuggestion` como prop. O problema está em como `aiSuggestion` chega ao componente (Issues 1-3).
- **Alternatives considered**: N/A — Componentes UI já estão prontos

## Assumptions Validated

1. ✅ Backend retorna dados corretos — Confirmado pelo toast de sucesso que mostra nível e confiança
2. ✅ Componentes de UI já existem — Assessment tem `AISuggestionInline`, `AISuggestionConfidence`, `AISuggestionDetailsPopover`, `AISuggestionEvidence`
3. ✅ `ai_suggestions` suporta assessment — Confirmado pela query com `assessment_item_id`/`project_assessment_item_id`
4. ✅ Fluxo accept/reject funciona — `useAIAssessmentSuggestions` tem `acceptSuggestion`/`rejectSuggestion` implementados

## Files to Modify

| File                                                         | Type        | Change                                                                                                                 |
|--------------------------------------------------------------|-------------|------------------------------------------------------------------------------------------------------------------------|
| `frontend/pages/AssessmentFullScreen.tsx`                    | Fix         | Refatorar `onSuccess`: remover polling, fazer refresh direto, mover `setTriggeringItemId(null)` para depois do refresh |
| `frontend/hooks/assessment/ai/useAIAssessmentSuggestions.ts` | Fix         | Garantir que `refresh()` retorna dados corretamente; adicionar verificação de sugestão específica                      |
| `frontend/services/aiAssessmentSuggestionService.ts`         | Investigate | Verificar mapeamento de keys (`effectiveItemId`) vs `item.id` dos componentes                                          |
| `frontend/components/assessment/AssessmentItemInput.tsx`     | Verify      | Confirmar `hasPendingSuggestion` logic; ajustar se necessário                                                          |

## Risks

1. **Key mismatch pode ter múltiplas variantes** — Instrumentos globais vs project-scoped podem usar IDs diferentes. Requer investigação cuidadosa.
2. **Auto-save conflict** — O `useAssessmentAutoSave` pode interferir se o `updateResponse` do accept trigger um save antes do estado estar estável.
3. **Memoização excessiva** — `MemoizedAssessmentItemInput` pode não re-renderizar se a função de comparação não detectar mudança em `aiSuggestion`.
