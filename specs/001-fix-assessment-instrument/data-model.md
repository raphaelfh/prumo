# Data Model: Fix Assessment Instrument Configuration and Data Loading

**Date**: 2026-02-17 | **Branch**: `001-fix-assessment-instrument`

## Entities (Existing — No Schema Changes)

All entities already exist in the database. No migrations needed.

### ProjectAssessmentInstrument

| Field | Type | Notes |
|-------|------|-------|
| id | UUID (PK) | Auto-generated |
| project_id | UUID (FK → projects) | One instrument per project (active) |
| global_instrument_id | UUID (FK → assessment_instruments, nullable) | Source global instrument |
| name | varchar(255) | Display name |
| description | text (nullable) | Optional description |
| tool_type | varchar(50) | PROBAST, ROBIS, CUSTOM, etc. |
| version | varchar(20) | Semantic version |
| mode | enum(assessment_mode) | human, ai, hybrid |
| target_mode | enum(assessment_target_mode) | per_article, per_model |
| is_active | boolean | Only one active per project |
| aggregation_rules | jsonb (nullable) | Domain-level aggregation config |
| schema | jsonb (nullable) | Instrument metadata/domains |
| created_by | UUID (FK → users) | Creator |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Relationships**: Has many `ProjectAssessmentItem`. Belongs to `Project` (1:1 active).

### ProjectAssessmentItem

| Field | Type | Notes |
|-------|------|-------|
| id | UUID (PK) | Auto-generated |
| project_instrument_id | UUID (FK → project_assessment_instruments) | Parent instrument |
| global_item_id | UUID (FK → assessment_items, nullable) | Source global item |
| domain | varchar(100) | Grouping domain (e.g., "D1", "D2") |
| item_code | varchar(50) | Short code (e.g., "1.1", "2.3") |
| question | text | The assessment question |
| description | text (nullable) | Guidance/description for evaluator |
| sort_order | integer | Display ordering within domain |
| required | boolean | Whether item must be answered |
| allowed_levels | text[] | Response options (e.g., ["Low", "High", "Unclear"]) |
| llm_prompt | text (nullable) | AI assessment prompt override |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Relationships**: Belongs to `ProjectAssessmentInstrument`.

## Frontend Type Mapping

| Backend (snake_case) | Frontend (camelCase) | TypeScript Type |
|---------------------|---------------------|-----------------|
| project_instrument_id | projectInstrumentId | string |
| global_item_id | globalItemId | string \| null |
| item_code | itemCode | string |
| sort_order | sortOrder | number |
| allowed_levels | allowedLevels | string[] |
| llm_prompt | llmPrompt | string \| null |
| created_at | createdAt | string |
| updated_at | updatedAt | string |

## State Transitions

```
Instrument: imported → active → replaced (deleted)
Item: created → edited → toggled (required/optional) → deleted
```

No soft-delete. Deletion is permanent (dev stage decision).
