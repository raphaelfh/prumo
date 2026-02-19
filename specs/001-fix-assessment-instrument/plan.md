# Implementation Plan: Fix Assessment Instrument — Bug 3 (FK Constraint Violation)

**Branch**: `001-fix-assessment-instrument` | **Date**: 2026-02-18 | **Spec**: `specs/001-fix-assessment-instrument/spec.md`

## Summary

Bug 3 (discovered during T012 verification): When a user tries to save assessment responses for an article, the auto-save triggers a Supabase INSERT into the `assessments` compatibility VIEW. The INSTEAD OF INSERT trigger routes this to `assessment_instances`, always using the `instrument_id` column (FK to global `assessment_instruments`). However, the ID being sent is actually a `project_assessment_instruments.id` (from the project-scoped instrument loaded by the already-fixed Bug 2 flow). This causes a FK constraint violation.

**Fix**: Update the `assessments` compatibility VIEW and its INSTEAD OF triggers via a new Supabase migration to handle both global and project instrument IDs using the XOR pattern established in migration 0034.

## Technical Context

**Language/Version**: SQL (PostgreSQL 15 via Supabase)
**Primary Dependencies**: Supabase migrations, existing compatibility VIEW triggers
**Storage**: PostgreSQL — `assessment_instances` table with XOR FK columns
**Testing**: Manual verification (Supabase local `db reset`)
**Target Platform**: Supabase (local + cloud)
**Project Type**: Web application (database migration only)

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Layered Architecture | PASS | Database-only change; no layer violations |
| II. Dependency Injection | N/A | No Python/TS code changes |
| III. Supabase Migrations | PASS | Fix delivered as a new migration file |
| IV. Security by Design | PASS | VIEW uses `security_invoker=true`; triggers use `SECURITY DEFINER` (matching existing pattern) |
| V. Typed Everything | N/A | No Python/TS code changes |
| VI. Frontend Conventions | NOTE | `useAssessmentResponses.ts` still uses direct Supabase queries instead of apiClient — pre-existing tech debt, not introduced by this fix |
| VII. Async All The Way | N/A | No Python/TS code changes |
| VIII. Standardized API Contract | N/A | No Python/TS code changes |

## Bug Analysis

### Current Flow (Broken)

```
Frontend: useAssessmentResponses.ts
  → supabase.from('assessments').insert({ instrument_id: PROJECT_INSTRUMENT_ID })
  → VIEW trigger: assessments_insert_trigger()
    → INSERT INTO assessment_instances (instrument_id = PROJECT_INSTRUMENT_ID)
    → FK CHECK: assessment_instruments.id = PROJECT_INSTRUMENT_ID → NOT FOUND
    → ERROR: FK constraint violation
```

### Fixed Flow

```
Frontend: useAssessmentResponses.ts (unchanged)
  → supabase.from('assessments').insert({ instrument_id: PROJECT_INSTRUMENT_ID })
  → VIEW trigger: assessments_insert_trigger() (UPDATED)
    → DETECT: ID exists in project_assessment_instruments? YES
    → INSERT INTO assessment_instances (
        instrument_id = NULL,
        project_instrument_id = PROJECT_INSTRUMENT_ID
      )
    → FK CHECK: project_assessment_instruments.id = PROJECT_INSTRUMENT_ID → FOUND
    → XOR CHECK: (NULL, NOT NULL) → PASS
    → SUCCESS
```

### Three Issues in the Compatibility Layer

1. **INSERT trigger** (`assessments_insert_trigger`): Always inserts `instrument_id`, never `project_instrument_id`
2. **UPDATE trigger** (`assessments_update_trigger`): Same problem — always uses `instrument_id` for item lookups
3. **VIEW definition**: `JOIN assessment_instruments i ON i.id = ai.instrument_id` — excludes instances with `project_instrument_id`
4. **Item lookup in triggers**: Searches `assessment_items` (global) but project instruments use `project_assessment_items`

## Changes

### Single File: New Supabase Migration

**File**: `supabase/migrations/0036_fix_assessments_view_project_instruments.sql`

#### Part 1: Update VIEW to Support Both Instrument Types

```sql
CREATE OR REPLACE VIEW assessments WITH (security_invoker=true) AS
SELECT
  ai.id,
  ai.project_id,
  ai.article_id,
  ai.reviewer_id AS user_id,
  COALESCE(gi.tool_type, pi.tool_type) AS tool_type,
  COALESCE(ai.instrument_id, ai.project_instrument_id) AS instrument_id,
  ai.extraction_instance_id,
  -- ... (responses aggregation unchanged)
  -- ... (rest of columns unchanged)
FROM assessment_instances ai
LEFT JOIN assessment_instruments gi ON gi.id = ai.instrument_id
LEFT JOIN project_assessment_instruments pi ON pi.id = ai.project_instrument_id;
```

Key changes:
- `JOIN → LEFT JOIN` for both instrument tables
- `COALESCE(ai.instrument_id, ai.project_instrument_id) AS instrument_id` — frontend sees a single `instrument_id` regardless of type
- `COALESCE(gi.tool_type, pi.tool_type) AS tool_type` — get tool_type from whichever instrument is referenced

#### Part 2: Update INSERT Trigger

```sql
CREATE OR REPLACE FUNCTION assessments_insert_trigger() ...
  -- Detect if instrument_id is project or global
  IF EXISTS (SELECT 1 FROM project_assessment_instruments WHERE id = NEW.instrument_id) THEN
    -- Project instrument: use project_instrument_id column
    INSERT INTO assessment_instances (..., instrument_id, project_instrument_id, ...)
    VALUES (..., NULL, NEW.instrument_id, ...);
    -- Look up items from project_assessment_items
  ELSE
    -- Global instrument: use instrument_id column (legacy)
    INSERT INTO assessment_instances (..., instrument_id, project_instrument_id, ...)
    VALUES (..., NEW.instrument_id, NULL, ...);
    -- Look up items from assessment_items
  END IF;
```

#### Part 3: Update UPDATE Trigger

Same detection logic for the response recreation path.

#### Part 4: Re-grant Permissions

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO service_role;
```

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/0035_fix_assessments_view_project_instruments.sql` | Create | New migration: fix VIEW + triggers to handle project instruments |

## Existing Code (NO changes needed)

- `src/hooks/assessment/useAssessmentResponses.ts` — continues using `supabase.from('assessments')` unchanged
- `src/hooks/assessment/useAssessmentData.ts` — already loads via `getInstrument()` (Bug 2 fix)
- `backend/app/models/assessment.py` — `AssessmentInstance` model already has both FK columns
- `backend/app/repositories/assessment_repository.py` — already supports both FK patterns

## Implementation Order

1. Write migration `0035_fix_assessments_view_project_instruments.sql`
2. Run `supabase db reset` locally to apply
3. Verify: insert into assessments VIEW with a project instrument ID succeeds
4. Verify: read from assessments VIEW returns instances with project instruments
5. Verify: end-to-end assessment response save works in frontend

## Verification

1. **V1 (FK Fix)**: Navigate to Avaliacao tab, select an article, answer a question → response saves without FK error
2. **V2 (Read)**: Navigate away and back to the same article → previous responses load correctly
3. **V3 (Update)**: Change a response → auto-save succeeds, reload confirms change persisted
4. **V4 (Global instruments)**: If a global instrument is used, the same flow still works (backward compatibility)
5. **V5 (VIEW query)**: `supabase.from('assessments').select('*').eq('instrument_id', projectInstrumentId)` returns the correct assessment
