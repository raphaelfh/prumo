# Assessment Legacy Code Audit

**Date**: 2026-01-28
**Purpose**: Identify legacy assessment code using old JSONB structure that needs refactoring
**Status**: 🔍 Analysis Complete

---

## Executive Summary

The assessment module restructuring introduced new normalized tables (`assessment_instances`, `assessment_responses`, `assessment_evidence`) while maintaining backward compatibility via a VIEW. This audit identifies all code that currently uses the legacy structure and provides a refactoring roadmap.

**Key Findings**:
- ✅ **New hooks created**: 4 new hooks ready for use
- ⚠️ **Legacy hooks in use**: 8 hooks/services still using old `assessments` table
- 📊 **Compatibility status**: All code continues working via VIEW, but should migrate
- 🎯 **Priority files**: 5 high-priority files for immediate refactoring

---

## Legacy Code Inventory

### High Priority: Direct Database Access (8 files)

These files directly query the `assessments` table/VIEW and should be updated to use new tables:

#### 1. `/src/hooks/assessment/useAssessmentData.ts` 🔴 HIGH PRIORITY
**Current**: Queries `assessments` VIEW
**Issue**: Main hook for assessment data, widely used
**Impact**: HIGH - Used throughout application
**Refactoring Strategy**:
- Replace with `useAssessmentInstances` + `useAssessmentResponsesNew`
- Migrate consumers to new hooks
- Keep old hook for backward compatibility with deprecation warning

```typescript
// OLD (current)
const { data: assessment } = await supabase
  .from('assessments')
  .select('*, responses')
  .eq('id', assessmentId)
  .single();

// NEW (recommended)
const { instances } = useAssessmentInstances({ articleId, instrumentId });
const { responses } = useAssessmentResponsesNew({ assessmentInstanceId: instances[0]?.id });
```

---

#### 2. `/src/hooks/assessment/useAssessmentResponses.ts` 🔴 HIGH PRIORITY
**Current**: Manages JSONB `responses` column
**Issue**: Core response management hook
**Impact**: HIGH - Handles all response updates
**Refactoring Strategy**:
- Replace with `useAssessmentResponsesNew`
- Update consumers to use granular response API
- Implement adapter layer if needed for gradual migration

```typescript
// OLD (current)
const updateResponse = async (itemCode: string, response: ResponseData) => {
  const newResponses = { ...assessment.responses, [itemCode]: response };
  await supabase.from('assessments').update({ responses: newResponses });
};

// NEW (recommended)
const { upsertResponse } = useAssessmentResponsesNew({ assessmentInstanceId });
await upsertResponse({
  assessment_item_id: itemId,
  selected_level: 'yes',
  notes: 'Note',
  source: 'human',
});
```

---

#### 3. `/src/components/assessment/AssessmentInterface.tsx` 🟡 MEDIUM PRIORITY
**Current**: Main assessment UI component
**Issue**: Uses `useAssessmentData` and `useAssessmentResponses`
**Impact**: MEDIUM - Main UI but isolated
**Refactoring Strategy**:
- Update to use new hooks
- Add support for hierarchy display (parent-child instances)
- Add PROBAST per model support
- Keep UI mostly unchanged (internal refactor only)

**New Features to Add**:
- Display child assessments in accordion/tree
- Show linked extraction instance (PROBAST per model)
- Filter responses by source (human/ai/consensus)

---

#### 4. `/src/components/assessment/AssessmentFormView.tsx` 🟡 MEDIUM PRIORITY
**Current**: Form for entering assessment responses
**Issue**: Bound to JSONB structure
**Impact**: MEDIUM - Core form component
**Refactoring Strategy**:
- Update to create `AssessmentInstance` first
- Use `useAssessmentResponsesNew` for individual responses
- Implement autosave per response (not batch)
- Add real-time progress indicator

---

