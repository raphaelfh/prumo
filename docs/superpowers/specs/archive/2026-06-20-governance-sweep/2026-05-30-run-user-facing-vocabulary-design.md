---
status: shipped
last_reviewed: 2026-05-30
owner: '@raphaelfh'
---

> **Status:** Draft · 2026-05-30 · Owner: @raphaelfh
> User-facing copy change only. No schema, API, or internal-code rename.
> Read [`docs/reference/extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md) §2 for what a "Run" is internally.

# Design: User-Facing Vocabulary for the HITL "Run"

**Date:** 2026-05-30
**Scope:** Frontend copy + one documentation note. No backend, DB, or API changes.

## 1. Context

A **Run** (`extraction_runs`) is the project's internal unit of HITL work —
one `(article × project_template × kind)` session. It is correct *ubiquitous
language* for engineers and is deeply embedded: the `extraction_runs` table,
the `/api/v1/runs/...` endpoints, the `extraction_run_stage` enum, ~43 backend
files, ~88 frontend files, and `frontend/hooks/runs/`.

The problem: "Run" is engineering vocabulary, not domain vocabulary. The end
users are systematic-review researchers, and "Run" leaks into a handful of
strings they actually read, where it means nothing to them.

**Grounding research** — the tools these researchers already use do not use
"Run". They speak of **extraction** and **(quality) assessment**:

- **Covidence** — "Extraction" and "Quality Assessment"; reviewers fill a
  "data extraction form"; "consensus" is their term too.
- **DistillerSR / SRDR+** — "forms" (configurable extraction forms per
  reference).

So the field already supplies two natural words — *extraction* and
*assessment* — and "Run" appears nowhere in it.

## 2. Decision

- **Scope: user-facing copy only.** "Run" stays unchanged as the internal
  term (DB table, `/api/v1/runs`, enum, `hooks/runs`, *and the copy key names
  themselves* such as `runsBannerTitle`). We change only the string **values**
  the user reads.
- **Strategy: context-specific vocabulary.** Of the leak sites, only one is
  shared between both kinds (the consensus-settings banner); everything else
  is kind-specific. So:
  - QA surfaces → **"assessment"**.
  - AI panel → **"AI extraction"** (qualified with "AI" so it is never
    confused with the reviewer's own data-extraction work).
  - The single shared surface (consensus banner) → phrased around
    **"article"**, with no container noun at all.
  - The **verb** "to run" ("Run AI", "run assessments", "is still running",
    dev hints) is natural English and is left untouched.

## 3. Change set

### Bucket 1 — the "Run" entity noun (3 strings)

| Location | Current | Proposed |
| --- | --- | --- |
| [`consensus.ts:11`](../../../frontend/lib/copy/consensus.ts) `runsBannerTitle` | These settings only affect new **Runs** | These settings only affect **articles started from now on** |
| [`consensus.ts:13`](../../../frontend/lib/copy/consensus.ts) `runsBannerBody` | **Runs** already in progress keep the snapshot they were created with. Changes here apply to the next **Run** created for an article. | **Articles** already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment. |
| [`QualityAssessmentFullScreen.tsx:327`](../../../frontend/pages/QualityAssessmentFullScreen.tsx) (hardcoded toast) | "**Run** finalized." | "**Assessment** finalized." |

The toast is hardcoded (not in the copy module). Its sibling toasts in the
same file already read *"Assessment reopened for revision."* (line 340) and
*"Assessment published."* (line 397) — so this change merely aligns the one
outlier with its neighbours. The literal is edited in place; moving every
toast in the file into the copy module is **out of scope**.

### Bucket 3 — AI panel → "AI extraction" (nouns only)

| Location | Current | Proposed |
| --- | --- | --- |
| [`extraction.ts:129`](../../../frontend/lib/copy/extraction.ts) `aiPanelHistoryTitle` | **Run** History | **AI extraction** history |
| [`extraction.ts:130`](../../../frontend/lib/copy/extraction.ts) `aiPanelHistoryDesc` | Previous AI **runs** for this article | Previous AI **extractions** for this article |
| [`extraction.ts:131`](../../../frontend/lib/copy/extraction.ts) `aiPanelNoRunsFound` | No **runs** found | No **AI extractions** found |
| [`extraction.ts:114`](../../../frontend/lib/copy/extraction.ts) `aiPanelStatusNotRun` | Not **run** | Not **started** |
| [`extraction.ts:460`](../../../frontend/lib/copy/extraction.ts) `panelNotRun` | Not **run** | Not **started** |

> Note: `aiPanelStatusNotRun` and `panelNotRun` are two keys with the same
> value (`'Not run'`), both in the AISuggestionsPanel area. Both get the same
> treatment. Whether one is dead is a separate cleanup, not part of this spec.

### Kept as-is (verb "to run" — natural English, not a leak)

`aiPanelRunAI` ("Run AI"), `aiPanelStatusNotRunDesc`, `aiPanelNoRunsDesc`,
`aiPanelNoSuggestionsDesc`, `auth.featureQualityDesc`,
`articles.zoteroCloseConfirmDesc` ("is still running"),
`extraction.runMigrationsHint`, `pages.dashboardStartFirstProjectDesc`,
and the `qa.ts` dev/seed hints ("Run `make db-seed`", "run risk-of-bias
assessments…").

## 4. Documentation deliverable

To stop a future dev re-leaking "Run" into the UI, add a short, authoritative
note to the canonical reference
[`docs/reference/extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md)
(the doc both `CLAUDE.md` files point devs to before touching `extraction_*`).

