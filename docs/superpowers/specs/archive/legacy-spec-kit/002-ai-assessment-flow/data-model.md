# Data Model: AI Assessment Flow

**Date**: 2026-02-18
**Branch**: `002-ai-assessment-flow`

## Entities

All entities below already exist in the database. No new migrations are needed.

### AI Assessment Run (`ai_assessment_runs`)

Tracks a single AI assessment operation lifecycle.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| project_id | UUID | FK → projects, NOT NULL | |
| article_id | UUID | FK → articles, NOT NULL | |
| instrument_id | UUID | FK → assessment_instruments, NULLABLE | XOR with project_instrument_id |
| project_instrument_id | UUID | FK → project_assessment_instruments, NULLABLE | XOR with instrument_id |
| extraction_instance_id | UUID | FK → extraction_instances, NULLABLE | For PROBAST per-model scoping |
| stage | VARCHAR | NOT NULL | `assess_single` / `assess_batch` / `assess_hierarchical` |
| status | VARCHAR | NOT NULL, DEFAULT 'pending' | `pending` → `running` → `completed` / `failed` |
| parameters | JSONB | NOT NULL, DEFAULT '{}' | Input: model, temperature, item_ids |
| results | JSONB | NOT NULL, DEFAULT '{}' | Output: tokens, duration, suggestions_created |
| error_message | TEXT | NULLABLE | Populated on failure |
| started_at | TIMESTAMPTZ | NULLABLE | Set when status → running |
| completed_at | TIMESTAMPTZ | NULLABLE | Set when status → completed/failed |
| created_by | UUID | FK → profiles, NOT NULL | User who triggered the run |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**State Transitions**: `pending` → `running` → `completed` | `failed`

### AI Suggestion (`ai_suggestions`)

Shared table for both extraction and assessment suggestions. Uses XOR constraint.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| extraction_run_id | UUID | FK → extraction_runs, NULLABLE | XOR: extraction OR assessment |
| assessment_run_id | UUID | FK → ai_assessment_runs, NULLABLE | XOR: extraction OR assessment |
| instance_id | UUID | FK → extraction_instances, NULLABLE | Extraction only |
| field_id | UUID | FK → extraction_fields, NULLABLE | Extraction only |
| assessment_item_id | UUID | FK → assessment_items, NULLABLE | Assessment only |
| suggested_value | JSONB | NOT NULL | `{level, evidence_passages}` for assessment |
| confidence_score | NUMERIC | NULLABLE, 0-1 | |
| reasoning | TEXT | NULLABLE | AI justification text |
| status | VARCHAR | NOT NULL, DEFAULT 'pending' | `pending` / `accepted` / `rejected` |
| reviewed_by | UUID | FK → profiles, NULLABLE | User who reviewed |
| reviewed_at | TIMESTAMPTZ | NULLABLE | When reviewed |
| metadata_ | JSONB | DEFAULT '{}' | trace_id, model, tokens, method |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**XOR Constraint**: `(extraction_run_id IS NOT NULL AND assessment_run_id IS NULL) OR (extraction_run_id IS NULL AND assessment_run_id IS NOT NULL)`

**State Transitions**: `pending` → `accepted` | `rejected`

### AI Assessment (`ai_assessments`)

Final verified assessment record, created when a suggestion is accepted.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| project_id | UUID | FK → projects, NOT NULL | |
| article_id | UUID | FK → articles, NOT NULL | |
| assessment_item_id | UUID | FK → assessment_items, NOT NULL | |
| instrument_id | UUID | FK → assessment_instruments, NOT NULL | |
| user_id | UUID | FK → profiles, NOT NULL | Reviewer who accepted |
| selected_level | VARCHAR | NOT NULL | From item's allowed_levels |
| confidence_score | NUMERIC | NULLABLE, 0-1 | |
| justification | TEXT | NOT NULL | AI reasoning or modified text |
| evidence_passages | JSONB | DEFAULT '[]' | `[{text, page_number}]` |
| ai_model_used | VARCHAR | NOT NULL | e.g., 'gpt-4o-mini' |
| status | VARCHAR | NOT NULL | `pending_review` / `completed` |
| reviewed_at | TIMESTAMPTZ | NULLABLE | |

### Assessment Response (via `assessments` VIEW)

The reviewer's final answer, stored in the `assessments` compatibility VIEW which routes to `assessment_instances` + `assessment_responses` tables.

| Field | Type | Notes |
|-------|------|-------|
| responses | JSONB | `{[itemId]: {selected_level, notes, confidence, evidence}}` |

## Relationships

```
Project
  └── AI Assessment Run (1:N)
        ├── Article (M:1)
        ├── Instrument (M:1, global OR project)
        ├── Extraction Instance (M:1, optional - PROBAST)
        └── AI Suggestion (1:N)
              └── Assessment Item (M:1)

AI Suggestion ──accept──→ AI Assessment (1:1)
AI Suggestion ──accept──→ Assessment Response update
```
