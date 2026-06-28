# Part B8 — extractSection + extractAllSections async poll migration

## Summary

Rewrote `SectionExtractionService.extractSection` and
`SectionExtractionService.extractAllSections` in
`frontend/services/sectionExtractionService.ts` from a synchronous
`sectionExtractionClient` call to the async 202+poll pattern.

Return types and shapes are preserved exactly so all callers work
unchanged.

---

## Rewritten methods (key logic)

### Shared poll helper

```typescript
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 300; // ~10 min

async function pollUntilDone(jobId: string): Promise<ErrorResult<ExtractionJobResult>> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    const statusResult = await getExtractionJobStatus(jobId);
    if (!statusResult.ok) return statusResult;
    const { status, result, error } = statusResult.data;
    if (status === 'completed' && result) return { ok: true, data: result };
    if (status === 'failed' || status === 'cancelled') {
      return { ok: false, error: new Error(error ?? `Extraction job ${status}: ${jobId}`) };
    }
    // pending | running — continue
  }
  return { ok: false, error: new Error(`Extraction job timed out after ${POLL_MAX_ATTEMPTS} polls: ${jobId}`) };
}
```

### extractSection

POST body: `{ projectId, articleId, templateId, entityTypeId, parentInstanceId, runId, model }`.

Mapping from `ExtractionJobResult` → `SectionExtractionResponse.data`:
```
runId              ← result.extractionRunId
entityTypeId       ← result.entityTypeId ?? ''
suggestionsCreated ← result.suggestionsCreated ?? 0
```

Errors: POST failures re-throw as `APIError`; poll failure → `throw new APIError(...)`.

### extractAllSections

POST body: same pattern + `extractAllSections: true`, `sectionIds`, `pdfText`.

Mapping from `ExtractionJobResult` → `BatchSectionExtractionResponse.data`:
```
runId                  ← result.extractionRunId
totalSections          ← result.totalSections ?? 0
successfulSections     ← result.successfulSections ?? 0
failedSections         ← result.failedSections ?? 0
totalSuggestionsCreated← result.totalSuggestionsCreated ?? 0
totalTokensUsed        ← 0  (not in ExtractionJobResult)
durationMs             ← 0  (not in ExtractionJobResult)
sections               ← (result.sections ?? []).map(mapSectionOutcome)
```

`SectionOutcome` (snake_case wire) → `BatchSectionResult` (camelCase) via:
```typescript
function mapSectionOutcome(s: SectionOutcome): BatchSectionResult {
  return {
    entityTypeId: s.entity_type_id,
    entityTypeName: s.entity_type_name ?? '',
    success: s.success,
    suggestionsCreated: s.suggestions_created,
    error: s.error ?? undefined,
  };
}
```

---

## Callers found (unchanged)

| File | Usage |
|------|-------|
| `frontend/hooks/extraction/useTopLevelSectionsExtraction.ts:144` | `SectionExtractionService.extractSection(request).catch(...)` → checks `.data.suggestionsCreated` |
| `frontend/hooks/extraction/helpers/processSectionsInChunks.ts:92` | `SectionExtractionService.extractAllSections(chunkRequest)` → reads `.data.sections`, `.data.totalSuggestionsCreated` |
| `frontend/components/extraction/SectionAccordion.tsx:98` | `extractSection(...)` (comes from a hook, not the class directly) |
| `frontend/hooks/extraction/useExtractionFormAIActions.ts` | Uses `useBatchSectionExtractionChunked` / `useBatchAllModelsSectionsExtraction` hooks, not the service directly |

`extractModels` is untouched (not in scope for B8).

---

## Test results

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  759ms
```

Tests cover:
- `extractSection`: 2-poll cycle (running → completed), failed job, cancelled job, POST body fields
- `extractAllSections`: 2-poll cycle with section mapping, failed job, empty sections, POST body fields

Previously there was no test file for this service.

---

## tsc output

Clean — no errors (`npx tsc -p tsconfig.app.json --noEmit`).

---

## eslint output

Clean — no warnings or errors (`npx eslint frontend/services/sectionExtractionService.ts`).

---

## Concerns / notes

- `totalTokensUsed` and `durationMs` are mapped to `0` because `ExtractionJobResult`
  does not carry these fields. Callers accumulate them (`totalTokensUsed += result.data.totalTokensUsed || 0`)
  so the `|| 0` guard means this is safe and non-breaking.
- The old `sectionExtractionClient` import was removed (only used by the two migrated methods;
  `modelExtractionClient` is kept for `extractModels`).
- The two methods still throw `APIError` on failure (same contract as before — callers use `.catch()`).
  They do NOT return `ErrorResult`; the existing caller pattern (`result.data?.suggestionsCreated`)
  relies on the throw+catch contract.