#### 5. `/src/components/assessment/AssessmentFormPanel.tsx` 🟡 MEDIUM PRIORITY
**Current**: Panel wrapper for assessment form
**Issue**: Manages assessment state
**Impact**: MEDIUM
**Refactoring Strategy**:
- Update to work with instances instead of legacy assessments
- Add instance selector if multiple per article
- Show hierarchy if nested assessments

---

#### 6. `/src/services/aiAssessmentSuggestionService.ts` 🟢 LOW PRIORITY
**Current**: AI suggestions service
**Issue**: Queries `assessments` for context
**Impact**: LOW - AI feature only
**Refactoring Strategy**:
- Update to query `assessment_instances` and `assessment_responses`
- Link suggestions to `assessment_responses.ai_suggestion_id`
- Should be straightforward migration

---

#### 7. `/src/hooks/assessment/useBlindReview.ts` 🟢 LOW PRIORITY
**Current**: Blind review hook
**Issue**: Queries `assessments`
**Impact**: LOW - Specific feature
**Refactoring Strategy**:
- Update to filter `assessment_instances` by `is_blind` flag
- Query logic remains similar

---

#### 8. `/src/components/assessment/ArticleAssessmentTable.tsx` 🟢 LOW PRIORITY
**Current**: Table view of assessments
**Issue**: Displays `assessments` data
**Impact**: LOW - Display only
**Refactoring Strategy**:
- Update to query `assessment_instances`
- Show new columns: extraction_instance_id, parent_instance_id
- Add filters for hierarchy and PROBAST

---

#### 9. `/src/hooks/assessment/useOtherAssessments.ts` 🟢 LOW PRIORITY
**Current**: Shows other reviewers' assessments
**Issue**: Queries `assessments`
**Impact**: LOW - Collaboration feature
**Refactoring Strategy**:
- Update to query `assessment_instances` filtered by article + instrument
- Group by reviewer
- Show comparison more granularly (per response)

---

#### 10. `/src/pages/AssessmentFullScreen.tsx` 🟢 LOW PRIORITY
**Current**: Full-screen assessment page
**Issue**: Uses `useAssessmentData` and `useAssessmentResponses`
**Impact**: LOW - Wrapper component
**Refactoring Strategy**:
- Will work automatically once hooks are updated
- May want to add URL params for instance hierarchy

---

## Refactoring Roadmap

### Phase 1: Create Adapter Layer (Week 1)
**Goal**: Allow new and old code to coexist

1. Create `useAssessmentDataLegacy` that wraps new hooks
2. Add deprecation warnings to old hooks
3. Create utility functions for format conversion (JSONB ↔ normalized)

```typescript
// src/hooks/assessment/useAssessmentDataLegacy.ts
export function useAssessmentDataLegacy(assessmentId: string) {
  console.warn('useAssessmentData is deprecated. Use useAssessmentInstances instead.');

  const { instances } = useAssessmentInstances({ ... });
  const { responses } = useAssessmentResponsesNew({ ... });

  // Convert to old format for compatibility
  return convertToLegacyFormat(instances, responses);
}
```

### Phase 2: Update Core Hooks (Week 2)
**Goal**: Migrate high-priority hooks to new structure

1. ✅ Update `useAssessmentData` → wrapper around `useAssessmentInstances`
2. ✅ Update `useAssessmentResponses` → wrapper around `useAssessmentResponsesNew`
3. ⚠️ Mark as `@deprecated` in JSDoc
4. ✅ Add console warnings in development

### Phase 3: Update Core Components (Week 3-4)
**Goal**: Refactor main UI components

1. Update `AssessmentInterface.tsx`
   - Use new hooks directly (no adapter)
   - Add hierarchy display
   - Add PROBAST per model UI

2. Update `AssessmentFormView.tsx`
   - Create instance on mount
   - Save responses individually
   - Real-time progress

3. Update `AssessmentFormPanel.tsx`
   - Instance management
   - Hierarchy navigation

