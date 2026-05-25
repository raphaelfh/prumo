# API Contracts: Assessment AI (Existing — No Changes)

**Branch**: `003-fix-assessment-sync` | **Date**: 2026-02-19

> Nenhuma alteração nos endpoints do backend. Este documento descreve os contratos **existentes** que o frontend consome.

## POST `/api/v1/ai-assessment/ai`

### Request

```json
{
  "projectId": "uuid",
  "articleId": "uuid",
  "assessmentItemId": "uuid",
  "instrumentId": "uuid",
  "pdfStorageKey": "string | null",
  "pdfBase64": "string | null",
  "pdfFilename": "string | null",
  "pdfFileId": "string | null",
  "forceFileSearch": false,
  "openaiApiKey": "string | null",
  "extractionInstanceId": "string | null",
  "model": "gpt-4o-mini",
  "temperature": 0.1
}
```

### Response (Success)

```json
{
  "ok": true,
  "data": {
    "id": "uuid (ai_suggestion.id)",
    "selectedLevel": "string (AssessmentLevel)",
    "confidenceScore": 0.80,
    "metadata": {
      "tokensPrompt": 30000,
      "tokensCompletion": 10766
    }
  },
  "trace_id": "uuid"
}
```

### Response (Error)

```json
{
  "ok": false,
  "error": {
    "code": "ASSESSMENT_FAILED",
    "message": "string"
  },
  "trace_id": "uuid"
}
```

## Supabase Client Queries (Frontend Direct)

### Load Suggestions

```typescript
supabase
  .from('ai_suggestions')
  .select(`
    *,
    ai_assessment_runs!ai_suggestions_assessment_run_id_fkey!inner (
      project_id,
      article_id,
      instrument_id,
      project_instrument_id,
      extraction_instance_id
    )
  `)
  .or('assessment_item_id.not.is.null,project_assessment_item_id.not.is.null')
  .in('status', ['pending', 'accepted', 'rejected'])
  .eq('ai_assessment_runs.project_id', projectId)
  .eq('ai_assessment_runs.article_id', articleId)
  .order('created_at', { ascending: false })
```

### Accept Suggestion

```typescript
supabase
  .from('ai_suggestions')
  .update({
    status: 'accepted',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  })
  .eq('id', suggestionId)
```

### Reject Suggestion

```typescript
supabase
  .from('ai_suggestions')
  .update({
    status: 'rejected',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  })
  .eq('id', suggestionId)
```

## Frontend Internal Contracts (Hook Interfaces)

### `useSingleAssessment` → `onSuccess` callback

```typescript
onSuccess: (suggestionId: string) => void | Promise<void>
```

### `useAIAssessmentSuggestions` → `refresh()`

```typescript
refresh: () => Promise<{ suggestions: Record<string, AIAssessmentSuggestion>; count: number }>
```

### `useAIAssessmentSuggestions` → `onSuggestionAccepted` callback

```typescript
onSuggestionAccepted: (
  itemId: string,
  value: { level: AssessmentLevel; evidence_passages: EvidencePassage[] }
) => void | Promise<void>
```

### `AssessmentItemInput` Props Contract

```typescript
interface AssessmentItemInputProps {
  item: AssessmentItem;
  value: AssessmentResponse | null;
  onChange: (value: AssessmentResponse) => void;
  aiSuggestion?: AIAssessmentSuggestion;
  onAcceptAI?: (itemId: string) => Promise<void>;
  onRejectAI?: (itemId: string) => Promise<void>;
  onTriggerAI?: (itemId: string) => Promise<void>;
  isActionLoading?: boolean | ((itemId: string) => boolean);
  isTriggerLoading?: boolean;
  getSuggestionsHistory?: (...) => Promise<...>;
  disabled?: boolean;
}
```