Add a subsection — **"User-facing vocabulary (do not leak \"Run\")"** — near
§2 (where the Run is introduced) or in the §6 glossary, stating:

1. **The rule:** "Run" is internal ubiquitous language. It MUST NOT appear as
   a noun in user-facing copy or toasts. The verb "to run" is fine.
2. **The mapping table** (same as §2 of this spec): QA → "assessment";
   AI panel → "AI extraction"; shared/consensus surface → phrase around
   "article".
3. **A pointer** to the copy regression guard (see §6) so the enforcement
   mechanism is discoverable.

## 5. Out of scope

- Any internal rename of "Run": the `extraction_runs` table, the
  `/api/v1/runs/...` API surface, the `extraction_run_stage` enum,
  `frontend/hooks/runs/`, and the copy **key** names (`runsBannerTitle`,
  `aiPanelNoRunsFound`, …).
- The verb "to run" anywhere it appears.
- Stage names (`proposal` / `consensus` / `finalized`) shown in other
  surfaces — a separate vocabulary question, not this one.
- Migrating hardcoded toasts in `QualityAssessmentFullScreen.tsx` into the
  copy module beyond the single line being changed.

## 6. Verification

- **Update the seven copy strings + the one hardcoded toast** per §3
  (2 in `consensus.ts`, 5 in `extraction.ts`).
- **Regression guard (vitest).** A focused test in the frontend copy test
  suite that:
  - asserts the changed keys hold their new values (and that the consensus
    values no longer match `/\bRuns?\b/`, and the AI-panel values no longer
    contain the noun "Run History" / "AI runs" / "runs found");
  - scans **all** copy module values and fails on the unambiguous plural
    entity-noun `/\bRuns\b/` (capitalised plural — there is no verb collision,
    so this is a safe broad net against re-leaks);
  - reads the `QualityAssessmentFullScreen.tsx` source and asserts the literal
    `Run finalized` is gone (covers the hardcoded toast without rendering).
- **Manual preview** of the three surfaces: the consensus-settings banner
  (Project Settings → Review consensus), the QA finalize toast, and the AI
  suggestions panel (history + empty + not-started states).

## 7. Files touched

- `frontend/lib/copy/consensus.ts` — 2 values.
- `frontend/lib/copy/extraction.ts` — 5 values.
- `frontend/pages/QualityAssessmentFullScreen.tsx` — 1 hardcoded toast literal.
- `frontend/lib/copy/__tests__/` (new or existing) — regression guard test.
- `docs/reference/extraction-hitl-architecture.md` — vocabulary note (§4).

## 8. References

- Internal: [`docs/reference/extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md) §2 (the Run), §6 (glossary).
- [Covidence — Data extraction & quality assessment](https://support.covidence.org/help/data-extraction-and-quality-assessment)
- [DistillerSR — review software (configurable extraction forms)](https://www.distillersr.com/products/distillersr-systematic-review-software)