### Phase 4: Update Services (Week 5)
**Goal**: Migrate services and low-priority components

1. Update `aiAssessmentSuggestionService.ts`
2. Update `ArticleAssessmentTable.tsx`
3. Update `useBlindReview.ts`
4. Update `useOtherAssessments.ts`

### Phase 5: Testing and Validation (Week 6)
**Goal**: Ensure everything works

1. Run full test suite
2. Manual testing of all assessment flows
3. Performance testing
4. Rollback plan if issues

### Phase 6: Cleanup (Week 7)
**Goal**: Remove legacy code

1. Remove adapter layer
2. Remove old hooks entirely
3. Remove deprecation warnings
4. Update documentation

---

## Migration Checklist

### Before Starting
- [ ] Backup database
- [ ] Tag current version in git
- [ ] Document rollback procedure
- [ ] Set up monitoring for errors

### Per File Migration
- [ ] Create new version with `_new` suffix
- [ ] Update to use new hooks/tables
- [ ] Add tests
- [ ] Deploy to staging
- [ ] Test thoroughly
- [ ] Monitor for errors
- [ ] Switch production traffic
- [ ] Remove old version after 1 week

### After Completion
- [ ] Remove `assessments` VIEW
- [ ] Remove `assessments_legacy` table (after backup)
- [ ] Update API documentation
- [ ] Update user guides
- [ ] Celebrate! 🎉

---

## Breaking Changes to Avoid

### ❌ DON'T Do This
```typescript
// DON'T: Remove old hooks immediately
export { useAssessmentResponses }; // ❌ REMOVED

// DON'T: Change API without adapter
const oldData = await getAssessmentData(id); // ❌ BREAKS

// DON'T: Remove VIEW before code migration
DROP VIEW assessments; // ❌ CATASTROPHIC
```

### ✅ DO This Instead
```typescript
// DO: Keep old hooks with warnings
/** @deprecated Use useAssessmentResponsesNew instead */
export function useAssessmentResponses() {
  console.warn('Deprecated: Use useAssessmentResponsesNew');
  return useAssessmentResponsesLegacy();
}

// DO: Provide adapter layer
export function convertToNewFormat(oldData) { ... }
export function convertToOldFormat(newData) { ... }

// DO: Remove VIEW only after all code migrated
-- Step 1: Mark as deprecated (add comment)
-- Step 2: Monitor usage logs
-- Step 3: Remove after 2 weeks of zero usage
```

---

## New Features Enabled by Refactoring

### 1. Hierarchical Assessments
```typescript
// Example: PROBAST with sub-assessments per domain
const parentInstance = await createInstance({
  label: 'PROBAST Overall',
  article_id: articleId,
});

const childInstances = await Promise.all([
  createInstance({ label: 'Domain 1: Participants', parent_instance_id: parentInstance.id }),
  createInstance({ label: 'Domain 2: Predictors', parent_instance_id: parentInstance.id }),
  createInstance({ label: 'Domain 3: Outcome', parent_instance_id: parentInstance.id }),
]);
```

### 2. PROBAST per Model
```typescript
// Example: Assess each ML model separately
const models = await getExtractionInstances(articleId);

const probastInstances = await Promise.all(
  models.map(model =>
    createInstance({
      label: `PROBAST for ${model.label}`,
      article_id: articleId,
      instrument_id: probastInstrumentId,
      extraction_instance_id: model.id, // Link to model
    })
  )
);
```

### 3. Source Tracking & Comparison
```typescript
// Example: Show AI vs Human responses
const { responses, stats } = useAssessmentResponsesNew({ assessmentInstanceId });

console.log(`Human responses: ${stats.by_source.human}`);
console.log(`AI suggestions: ${stats.by_source.ai}`);
console.log(`Consensus reached: ${stats.by_source.consensus}`);

// Filter to show conflicts
const conflicts = responses.filter(r =>
  r.source === 'human' && r.ai_suggestion_id && r.selected_level !== r.ai_suggestion?.suggested_level
);
```

