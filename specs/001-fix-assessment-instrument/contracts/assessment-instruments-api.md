# API Contract: Project Assessment Instruments

**Base Path**: `/api/v1/assessment-instruments`
**Auth**: JWT Bearer token (Supabase Auth)

All endpoints already exist in the backend. This contract documents the endpoints used by the frontend fixes.

## Endpoints Used

### GET /{instrument_id}

Fetch a project instrument with all its items.

**Used by**: `useAssessmentData.ts` (Bug 2 fix), `useProjectInstrument()` hook

**Response** (200):
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "globalInstrumentId": "uuid | null",
    "name": "PROBAST",
    "description": "...",
    "toolType": "PROBAST",
    "version": "1.0.0",
    "mode": "human",
    "targetMode": "per_article",
    "isActive": true,
    "items": [
      {
        "id": "uuid",
        "projectInstrumentId": "uuid",
        "globalItemId": "uuid | null",
        "domain": "D1",
        "itemCode": "1.1",
        "question": "Was the source of data appropriate?",
        "description": "Consider whether...",
        "sortOrder": 1,
        "required": true,
        "allowedLevels": ["Low", "High", "Unclear"],
        "llmPrompt": null,
        "createdAt": "2026-02-17T...",
        "updatedAt": "2026-02-17T..."
      }
    ]
  },
  "trace_id": "uuid"
}
```

### POST /{instrument_id}/items

Add a new custom item to an instrument.

**Used by**: `AddItemDialog.tsx` (new add-item feature)
**Rate limit**: 20/minute

**Request**:
```json
{
  "domain": "D1",
  "itemCode": "1.4",
  "question": "Custom question text",
  "description": "Optional guidance",
  "sortOrder": 4,
  "required": true,
  "allowedLevels": ["Low", "High", "Unclear"],
  "llmPrompt": null
}
```

**Response** (200):
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "projectInstrumentId": "uuid",
    "domain": "D1",
    "itemCode": "1.4",
    "question": "Custom question text",
    "description": "Optional guidance",
    "sortOrder": 4,
    "required": true,
    "allowedLevels": ["Low", "High", "Unclear"],
    "llmPrompt": null,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "trace_id": "uuid"
}
```

### PATCH /items/{item_id}

Update an existing item's properties.

**Used by**: `InstrumentConfigEditor.tsx` (edit/toggle)

**Request** (partial update):
```json
{
  "question": "Updated question",
  "description": "Updated desc",
  "required": false
}
```

### DELETE /items/{item_id}

Delete an item permanently.

**Used by**: `InstrumentConfigEditor.tsx` (delete)

**Response** (200):
```json
{
  "ok": true,
  "data": { "message": "Item deleted successfully" },
  "trace_id": "uuid"
}
```
