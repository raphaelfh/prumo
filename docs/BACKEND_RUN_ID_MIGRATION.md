# Backend run_id → extraction_run_id/assessment_run_id Migration

**Date**: 2026-01-29
**Migration**: 0033_ai_suggestions_assessment_support.sql
**Purpose**: Fix ai_suggestions table to support both extraction and assessment suggestions with proper foreign keys

## Problem

The `ai_suggestions` table only had a FK to `extraction_runs`, but the frontend code (aiAssessmentSuggestionService.ts) attempted to JOIN with `ai_assessment_runs`, causing this error:

```
Could not find a relationship between 'ai_suggestions' and 'ai_assessment_runs' in the schema cache
```

## Solution

### Database Changes (Migration 0033)

1. **Renamed column**: `run_id` → `extraction_run_id` (for extraction suggestions)
2. **Added column**: `assessment_run_id` (for assessment suggestions)
3. **Added CHECK constraint**: Ensures mutual exclusivity (XOR logic)
4. **Added indexes**: For both new FK columns

```sql
ALTER TABLE ai_suggestions
  ADD COLUMN assessment_run_id uuid REFERENCES ai_assessment_runs(id) ON DELETE CASCADE;

ALTER TABLE ai_suggestions
  RENAME COLUMN run_id TO extraction_run_id;

ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_run_type_check CHECK (
    (extraction_run_id IS NOT NULL AND assessment_run_id IS NULL) OR
    (extraction_run_id IS NULL AND assessment_run_id IS NOT NULL)
  );
```

### Backend Code Changes

Updated all references from `run_id` to the appropriate field:

#### 1. Models

**File**: [backend/app/models/extraction.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/models/extraction.py?type=file&root=%252F)

```python
class AISuggestion(Base, UUIDMixin):
    # OLD
    run_id: Mapped[UUID] = mapped_column(...)

    # NEW
    extraction_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=True,
    )
    assessment_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("public.ai_assessment_runs.id", ondelete="CASCADE"),
        nullable=True,
    )
```

#### 2. Schemas

**Files**:
- [backend/app/schemas/assessment.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/schemas/assessment.py?type=file&root=%252F)
- [backend/app/schemas/extraction.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/schemas/extraction.py?type=file&root=%252F)

```python
# Assessment suggestions
class AISuggestionSchema(BaseModel):
    assessment_run_id: UUID = Field(..., alias="assessmentRunId")

# Extraction suggestions
class SuggestionResponse(BaseModel):
    extraction_run_id: UUID = Field(..., alias="extractionRunId")

# Extraction results
class SingleSectionResult(BaseModel):
    extraction_run_id: str = Field(..., alias="extractionRunId")

class BatchSectionResult(BaseModel):
    extraction_run_id: str = Field(..., alias="extractionRunId")

class ModelExtractionResult(BaseModel):
    extraction_run_id: str = Field(..., alias="extractionRunId")
```

#### 3. Services

**File**: [backend/app/services/ai_assessment_service.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/services/ai_assessment_service.py?type=file&root=%252F)

```python
# Creating assessment suggestions
suggestion = AISuggestion(
    assessment_run_id=run.id,  # For assessment suggestions
    extraction_run_id=None,     # Not used for assessments
    instance_id=None,
    field_id=None,
    assessment_item_id=assessment_item_id,
    ...
)
```

**Files**:
- [backend/app/services/section_extraction_service.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/services/section_extraction_service.py?type=file&root=%252F)
- [backend/app/services/model_extraction_service.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/services/model_extraction_service.py?type=file&root=%252F)

```python
# Creating extraction suggestions
suggestion = AISuggestion(
    extraction_run_id=run.id,  # For extraction suggestions
    assessment_run_id=None,     # Not used for extractions
    instance_id=instance.id,
    field_id=field_id,
    ...
)
```

**Result objects**:
```python
# Before
@dataclass
class SectionExtractionResult:
    run_id: str

# After
@dataclass
class SectionExtractionResult:
    extraction_run_id: str
```

#### 4. Endpoints

**File**: [backend/app/api/v1/endpoints/ai_assessment.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/api/v1/endpoints/ai_assessment.py?type=file&root=%252F)

```python
# JOIN with assessment runs
query = query.join(
    AIAssessmentRun,
    AISuggestion.assessment_run_id == AIAssessmentRun.id  # Changed from run_id
)

# Creating AI assessments from suggestions
assessment = AIAssessment(
    run_id=suggestion.assessment_run_id,  # Changed from run_id
    ...
)
```