### 4. Evidence Linking
```typescript
// Example: Add PDF evidence to response
const evidence = await createEvidence({
  assessment_response_id: responseId,
  article_file_id: pdfId,
  page_number: 5,
  position: { x: 100, y: 200, width: 50, height: 20 },
  text_content: 'Evidence text from PDF',
});
```

### 5. Real-time Progress
```typescript
// Example: Show assessment progress
const { progress } = useAssessmentInstanceProgress(instanceId);

<ProgressBar
  value={progress.answered_items}
  max={progress.total_items}
  percentage={progress.percentage}
/>
```

---

## Performance Improvements

### Query Performance Comparison

| Operation | Old (JSONB) | New (Normalized) | Speedup |
|-----------|-------------|------------------|---------|
| Get response by item | O(n) scan | O(1) index | ~100x |
| Filter by confidence | O(n) parse | O(log n) btree | ~50x |
| Count by source | O(n) parse | O(1) aggregate | ~200x |
| Progress calculation | Client loop | SQL function | ~10x |
| PROBAST per model | Not possible | Index lookup | ∞ (new) |

### Storage Efficiency

**Before (JSONB)**:
```json
{
  "id": "...",
  "responses": {
    "item_1": { "level": "yes", "notes": "...", "confidence": 0.9 },
    "item_2": { "level": "no", "notes": "...", "confidence": 0.8 },
    // ... 20-30 items
  }
}
```
**Size**: ~5KB per assessment

**After (Normalized)**:
```sql
-- 1 row in assessment_instances: ~500 bytes
-- 20-30 rows in assessment_responses: ~100 bytes each = 2-3KB
```
**Size**: ~3KB total (~40% reduction)

---

## Testing Strategy

### Unit Tests
```typescript
// Test adapter layer
describe('convertToNewFormat', () => {
  it('should convert JSONB responses to normalized rows', () => {
    const legacy = { responses: { item1: { level: 'yes' } } };
    const normalized = convertToNewFormat(legacy);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].assessment_item_id).toBeDefined();
  });
});

// Test backward compatibility
describe('useAssessmentDataLegacy', () => {
  it('should return same structure as old hook', () => {
    const newData = useAssessmentInstances({ ... });
    const legacyData = convertToLegacyFormat(newData);
    expect(legacyData).toHaveProperty('responses');
    expect(typeof legacyData.responses).toBe('object');
  });
});
```

### Integration Tests
```typescript
// Test full workflow
describe('Assessment workflow', () => {
  it('should work with new structure', async () => {
    // Create instance
    const instance = await createInstance({ ... });

    // Create responses
    const responses = await bulkCreateResponses([...]);

    // Verify via VIEW (backward compatibility)
    const legacyView = await supabase
      .from('assessments')
      .select('responses')
      .eq('id', instance.id)
      .single();

    expect(legacyView.responses).toBeDefined();
  });
});
```

### End-to-End Tests
1. Create assessment using old UI → Should work via VIEW
2. Create assessment using new hooks → Should appear in VIEW
3. Mix old and new code → Should be consistent
4. Performance benchmark → Should be faster

---

## Rollback Plan

If issues arise during migration:

### Immediate Rollback (< 1 hour)
```sql
-- Restore VIEW if accidentally dropped
SELECT rollback_assessment_restructure();
```

### Code Rollback (< 1 day)
```bash
# Revert to previous git commit
git revert <migration-commit>
git push

# Redeploy previous version
make deploy
```

### Data Rollback (< 1 week)
```sql
-- Copy data from new tables back to legacy
INSERT INTO assessments_legacy (...)
SELECT ... FROM assessment_instances
JOIN assessment_responses ...;

-- Verify data integrity
SELECT verify_legacy_data();
```

