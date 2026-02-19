# API Contracts: AI Assessment Flow

**Branch**: `002-ai-assessment-flow` | **Date**: 2026-02-18

All endpoints below **already exist** in the backend. No new endpoints are needed.
Base path: `/api/v1/ai-assessment`

---

## POST `/ai` — Single Item Assessment

Trigger AI assessment for one or more items on an article.

**Request**:
```json
{
  "project_id": "uuid",
  "article_id": "uuid",
  "instrument_id": "uuid | null",
  "project_instrument_id": "uuid | null",
  "extraction_instance_id": "uuid | null",
  "item_ids": ["uuid"],
  "model": "gpt-4o-mini",
  "temperature": 0.3
}
```

**Constraints**:
- `instrument_id` XOR `project_instrument_id` must be provided (not both)
- `extraction_instance_id` is optional (for PROBAST per-model scoping)
- `item_ids` must contain at least one valid assessment item ID
- User must have a valid OpenAI API key configured

**Response** (200):
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "completed",
    "suggestions": [
      {
        "id": "uuid",
        "assessment_item_id": "uuid",
        "suggested_value": {
          "level": "Low",
          "evidence_passages": [
            { "text": "...", "page_number": 3 }
          ]
        },
        "confidence_score": 0.85,
        "reasoning": "The study demonstrates...",
        "status": "pending"
      }
    ]
  },
  "trace_id": "uuid"
}
```

**Error Responses**:
- `422`: Invalid request (missing fields, invalid IDs)
- `401`: Unauthorized (invalid JWT)
- `404`: Article, instrument, or items not found
- `502`: AI service unavailable or API key invalid

---

## POST `/ai/batch` — Batch Assessment

Process all items for an instrument on an article in a single operation. Loads PDF once and maintains memory context across items.

**Request**:
```json
{
  "project_id": "uuid",
  "article_id": "uuid",
  "instrument_id": "uuid | null",
  "project_instrument_id": "uuid | null",
  "extraction_instance_id": "uuid | null",
  "item_ids": ["uuid", "uuid", "..."],
  "model": "gpt-4o-mini",
  "temperature": 0.3
}
```

**Constraints**:
- Same XOR constraint on instrument IDs
- `item_ids` should include all items the user wants assessed
- Items with existing accepted responses should be filtered out by the frontend before calling

**Response** (200):
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "completed",
    "suggestions": [
      {
        "id": "uuid",
        "assessment_item_id": "uuid",
        "suggested_value": { "level": "High", "evidence_passages": [] },
        "confidence_score": 0.92,
        "reasoning": "...",
        "status": "pending"
      }
    ],
    "results": {
      "total_items": 15,
      "successful": 14,
      "failed": 1,
      "duration_seconds": 120,
      "tokens_used": 45000
    }
  },
  "trace_id": "uuid"
}
```

**Error Responses**:
- `422`: Invalid request
- `401`: Unauthorized
- `502`: AI service error (partial results may still be available)

---

## GET `/ai/suggestions` — List Suggestions

Retrieve AI suggestions filtered by article, instrument, and/or run.

**Query Parameters**:
| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| project_id | uuid | Yes | |
| article_id | uuid | Yes | |
| instrument_id | uuid | No | Filter by instrument |
| status | string | No | `pending`, `accepted`, `rejected` |
| run_id | uuid | No | Filter by specific run |

**Response** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "assessment_run_id": "uuid",
      "assessment_item_id": "uuid",
      "suggested_value": { "level": "Low", "evidence_passages": [] },
      "confidence_score": 0.78,
      "reasoning": "...",
      "status": "pending",
      "reviewed_by": null,
      "reviewed_at": null,
      "metadata_": { "model": "gpt-4o-mini", "tokens": 1200 },
      "created_at": "2026-02-18T10:00:00Z"
    }
  ],
  "trace_id": "uuid"
}
```

---

## POST `/ai/suggestions/{suggestion_id}/review` — Review Suggestion

Accept, reject, or modify an AI suggestion.

**Path Parameters**:
- `suggestion_id` (uuid): The suggestion to review

**Request**:
```json
{
  "action": "accept | reject",
  "modified_value": {
    "level": "Moderate",
    "justification": "Modified reasoning..."
  }
}
```

**Constraints**:
- `action` must be `accept` or `reject`
- `modified_value` is optional; if provided with `accept`, uses modified values instead of original suggestion
- On `accept`: creates/updates `AIAssessment` record AND updates assessment response in `assessments` view
- On `reject`: marks suggestion as `rejected`, no side effects

**Response** (200):
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "accepted",
    "reviewed_by": "uuid",
    "reviewed_at": "2026-02-18T10:05:00Z"
  },
  "trace_id": "uuid"
}
```

**Error Responses**:
- `404`: Suggestion not found
- `409`: Suggestion already reviewed
- `422`: Invalid action or modified_value

---

## Frontend Service Method Mapping

| Frontend Method | Backend Endpoint | Hook |
|----------------|-----------------|------|
| `AssessmentService.assessSingleItem()` | `POST /ai` | `useSingleAssessment` |
| `AssessmentService.assessBatch()` | `POST /ai/batch` | `useBatchAssessment` |
| `AssessmentService.listSuggestions()` | `GET /ai/suggestions` | `useAIAssessmentSuggestions` |
| `AssessmentService.reviewSuggestion()` | `POST /ai/suggestions/{id}/review` | `useAIAssessmentSuggestions` |
