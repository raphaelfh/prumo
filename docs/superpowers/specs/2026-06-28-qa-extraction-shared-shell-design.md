---
status: draft
last_reviewed: 2026-06-28
owner: '@raphaelfh'
---

# QA ↔ Extraction: shared split-workspace shell, per-domain AI extract, and evidence highlight — design

> **Status:** Draft · Date: 2026-06-28 · Deciders: @raphaelfh
> **Scope:** Frontend only. No backend, schema, or migration changes.
> **Origin:** Two user-reported defects on the Quality-Assessment (QA)
> session screen — (1) the PDF/markdown viewer sits on the wrong side vs
> Extraction, and (2) there is no per-section "Extract with AI" button like
> Extraction has — plus a request to share equal components where adequate.
> A third question (why QA does not locate + highlight AI-suggestion
> evidence in the markdown like Extraction does) was answered by a 9-agent
> adversarial investigation; its verified root cause is [§7](#7-part-5--qa-evidence-locate--highlight).

## 1. Problem

The QA session screen ([`QualityAssessmentFullScreen.tsx`](../../../frontend/pages/QualityAssessmentFullScreen.tsx))
and the Extraction session screen ([`ExtractionFullScreen.tsx`](../../../frontend/pages/ExtractionFullScreen.tsx))
are the two "open a document, fill a HITL form beside it" surfaces. They have
drifted apart in three ways:

1. **PDF side is inverted.** Extraction is **form-left / PDF-right**
   (`ExtractionFullScreen.tsx:1177` form `order=1`, `ExtractionPDFPanel` `order=2`).
   QA is **PDF-left / form-right** via
   [`AssessmentShell`](../../../frontend/components/assessment/AssessmentShell.tsx)
   (`order=1` PDF, `order=2` form). `AssessmentShell` is used **only** by QA.

2. **No granular AI extract in QA.** Extraction's
   [`SectionAccordion.tsx:178-214`](../../../frontend/components/extraction/SectionAccordion.tsx)
   renders a per-**section** ✨ button (one per entity-type) wired to
   `useSectionExtraction`. QA's
   [`QASectionAccordion.tsx`](../../../frontend/components/assessment/QASectionAccordion.tsx)
   renders no extract trigger; QA only has the global "Extract with AI" in the
   header. There is **no** per-individual-field extract anywhere — the backend
   extracts a whole section at a time.

3. **No evidence locate + highlight in QA.** On Extraction, an AI suggestion's
   evidence exposes a "locate in document" affordance that scrolls the
   reader to and flashes the cited passage in the stored markdown. On QA that
   affordance never appears.

Two layout implementations doing nearly the same job is also duplication the
user explicitly asked to reduce "where possible and adequate".

## 2. Goals / non-goals

**Goals**

- One shared split-workspace shell used by **both** session screens, with a
  single canonical layout (**form-left / PDF-right**).
- A per-domain (section-granular) "Extract with AI" button in QA, mirroring
  Extraction, via a **shared** component — zero new backend.
- QA evidence locate + highlight working identically to Extraction, riding on
  the shared shell — zero new backend.
- Reduce duplication: one shell, one AI-extract button, the already-shared
  `FieldInput` and `RunHeader`.

**Non-goals**

- No merge of `SectionAccordion` and `QASectionAccordion` — they genuinely
  diverge (multi-instance + `InstanceCard` + add/remove instances vs domains +
  signaling/summary split + reviewer avatars). They already share the right
  seam (`FieldInput`). Merging would trade two focused components for one
  conditional-heavy one (against the "small, well-bounded units" principle).
- No backend / schema / migration changes. The evidence data and the
  section-extraction endpoint already exist and are kind-agnostic
  ([§7](#7-part-5--qa-evidence-locate--highlight)).
- No per-individual-field AI extraction (the backend has no such endpoint;
  Extraction itself is section-granular).

## 3. Decisions (locked with the user)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Canonical layout = **form-left / PDF-right** (match Extraction). | User confirmed; Extraction is the reference. |
| D2 | **Unify the layout shell** (Approach B): Extraction adopts the shared shell too. | User chose B over the minimal fix. Maximises sharing. |
| D3 | AI extract granularity in QA = **per-domain** (section), not per-field. | Mirrors Extraction; reuses `useSectionExtraction`; no backend work. |
| D4 | Evidence locate+highlight in QA is a **pure wiring fix** on the shared shell — no data/backend work. | Verified root cause ([§7](#7-part-5--qa-evidence-locate--highlight)). |

## 4. Architecture overview

Five parts. Parts 1–3 unify the layout; Part 4 is the AI button; Part 5 is the
evidence highlight (which rides on Part 1's `viewerStore` prop).

```
RunSplitShell (shared)                 ← Part 1  (was AssessmentShell)
 ├─ header        (ReactNode)
 ├─ subHeader     (ReactNode, optional)
 ├─ formPanel     (ReactNode)  order 1, LEFT
 ├─ pdfPanel      (ReactNode)  order 2, RIGHT  (gated by pdfState.isOpen)
 └─ viewerStore?  → wraps BOTH panels in one <ViewerProvider store=…>

ExtractionFullScreen  → RunSplitShell  ← Part 2
QualityAssessmentFullScreen → RunSplitShell  ← Part 3 + Part 5

SectionAIExtractButton (shared)        ← Part 4
 ├─ used by SectionAccordion  (replace inline button)
 └─ used by QASectionAccordion (new, in domain header)
```

## 5. Part 1 — shared `RunSplitShell`

Promote `AssessmentShell` into the shared run home and teach it the two things
Extraction needs.

- **Relocate + rename:** `components/assessment/AssessmentShell.tsx` →
  `components/runs/RunSplitShell.tsx` (next to `RunHeader`, `ConsensusPanel`,
  `RunWorkspaceShell` — the shared run UI). Only the shell moves;
  `QASectionAccordion` stays in `components/assessment/` (it is QA-specific), so
  that directory is not emptied. (If a neutral name is undesired, keeping the
  `AssessmentShell` name is acceptable; the rename is the recommended structure,
  not a hard requirement.)
- **Canonical order:** form `order=1` (**left**), `ResizableHandle`, then PDF
  `order=2` (**right**), the PDF half gated by `pdfState.isOpen`. Form
  `defaultSize={pdf.isOpen ? 50 : 100} minSize={30}`; PDF
  `defaultSize={50} minSize={30} maxSize={70}`.
- **New props:**

```ts
export interface RunSplitShellProps {
  header?: ReactNode;
  /** Strip rendered between header and panels (e.g. Extraction's
   *  HITLStatusBadges revision/finalized bar). QA passes nothing. */
  subHeader?: ReactNode;
  formPanel: ReactNode;   // order 1, left
  pdfPanel: ReactNode;    // order 2, right
  pdfState?: UsePdfPanelResult;     // externally-owned open/close (existing)
  initialPdfOpen?: boolean;         // existing
  /** When provided, the shell wraps BOTH panels in a single
   *  <ViewerProvider store={viewerStore}> so the form panel's evidence
   *  popover (useReaderLocate) and the PDF reader resolve the SAME store.
   *  See §7 for why this is necessary-but-not-sufficient on its own. */
  viewerStore?: StoreApi<ViewerState>;
}
```

- **Provider wrapping:** when `viewerStore` is set, the panel region is
  rendered inside `<ViewerProvider store={viewerStore}>`; otherwise rendered
  bare (so a screen without click-evidence pays nothing). `ViewerProvider`,
  `ViewerState`, `StoreApi` come from `@prumo/pdf-viewer` (already imported by
  Extraction).
- The existing in-shell "Show/Hide PDF" fallback button (shown only when no
  `pdfState` is passed) is retained unchanged.

### 5.1 The store invariant (must be honored by both callers)

`PrumoPdfViewer → Viewer.Root` **always** renders its own inner
`<ViewerProvider store={store}>` (`pdf-viewer/primitives/Viewer.tsx:19`), and
`ViewerProvider` lazily self-creates a store when `store` is `undefined`
(`pdf-viewer/core/context.tsx:31`: `useState(() => store ?? createViewerStore(initial))`).

Therefore a shared store requires **two** things together — doing only one is a
silent no-op:

1. The shell wraps both panels in `<ViewerProvider store={viewerStore}>` (gives
   the **form** panel the shared store → the locate button can render).
2. The PDF content node passed as `pdfPanel` **must itself** thread
   `store={viewerStore}` into its `<PrumoPdfViewer>` (gives the **reader** the
   shared store → locate requests actually drive it).

This invariant holds for both Extraction (`ExtractionPDFPanel.tsx:88` already
forwards `store={store}`) and QA (new — see Part 5).

## 6. Parts 2 & 3 — adopt the shell

### Part 2 — Extraction

- `showPDF` boolean state → a `usePdfPanel` instance. Rewire
  `subscribeReaderLocate(viewerStore, () => setShowPDF(true))`
  (`ExtractionFullScreen.tsx:129`) to call `pdf.open()`.
- `ExtractionPDFPanel` → reduced to **content-only** (`ExtractionPdfContent`):
  keep `DocumentSwitcher` + `ParseStatusControl` + `PrumoPdfViewer store=…` +
  the switch-clears-highlights logic + the `memo`; **drop** its own
  `ResizableHandle`/`ResizablePanel` (the shell owns those now). Pass it as
  `pdfPanel`.
- Page passes to `RunSplitShell`: `header`=`ExtractionHeader`,
  `subHeader`=`HITLStatusBadges` strip, `formPanel`=the consensus-or-form
  branch (`ConsensusPanel` | `ExtractionFormPanel`), `pdfPanel`=
  `ExtractionPdfContent`, `viewerStore`, `pdfState`. The
  `FullAIExtractionProgress` overlay and the dialogs stay as fixed-position
  siblings after the shell (DOM placement is irrelevant for fixed elements).
- **Preserve:** the `data-scroll-container="extraction-form"` marker (in
  `ExtractionFormPanel`) and the viewer's `data-scroll-container="true"` node
  stay intact so `usePreserveScroll` keeps working.

### Part 3 — QA

- The PDF side is fixed for free by the shared shell (D1).
- Pass `header`, `formPanel`, `pdfPanel`, `pdfState`, **and `viewerStore`**
  (created in Part 5) to `RunSplitShell`.

## 7. Part 5 — QA evidence locate + highlight

### 7.1 Verified root cause (wiring gap, not data gap)

A 9-agent investigation (4 parallel readers → synthesis → 4 adversarial
verifiers) established the cause and ruled out the alternatives. Confirmed at
file:line:

`QualityAssessmentFullScreen.tsx:659` renders `<PrumoPdfViewer source readerBlocks
… />` with **no `store` prop** and **no `ViewerProvider` anywhere** on the page.
That single omission breaks the chain:

```
no <ViewerProvider> on QA page
  └─ form-panel evidence popover → useReaderLocate()            (AISuggestionDetailsPopover.tsx:53)
       └─ useViewerStoreApiOptional() returns null              (useReaderLocate.ts:23)
            └─ isAvailable = false                              (useReaderLocate.ts:32)
                 └─ onLocate = undefined                        (AISuggestionDetailsPopover.tsx:57-63)
                      └─ AISuggestionEvidence never renders the locate button   (AISuggestionEvidence.tsx:39,112)
```

So in QA the locate affordance **never renders**, and QA's viewer self-creates
an isolated store it cannot share. Extraction works only because it creates one
`viewerStore`, wraps both panels in `<ViewerProvider store={viewerStore}>`, and
threads it into the viewer (`ExtractionFullScreen.tsx:99,1176,1254`).

**Data is sufficient (alternative ruled out).** `aiSuggestionService.ts:35-42,59`
maps evidence (`text/pageNumber/blockIds/rank/attributionLabel`) with **no
`kind` branch**; the backend read service filters by `proposal_record_id` only
(no `run.kind` filter); `_create_suggestions` writes evidence identically for
`quality_assessment` and `extraction` (`kind` only selects the prompt). QA
reuses the same `useAISuggestions` hook and the same `readerBlocks` via
`useArticleDocuments`. **No backend/data change is required.**

### 7.2 Fix (3 page-level additions in QA)

1. `const [viewerStore] = useState(createViewerStore)`; pass it to
   `RunSplitShell` (Part 1 wraps both panels — gives the form panel the store).
2. Thread `store={viewerStore}` into QA's `<PrumoPdfViewer>` — **mandatory**
   per the §5.1 invariant; the provider-wrap alone is not sufficient.
3. `useEffect(() => subscribeReaderLocate(viewerStore, () => pdfPanelState.open()), [viewerStore])`
   so a locate request reveals the default-collapsed PDF panel (QA owns its
   panel state via `usePdfPanel`, so call `open()`, not Extraction's
   `setShowPDF`). Without this the scroll/flash target is not in the DOM while
   the panel is hidden.

No change to `QASectionAccordion`, `FieldInput`, the evidence components, or any
hook — they already render and accept evidence; they were simply starved of a
shared store.

## 8. Part 4 — shared per-domain AI extract button

New `components/extraction/ai/shared/SectionAIExtractButton.tsx` (next to the
existing reused `ai/shared/` components):

```ts
interface SectionAIExtractButtonProps {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  entityLabel: string;
  runId?: string | null;
  parentInstanceId?: string;
  /** Disable + swap the tooltip when extraction is not possible
   *  (e.g. single-cardinality section with zero instances). */
  disabled?: boolean;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;
}
```

- Owns `useSectionExtraction({ onSuccess })`, the ghost ✨/`Loader2` `Button`,
  the `Tooltip`, and the existing copy keys (`extractSectionWithAI`,
  `extractingWithAI`, `createInstanceBeforeExtract`).
- **`SectionAccordion`** replaces its inline button (`lines 178-214`) with this
  component — identical behavior, including the
  `instances.length === 0 && !isMultiple` disable.
- **`QASectionAccordion`** renders it in the domain `AccordionTrigger` header
  (next to the "N signaling questions" badge). QA domains are single-cardinality
  with one materialized instance, so `disabled` is effectively never set.
- **QA page wiring:** thread `articleId`, `templateId` (= `session.projectTemplateId`),
  `runId` (= `session.runId`), and `onExtractionComplete` down through
  `QASectionAccordion`. The handler mirrors Extraction's section-complete path:
  `refetchSession()` → `refetchRun()` → `refreshAISuggestions()`, so accepted
  proposals surface whether they accumulate on the QA run or land on a fresh
  one. (QA already wires AI-suggestion display + accept/reject — only the
  trigger was missing.)

## 9. File-by-file change list

**New**

- `frontend/components/runs/RunSplitShell.tsx` (moved from `assessment/AssessmentShell.tsx`, + `subHeader`/`viewerStore`, order flipped).
- `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx`.
- `frontend/components/runs/RunSplitShell.test.tsx` (migrated from `AssessmentShell.test.tsx`).
- `frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`.

**Modified**

- `frontend/pages/ExtractionFullScreen.tsx` — adopt shell; `showPDF`→`usePdfPanel`; locate→`pdf.open()`.
- `frontend/pages/QualityAssessmentFullScreen.tsx` — adopt shell; add `viewerStore` + `store=` + `subscribeReaderLocate`; thread section-extract props.
- `frontend/components/extraction/ExtractionPDFPanel.tsx` — reduce to `ExtractionPdfContent` (drop the `ResizablePanel`/`Handle` wrapper; keep store-clear + memo).
- `frontend/components/extraction/SectionAccordion.tsx` — use `SectionAIExtractButton`.
- `frontend/components/assessment/QASectionAccordion.tsx` — render `SectionAIExtractButton`; accept `articleId`/`templateId`/`runId`/`onExtractionComplete`.

**Test/import updates**

- `frontend/test/AssessmentShell.test.tsx` → `RunSplitShell.test.tsx` (rename + add a left/right order assertion + a `viewerStore`→`ViewerProvider` assertion).
- `frontend/test/QualityAssessmentFullScreen.test.tsx` — keep green; update import path if the shell is renamed.

**Removed**

- `frontend/components/assessment/AssessmentShell.tsx` (moved).

## 10. Testing & verification

- **Vitest:**
  - `RunSplitShell` — panel order (form before PDF), PDF half present only when
    `pdfState.isOpen`, panels wrapped in `ViewerProvider` **iff** `viewerStore`
    is passed, `subHeader` slot renders between header and panels.
  - `SectionAIExtractButton` — renders ✨, calls `extractSection` with the right
    ids, shows the spinner while loading, honors `disabled` + tooltip swap.
  - Keep `QualityAssessmentFullScreen.test.tsx` and the extraction tests green.
- **`design-review` loop** on both routes
  (`/projects/:id/extraction/:articleId` and
  `/projects/:id/articles/:articleId/quality-assessment/:templateId`):
  1. Both are form-left / PDF-right.
  2. Extraction's evidence-highlight + scroll-preservation still work (the main
     regression surface — its PDF panel now lives under the shared shell).
  3. QA shows a per-domain ✨ that extracts.
  4. **QA evidence:** an AI suggestion's evidence popover now shows the locate
     affordance; clicking it opens the PDF panel and flashes the cited passage
     in the markdown.

## 11. Risks

- **Extraction regression (primary):** moving Extraction's PDF panel under the
  shared shell could disturb the shared viewer store, the click-evidence
  highlight, or scroll preservation. Mitigated by keeping the `data-scroll-container`
  markers, keeping `ExtractionPdfContent` threading `store=`, and the
  design-review step.
- **Nested `ViewerProvider` for the PDF subtree** (shell's outer provider +
  `Viewer.Root`'s inner provider) — harmless because both resolve the **same**
  store instance (§5.1); the form panel sees only the outer provider.
- **Rename churn** (`AssessmentShell` → `RunSplitShell`) touches 2 pages + 2
  tests. Contained; optional if minimal churn is preferred.

## 12. Out of scope (future)

- Merging the two section accordions (rejected, §2).
- Per-individual-field AI extraction (needs new backend).
- Any change to evidence generation, ranking, or the entailment/citation
  pipeline — this design only wires the existing evidence into the QA viewer.