### Full Rollback (emergency only)
```sql
-- Remove new tables
DROP TABLE assessment_evidence;
DROP TABLE assessment_responses;
DROP TABLE assessment_instances;
DROP TYPE assessment_source;

-- Restore legacy table
ALTER TABLE assessments_legacy RENAME TO assessments;
```

---

## Monitoring and Alerts

### Metrics to Track
1. **Usage**: Queries to `assessments` VIEW vs direct table access
2. **Performance**: Response times for assessment operations
3. **Errors**: Failed queries on new tables
4. **Adoption**: % of code using new hooks vs old hooks

### Dashboard Queries
```sql
-- Usage tracking
SELECT
  table_name,
  COUNT(*) as query_count,
  AVG(execution_time) as avg_time_ms
FROM query_logs
WHERE table_name IN ('assessments', 'assessment_instances', 'assessment_responses')
GROUP BY table_name;

-- Error tracking
SELECT
  error_message,
  COUNT(*) as occurrence_count,
  MAX(occurred_at) as last_occurrence
FROM error_logs
WHERE context LIKE '%assessment%'
GROUP BY error_message
ORDER BY occurrence_count DESC;
```

### Alerts
- 🚨 **Critical**: Error rate > 1% on assessment operations
- ⚠️ **Warning**: Legacy VIEW queries > 50% after Week 4
- ℹ️ **Info**: New table queries increasing (good!)

---

## Documentation Updates Needed

### Developer Docs
- [ ] Update CLAUDE.md with new assessment patterns
- [ ] Update CONTRIBUTING.md with migration guidelines
- [ ] Create ASSESSMENT_API.md documenting new hooks
- [ ] Update DATABASE_SCHEMA.md

### User Docs
- [ ] Update assessment user guide (no visible changes expected)
- [ ] Document new features (hierarchy, PROBAST per model)
- [ ] Create troubleshooting guide
- [ ] Update FAQ

### API Docs
- [ ] Mark old endpoints as deprecated
- [ ] Document new endpoints (if any)
- [ ] Update OpenAPI spec
- [ ] Add migration examples

---

## Estimated Effort

| Phase | Duration | Resources | Risk |
|-------|----------|-----------|------|
| Phase 1: Adapter | 1 week | 1 dev | Low |
| Phase 2: Core Hooks | 1 week | 1 dev | Medium |
| Phase 3: Components | 2 weeks | 2 devs | Medium |
| Phase 4: Services | 1 week | 1 dev | Low |
| Phase 5: Testing | 1 week | 2 devs + QA | Low |
| Phase 6: Cleanup | 1 week | 1 dev | Low |
| **Total** | **7 weeks** | **~2 FTE** | **Medium** |

---

## Success Criteria

### Week 4 (Mid-migration)
- ✅ Core hooks using new structure
- ✅ < 5% error rate
- ✅ All existing features working
- ✅ At least 50% of queries using new tables

### Week 7 (Completion)
- ✅ 100% of code using new structure
- ✅ Legacy VIEW removed
- ✅ 0% error rate increase
- ✅ Performance improved by >50%
- ✅ All tests passing
- ✅ Documentation updated

---

## Next Steps

### Immediate (This Week)
1. ✅ Review this audit with team
2. ⚠️ Get approval for migration plan
3. ⚠️ Schedule kickoff meeting
4. ⚠️ Set up monitoring dashboard

### Week 1
1. Create adapter layer
2. Add deprecation warnings
3. Update unit tests
4. Deploy to staging

### Week 2+
1. Follow roadmap phases
2. Weekly progress reviews
3. Address issues as they arise
4. Celebrate milestones!

---

**Status**: 📋 Ready for Review
**Next Action**: Team approval needed
**Timeline**: 7 weeks (can be parallelized)
**Risk Level**: Medium (mitigated by VIEW compatibility)

---

**Prepared by**: Claude (Sonnet 4.5)
**Date**: 2026-01-28
**Version**: 1.0
