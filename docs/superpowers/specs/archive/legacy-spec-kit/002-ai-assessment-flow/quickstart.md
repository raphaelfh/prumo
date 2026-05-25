# Quickstart: AI Assessment Flow

**Branch**: `002-ai-assessment-flow` | **Date**: 2026-02-18

## Prerequisites

1. Local Supabase running (`supabase start`)
2. Backend running (`cd backend && uv run uvicorn app.main:app --reload --port 8000`)
3. Frontend running (`npm run dev`)
4. At least one project with:
   - An assessment instrument configured (e.g., PROBAST, QUADAS-2)
   - An article with a PDF uploaded
   - A valid OpenAI API key configured (via API key management)

## Integration Scenario 1: Single Item AI Assessment

**Goal**: Trigger AI assessment on one item and see the suggestion inline.

1. Navigate to project → Assessment section
2. Open an article's assessment form
3. Click "Avaliar com IA" on any assessment item
4. **Expected**: Loading indicator appears → suggestion displays inline with:
   - Suggested level (from item's allowed_levels)
   - Confidence score (0-100%)
   - Reasoning text with evidence from the article

**API Call**: `POST /api/v1/ai-assessment/ai`
```json
{
  "project_id": "<uuid>",
  "article_id": "<uuid>",
  "instrument_id": "<uuid>",
  "item_ids": ["<item-uuid>"]
}
```

**Response Flow**: Backend creates `AIAssessmentRun` (pending → running → completed) → creates `AISuggestion` → frontend loads suggestion via `useAIAssessmentSuggestions` → displays inline via `AISuggestionInline`.

## Integration Scenario 2: Accept/Reject Suggestion

**Goal**: Accept or reject an AI suggestion and verify form state updates.

1. After Scenario 1, an AI suggestion is visible on the item
2. Click "Aceitar" (Accept):
   - **Expected**: Assessment response fills with suggested level + justification
   - Suggestion status changes to `accepted`
3. Alternatively, click "Rejeitar" (Reject):
   - **Expected**: Suggestion dismissed, item remains empty
   - Suggestion status changes to `rejected`

**API Call**: `POST /api/v1/ai-assessment/ai/suggestions/{id}/review`
```json
{
  "action": "accept",
  "modified_value": null
}
```

## Integration Scenario 3: Batch AI Assessment

**Goal**: Run AI assessment on all items at once.

1. Navigate to an article's assessment form
2. Click "Avaliar Tudo com IA" in the form header
3. **Expected**: Progress indicator shows "Avaliando item X de Y"
4. All items receive suggestions (except items with existing accepted responses)
5. Any failed items show error indicators; successful items show suggestions

**API Call**: `POST /api/v1/ai-assessment/ai/batch`
```json
{
  "project_id": "<uuid>",
  "article_id": "<uuid>",
  "instrument_id": "<uuid>",
  "item_ids": ["<item1-uuid>", "<item2-uuid>", "..."]
}
```

## Integration Scenario 4: Batch Accept High-Confidence

**Goal**: Accept all suggestions above 80% confidence in one click.

1. After batch assessment (Scenario 3), multiple suggestions exist
2. Click "Aceitar com alta confianca" in the header
3. **Expected**: All suggestions with confidence ≥ 0.80 are accepted automatically
4. Badge updates to show remaining pending count

## Data Flow Summary

```
User clicks "Avaliar com IA"
  → useSingleAssessment.assessItem(itemId)
    → AssessmentService.assessSingleItem(params)
      → apiClient.post("/ai-assessment/ai", body)
        → Backend: AIAssessmentService.assess()
          → Creates AIAssessmentRun (pending → running)
          → Calls OpenAI with article PDF + instrument prompts
          → Creates AISuggestion records
          → Updates run (→ completed)
      ← Returns run + suggestions
    → useAIAssessmentSuggestions.refresh()
      → Loads suggestions from Supabase
      → Updates suggestion map state
  → AssessmentItemInput renders AISuggestionInline

User clicks "Aceitar"
  → useAIAssessmentSuggestions.acceptSuggestion(suggestionId)
    → aiAssessmentSuggestionService.acceptSuggestion(id)
      → Updates ai_suggestions.status = 'accepted'
      → Upserts assessment response in assessments view
    → Updates local suggestion state
  → Form value reflects accepted level + justification
```

## Error Scenarios

| Scenario | Expected Behavior |
|----------|------------------|
| No PDF uploaded | Toast error: "PDF necessario para avaliacao com IA" |
| Invalid/expired API key | Toast error: "Chave de API invalida. Verifique suas configuracoes." |
| AI service timeout | Toast error: "Servico de IA indisponivel. Tente novamente." |
| Partial batch failure | Continue with remaining items; mark failed items with error icon |
| No instrument configured | "Avaliar com IA" buttons hidden; message prompts instrument setup |
