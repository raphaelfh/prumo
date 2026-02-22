# Data Model: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Branch**: `003-fix-assessment-sync` | **Date**: 2026-02-19

> Nenhuma alteração de schema no banco de dados. Este documento descreve as entidades e o fluxo de estado no **frontend** que são relevantes para a correção.

## Database Entities (Existing — Read Only)

### `ai_suggestions`

Tabela compartilhada entre Extraction e Assessment.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | PK |
| `assessment_run_id` | UUID | FK → `ai_assessment_runs.id` (nullable) |
| `assessment_item_id` | UUID | FK → `assessment_items.id` (global instruments, nullable) |
| `project_assessment_item_id` | UUID | FK → `project_assessment_items.id` (project-scoped, nullable) |
| `suggested_value` | JSONB | `{ level: string, evidence_passages: EvidencePassage[] }` |
| `confidence_score` | FLOAT | 0.0 - 1.0 |
| `reasoning` | TEXT | Justificativa da IA |
| `status` | ENUM | `'pending' \| 'accepted' \| 'rejected'` |
| `reviewed_by` | UUID | FK → `auth.users.id` (nullable) |
| `reviewed_at` | TIMESTAMPTZ | Nullable |
| `created_at` | TIMESTAMPTZ | Default now() |

**XOR constraint**: Exatamente um de `assessment_item_id` ou `project_assessment_item_id` deve ser non-null (para assessment suggestions).

### `ai_assessment_runs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | PK |
| `project_id` | UUID | FK → `projects.id` |
| `article_id` | UUID | FK → `articles.id` |
| `instrument_id` | UUID | FK → `assessment_instruments.id` (nullable, global) |
| `project_instrument_id` | UUID | FK → `project_assessment_instruments.id` (nullable, project-scoped) |
| `extraction_instance_id` | UUID | Nullable |

### `assessment_responses`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | PK |
| `assessment_id` | UUID | FK → `assessments.id` |
| `item_id` | UUID | FK → assessment item (global or project-scoped) |
| `selected_level` | TEXT | O nível escolhido pelo usuário |
| `notes` | TEXT | Notas do revisor |
| `evidence` | JSONB | `EvidencePassage[]` |

## Frontend State Model

### `useAIAssessmentSuggestions` Hook State

```typescript
// Key format
type SuggestionKey = `ai_suggestion_${string}`;  // ai_suggestion_${itemId}

// State
suggestions: Record<SuggestionKey, AIAssessmentSuggestion>;
loading: boolean;
actionLoading: Record<SuggestionKey, 'accept' | 'reject' | null>;
```

### `AIAssessmentSuggestion` Type

```typescript
interface AIAssessmentSuggestion {
  id: string;                    // UUID da sugestão
  suggested_value: {
    level: AssessmentLevel;      // ex: "yes", "no", "no information"
    evidence_passages: EvidencePassage[];
  };
  confidence_score: number;      // 0.0 - 1.0
  reasoning: string;             // Justificativa da IA
  status: 'pending' | 'accepted' | 'rejected';
  reviewed_by?: string;          // UUID do revisor
  reviewed_at?: string;          // ISO timestamp
  created_at: string;            // ISO timestamp
}
```

### `useAssessmentResponses` Hook State

```typescript
// State
responses: Record<string, AssessmentResponse>;  // key: item_id

interface AssessmentResponse {
  item_id: string;
  selected_level: string;        // AssessmentLevel
  notes: string | null;
  evidence: EvidencePassage[];
}
```

### `useSingleAssessment` Hook State

```typescript
loading: boolean;                // true while AI is processing
error: Error | null;
```

### Page-level State (`AssessmentFullScreen`)

```typescript
triggeringItemId: string | null; // ID do item sendo avaliado pela IA
```

## State Flow Diagram

### Current Flow (Buggy)

```
[1] User clicks "Avaliar com IA"
     │
     ▼
[2] triggeringItemId = itemId → spinner ON
     │
     ▼
[3] assessItem(request) → POST /api/v1/ai-assessment/ai
     │
     ▼ (backend returns success)
[4] Toast: "Avaliação concluída!"
     │
     ▼
[5] onSuccess(suggestionId):
     ├── triggeringItemId = null → spinner OFF ← [BUG: premature]
     └── IIFE async:
          ├── delay 1.5s ← [BUG: desnecessário]
          ├── refreshSuggestions()
          │    └── loadSuggestions() → Supabase query
          │         └── Maps by effectiveItemId ← [BUG: possível key mismatch]
          └── if count > 0: stop ← [BUG: true para sugestões antigas]
               │
               ▼
[6] suggestions state updated (mas possivelmente com key errada)
     │
     ▼
[7] DomainAccordion lookup: aiSuggestions[ai_suggestion_${item.id}]
     │
     ▼
[8] aiSuggestion = undefined (key mismatch) → card NÃO renderiza
```

### Fixed Flow (Target)

```
[1] User clicks "Avaliar com IA"
     │
     ▼
[2] triggeringItemId = itemId → spinner ON
     │
     ▼
[3] assessItem(request) → POST /api/v1/ai-assessment/ai
     │
     ▼ (backend returns success)
[4] Toast: "Avaliação concluída!" + tokens
     │
     ▼
[5] onSuccess(suggestionId):
     └── refreshSuggestions() (direto, sem delay)
          └── loadSuggestions() → Supabase query
               └── Maps by effectiveItemId (normalizado para item.id do frontend)
               │
               ▼
[6] triggeringItemId = null → spinner OFF (APÓS refresh)
     │
     ▼
[7] suggestions state updated (key correta)
     │
     ▼
[8] DomainAccordion lookup: aiSuggestions[ai_suggestion_${item.id}]
     │
     ▼
[9] aiSuggestion = { status: 'pending', ... } → card RENDERIZA
     │
     ▼
[10] User sees: [Badge 80%] [✓ Aceitar] [✗ Rejeitar] [Nível: "no information"]
     │
     ▼
[11] User clicks "Aceitar"
      ├── acceptSuggestion(itemId) → update DB + local state
      ├── onSuggestionAccepted(itemId, value) callback
      │    └── updateResponse(itemId, { selected_level, evidence })
      └── Radio button "no information" selecionado ✅
```

## Key Mapping Critical Path

A raiz do problema está no mapeamento de IDs entre as camadas:

```
Assessment Items (frontend)     ai_suggestions (database)
───────────────────────         ──────────────────────────
item.id                   →     assessment_item_id
                                OR
                                project_assessment_item_id

DomainAccordion uses:           loadSuggestions uses:
getAssessmentSuggestionKey(     effectiveItemId =
  item.id                         assessment_item_id
)                                 || project_assessment_item_id
```

**Condição para funcionar**: `item.id === effectiveItemId`

Investigar se `item.id` do frontend (ex: UUID de `project_assessment_items`) bate com `assessment_item_id` ou `project_assessment_item_id` no banco.