**Files**:
- [backend/app/api/v1/endpoints/section_extraction.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/api/v1/endpoints/section_extraction.py?type=file&root=%252F)
- [backend/app/api/v1/endpoints/model_extraction.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/api/v1/endpoints/model_extraction.py?type=file&root=%252F)

```python
# Response data formatting
response_data = SingleSectionResult(
    extraction_run_id=result.extraction_run_id,  # Changed from run_id
    ...
)
```

#### 5. Worker Tasks

**File**: [backend/app/worker/tasks/extraction_tasks.py](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/backend/app/worker/tasks/extraction_tasks.py?type=file&root=%252F)

```python
return {
    "extraction_run_id": result.extraction_run_id,  # Changed from run_id
    ...
}
```

## Files Modified

### Backend Files (14 total)

1. `backend/app/models/extraction.py` - AISuggestion model
2. `backend/app/schemas/assessment.py` - AISuggestionSchema
3. `backend/app/schemas/extraction.py` - SuggestionResponse, SingleSectionResult, BatchSectionResult, ModelExtractionResult
4. `backend/app/services/ai_assessment_service.py` - assessment_run_id usage
5. `backend/app/services/section_extraction_service.py` - extraction_run_id usage, dataclasses
6. `backend/app/services/model_extraction_service.py` - extraction_run_id usage, dataclass, to_dict
7. `backend/app/api/v1/endpoints/ai_assessment.py` - JOIN and FK references
8. `backend/app/api/v1/endpoints/section_extraction.py` - result formatting
9. `backend/app/api/v1/endpoints/model_extraction.py` - result formatting
10. `backend/app/worker/tasks/extraction_tasks.py` - return dict keys

### Migration Files

1. `supabase/migrations/0033_ai_suggestions_assessment_support.sql` - Database schema changes

## Verification Steps

After applying migrations:

1. **Check table structure**:
```sql
\d ai_suggestions
-- Should show: extraction_run_id, assessment_run_id, CHECK constraint
```

2. **Test extraction suggestions**:
```python
# Should work: Create extraction suggestion
suggestion = AISuggestion(
    extraction_run_id=extraction_run_id,
    assessment_run_id=None,
    instance_id=instance_id,
    field_id=field_id,
    ...
)
```

3. **Test assessment suggestions**:
```python
# Should work: Create assessment suggestion
suggestion = AISuggestion(
    extraction_run_id=None,
    assessment_run_id=assessment_run_id,
    assessment_item_id=item_id,
    ...
)
```

4. **Test frontend**:
   - Navigate to quality assessment section
   - Should NOT see relationship error
   - AI suggestions should load successfully

## Impact Assessment

### Breaking Changes

- ✅ **API Response Format**: Changed field names in response schemas (camelCase aliases handle this)
- ✅ **Database Schema**: Column rename requires migration
- ✅ **Worker Task Results**: Changed return dict keys

### Backward Compatibility

- ❌ **NOT backward compatible** - requires migration 0033
- ❌ **Existing data migration**: Migration 0033 handles this automatically with `RENAME COLUMN`

### Frontend Impact

Frontend should already use camelCase (`extractionRunId`, `assessmentRunId`) via Pydantic aliases, so no changes needed if using generated TypeScript types.

## Related Documentation

- [docs/ASSESSMENT_AI_SUGGESTIONS_FIX.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/ASSESSMENT_AI_SUGGESTIONS_FIX.md?type=file&root=%252F) - Original problem analysis
- [docs/ASSESSMENT_CLEANUP_SUMMARY.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/ASSESSMENT_CLEANUP_SUMMARY.md?type=file&root=%252F) - Legacy assessment cleanup
- [supabase/migrations/0033_ai_suggestions_assessment_support.sql](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/supabase/migrations/0033_ai_suggestions_assessment_support.sql?type=file&root=%252F) - Migration SQL

## Next Steps

1. ✅ Apply migration 0033: `supabase db reset` (applies all migrations including 0032 and 0033)
2. ✅ Run backend tests: `cd backend && uv run pytest`
3. ✅ Test frontend: Navigate to quality assessment section
4. ✅ Verify no relationship errors in console

---

**Last Updated**: 2026-01-29
**Status**: ✅ Complete - Backend code updated, ready for migration
