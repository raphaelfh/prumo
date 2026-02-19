# Research: Fix Assessment FK Constraint Bug (Bug 3)

**Date**: 2026-02-17 | **Branch**: `001-fix-assessment-instrument`

## Summary

Bug 3 discovered during verification: saving assessment responses fails with FK constraint violation. Root cause identified by tracing the full data flow from frontend through the compatibility VIEW trigger to the `assessment_instances` table.

## Root Cause Analysis

### The Error

```
insert or update on table "assessment_instances" violates foreign key constraint
"assessment_instances_instrument_id_fkey"
```

### Data Flow Trace

1. `useAssessmentData.ts:173` loads instrument via `getInstrument(instrumentId)` from `projectAssessmentInstrumentService` — returns a `ProjectAssessmentInstrument` (from `project_assessment_instruments` table)
2. `useAssessmentResponses.ts:235` sends `instrument_id: instrumentId` to the `assessments` VIEW via Supabase client
3. The `assessments` VIEW has an `INSTEAD OF INSERT` trigger (`assessments_insert_trigger()`) that inserts into `assessment_instances`
4. The trigger inserts `NEW.instrument_id` into `assessment_instances.instrument_id` column
5. **BUG**: `assessment_instances.instrument_id` has FK to `assessment_instruments` (global table), but the ID being sent is a `project_assessment_instruments.id`

### Database Constraints (Migration 0034)

```sql
-- XOR constraint: must have exactly one instrument reference
ALTER TABLE assessment_instances
  ADD CONSTRAINT chk_assessment_instance_instrument_xor CHECK (
    (instrument_id IS NOT NULL AND project_instrument_id IS NULL) OR
    (instrument_id IS NULL AND project_instrument_id IS NOT NULL)
  );
```

The `assessment_instances` table has TWO instrument FK columns:
- `instrument_id` → `assessment_instruments` (global)
- `project_instrument_id` → `project_assessment_instruments` (project-scoped)

But the compatibility VIEW trigger only populates `instrument_id`, and the VIEW only JOINs on global `assessment_instruments`.

## Decisions

### 1. Fix Strategy: Database Trigger + VIEW Update

- **Decision**: Update the `assessments` compatibility VIEW and its INSTEAD OF triggers to handle both global and project instrument IDs.
- **Rationale**: This is the least invasive fix. The frontend continues using the same Supabase client pattern (`supabase.from('assessments').insert(...)`) unchanged. The trigger becomes smart enough to detect whether the `instrument_id` belongs to `project_assessment_instruments` or `assessment_instruments` and routes accordingly.
- **Alternatives considered**:
  - Refactor frontend to use apiClient + backend endpoint (correct per constitution, but much larger scope — would require creating new assessment response endpoints, services, and repositories)
  - Add `project_instrument_id` field to the VIEW and require frontend changes (breaks the "compatibility" purpose of the view)

### 2. Instrument ID Detection in Trigger

- **Decision**: Check `project_assessment_instruments` table first. If the ID exists there, use `project_instrument_id`; otherwise use `instrument_id`.
- **Rationale**: Project instruments are the primary use case going forward. Global instruments are legacy. Checking project first optimizes for the common case.
- **Implementation**:
  ```sql
  IF EXISTS (SELECT 1 FROM project_assessment_instruments WHERE id = NEW.instrument_id) THEN
    v_actual_instrument_id := NULL;
    v_project_instrument_id := NEW.instrument_id;
  ELSE
    v_actual_instrument_id := NEW.instrument_id;
    v_project_instrument_id := NULL;
  END IF;
  ```

### 3. VIEW JOIN Strategy

- **Decision**: Change the VIEW from `JOIN assessment_instruments` to `LEFT JOIN` both global and project instrument tables. Use `COALESCE` for shared fields like `tool_type`.
- **Rationale**: After migration 0034, instances can reference either table. The VIEW must show all instances regardless of instrument type. The `instrument_id` exposed by the VIEW should use `COALESCE(ai.instrument_id, ai.project_instrument_id)` so frontend queries like `.eq('instrument_id', instrumentId)` work for both cases.

### 4. Assessment Items Lookup in Trigger

- **Decision**: When the trigger creates `assessment_responses` from JSONB, it must look up items from BOTH `assessment_items` (global) AND `project_assessment_items` (project-scoped) depending on the instrument type.
- **Rationale**: Project instruments have their items in `project_assessment_items`, not `assessment_items`. The current trigger only searches `assessment_items`, so even if the FK issue were fixed, responses would not be created because items wouldn't be found.

### 5. Assessment Responses Table XOR Pattern

- **Decision**: Add `project_assessment_item_id` column to `assessment_responses` table following the same XOR pattern used in `assessment_instances` (migration 0034).
- **Rationale**: `assessment_responses.assessment_item_id` has FK constraint to `assessment_items(id)` (global). Project instrument items live in `project_assessment_items`, so inserting their IDs into `assessment_item_id` would violate the FK. The XOR pattern (exactly one of `assessment_item_id` or `project_assessment_item_id` must be non-null) solves this cleanly.
- **Implementation**:
  - Make `assessment_item_id` nullable (was NOT NULL)
  - Add `project_assessment_item_id uuid` with FK to `project_assessment_items(id)`
  - Add XOR CHECK constraint
  - Existing data is compatible: all existing rows have `assessment_item_id NOT NULL` and `project_assessment_item_id NULL`

### 6. Progress Calculation Function Update

- **Decision**: Update `calculate_assessment_instance_progress()` to query both `assessment_items` and `project_assessment_items` depending on the instance's instrument type.
- **Rationale**: The function only queried `assessment_items` using `instrument_id`. For project instruments where `instrument_id IS NULL`, it would return 0% completion. The fix uses a UNION ALL to query both item tables based on which instrument FK is set.

### 7. Scope Limitation

- **Decision**: This fix is database-only (new migration). No frontend or backend Python changes required.
- **Rationale**: The compatibility VIEW exists precisely to shield the frontend from structural changes. Fixing the VIEW and triggers is the intended approach.
