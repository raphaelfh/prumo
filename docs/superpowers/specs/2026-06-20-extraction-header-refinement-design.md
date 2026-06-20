---
status: proposed
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Extraction RunHeader Refinement — Design

> **Status:** Proposed — design approved in a completed brainstorm (2026-06-20).
> Next step: `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
> This is a **presentation-layer** change: it does not touch the
> `ExtractionRunStage` enum, the `/api/v1/runs/...` contract, or any backend
> stage gate. The one structural change is wrapping the two full-screen run
> pages in the existing app navigation shell (see §4).

## 1. Problem

The shipped shared `RunHeader` compound (`frontend/components/runs/header/`,
PR #338) surfaces the **raw DB stage vocabulary** to end users and clutters the
action cluster. Three concrete confusions:

1. **The four-node stage rail leaks `proposal → review → consensus → finalized`.**
   `review` is *not* peer review — `proposal → review` is an invisible
   auto-advance (`useAutoAdvanceToReview`) that fires the instant a run has
   content. Showing both reads as two distinct user steps when there is only one.
2. **The action cluster carries three competing affordances** — "Submit for
   review", "Reconcile", a stage-rail progress underline, *and* the
   "N of M required" helper — for what is, in the inert-HITL single-extractor
   model, a single forward motion.
3. **Save status, the ⌘K chip, and terminology** all sit in the busy right
   cluster with no single source of truth for "where am I / what do I do next".

The verified, code-grounded model (see §2) is **single-extractor + consensus**:
real user-facing phases are **Extract → Consensus → Finalized**. This spec
re-presents the header around that model without changing any backend behaviour.

## 2. Verified stage model (the ground truth)

Grounded in `frontend/types/ai-extraction.ts`,
`frontend/hooks/extraction/useAutoAdvanceToReview.ts`,
`frontend/lib/extraction/stageTransition.ts`,
`frontend/components/runs/ConsensusPanel.tsx`, and
`POST /api/v1/runs/{id}/advance` (membership-only, no role gate):

| DB stage (`ExtractionRunStage`) | User-facing phase | Notes |
| --- | --- | --- |
| `pending` | (Extract) | pre-content; behaves as Extract |
| `proposal` | **Extract** | AI seeds + extractor fills |
| `review` | **Extract** | reviewing **your own** AI suggestions; reached via invisible auto-advance — **not** peer review |
| `consensus` | **Consensus** | the only distinct adjudication phase; manager/consensus-only (`ConsensusPanel` renders only when `stage==='consensus'`) |
| `finalized` | **Finalized** | locked / published |
| `cancelled` | (terminal) | rail all-cancelled |

- The `ExtractionRunStage` enum **does not change**. This work folds
  `proposal`+`review` into a single UI node; it does not rename or remove DB
  stages.
- `POST /api/v1/runs/{id}/advance` checks **project membership, not role** —
  today's role gate is **frontend-only**
  (`frontend/lib/extraction/stageTransition.ts`). Therefore the Extract-phase
  primary action is offered to **every** extractor; only the Consensus →
  Finalized action stays role-gated (`canResolveConflicts`).

## 3. Decisions to implement (A–G)

### A. Stage rail → 3 user-facing nodes

`Extract → Consensus → Finalized`. Fold `proposal`+`review` into one UI
`extract` node. **Backend `review` must resolve to the SAME current `extract`
node as `proposal`** (until consensus).

Isolated to three files:

- `frontend/components/runs/header/stage.ts` — `StageKey` becomes
  `'extract' | 'consensus' | 'finalized'`; `ORDER = ['extract','consensus','finalized']`;
  `stageNodeStates` maps DB stage → UI index:
  - `cancelled` → every node `cancelled`
  - `consensus` → index 1 current
  - `finalized` → index 2 current (extract+consensus `done`)
  - everything else (`pending` / `null` / `proposal` / `review`) → index 0 current
- `frontend/components/runs/header/StageRail.tsx` — `STAGE_COPY_KEY` maps the
  three keys to `stageExtract` / `stageConsensus` / `stageFinalized`. **Remove**
  the per-node progress underline and the per-node `gateRemaining` chip (the
  PrimaryAction "N of M required" helper is the single progress source, decision
  B). Wrap each node in a real shadcn `Tooltip` showing its defining tooltip
  (`stageExtractTooltip` / `stageConsensusTooltip` / `stageFinalizedTooltip`),
  on hover **and** focus.
- `frontend/lib/copy/runs.ts` — add `stageExtract` and the three node tooltips.

**Preserve for E2E:** `data-testid="run-stage-current"` (still set on the
current node), the literal **"Finalized"** label text, and
`aria-label="Run stage"` on the `<nav>`.

### B. Primary action (extraction only), role/phase-aware

Rebuild `buildExtractionTransition`:

- **Extract phase** (`stage === 'proposal' || stage === 'review'`) → label
  **"Mark ready →"** (`runHeaderMarkReady`). `onAdvance` (gate open) advances the
  run to **consensus** *and* navigates to the next article (see below); gated
  → `onGuide`. Tooltip (hover+focus): **"Mark this extraction ready for
  consensus and open the next article."** Built for **every** extractor — do
  **not** gate on `canResolveConflicts` (the backend already permits advance).
- **Consensus phase** + `canResolveConflicts` → label **"Finalize"**
  (`runs.finalize`), tooltip **"Lock and publish the agreed values."**
  (`runHeaderFinalizeTooltip`), `onAdvance` → finalize.
- **Remove** the "Submit for review" and "Reconcile" transitions
  (reconciling happens inside the comparison / `ConsensusPanel`).
- Keep the gated dimmed state + "N of M required" helper as the **single**
  progress source (the stage-rail underline/chip is dropped in A).

"Mark ready" handler (`ExtractionFullScreen`, new `onMarkReady`):

1. `ensureReviewStage()` — flush autosave, advance `proposal → review` if still
   in proposal (idempotent; `useAutoAdvanceToReview` usually already did this).
2. advance `review → consensus` (`advanceMutation` → `target_stage: 'consensus'`).
3. **Navigate to the next article** in the worklist (next in `articles` order;
   end-of-queue → back to the project list `?tab=extraction`).
   - *Status-aware preference* ("prefer the next **not-yet-ready** one") requires
     per-article run status, which the worklist does not yet carry
     (`Worklist.tsx` TODO: needs a batch-runs endpoint). **Deferred**: ship plain
     next-in-order navigation now; `log`/comment the deferral. This is an
     engineering default, not a silent cap — documented in §10.

The transition type gains an optional `tooltip?: string`
(`RunHeaderContext.StageTransition`); `PrimaryAction` renders it via shadcn
`Tooltip` (hover+focus) when present. QA transitions simply omit it — so
`buildQaTransition` is **unchanged** (the field is optional).

### C. Role-aware bar (extraction only)

- **reviewer** → Extract phase only: Mark ready in Extract; **no reviewers
  cluster**, **no Finalize** (consensus branch is `canResolveConflicts`-gated →
  `null` for reviewers).
- **manager / consensus** → full progression + reviewers cluster + role chip +
  Finalize.
- The `RoleChip` renders only when `isBlind || canReveal` (already its behaviour
  via the `suffixKey`/`canReveal` logic — keep, and confirm reviewers without
  blind/reveal show no chip).

### D. Layout — always one line

Every element is `whitespace-nowrap`; labels collapse to icons by container
width via the existing `@container/headerbar` query; the bar **never** wraps to
two lines. Left ⌘B ↔ right `\` are mirror-image controls bracketing the bar.

- **Left:** app sidebar toggle (new shared `RunHeader.SidebarToggle`, see §4) →
  `‹` back chevron → breadcrumb (project › article) → a subtle **transient**
  Saved indicator by the title (decision E) → `StageRail`.
- **Center:** `Reviewers` (Consensus only) + `RoleChip` (only when
  `isBlind || canReveal`).
- **Right:** `[ ✦ Extract with AI (Extract phase only) · "N of M required" ·
  PRIMARY CTA ]` ‖ thin divider ‖ `[ "?" help · ⋮ menu · PDF toggle (literal
  rightmost) ]`.
- **PDF toggle** (`PanelToggle`) must **mirror** the sidebar toggle exactly:
  `PanelRightClose`/`PanelRightOpen` opacity-crossfade
  (`transition-opacity duration-150 ease-out motion-reduce:duration-0`), ghost
  `h-8 w-8`, `hover:bg-muted/50 transition-colors duration-75`, `aria-pressed`,
  `aria-keyshortcuts="\\"`. **Drop** the `bg-muted` pressed style.

#### Sidebar toggle (shared slot, prop-driven)

`RunHeader.SidebarToggle` mirrors `Topbar.tsx`'s desktop toggle:
`PanelLeftClose`/`PanelLeftOpen` opacity-crossfade, ghost `h-8 w-8`,
`hover:bg-muted/50 transition-colors duration-75`, `aria-pressed`,
`aria-keyshortcuts="Meta+B"`. **Prop-driven** (`{ pressed?: boolean; onToggle?:
() => void }`) and renders `null` when `onToggle` is absent — so the shared lib
stays decoupled from `SidebarContext` and isolated tests/QA without a shell
simply don't render it.

### E. Saved status → transient, by the title

Move `SaveSlot` out of the right action cluster into the **left** cluster next to
the title. Behaviour:

- `Saving…` while saving;
- a brief **`✓ Saved`** that **fades out** after a short delay;
- **`Save failed`** persists, red.

Implement the transient hide with a `useEffect` + `setTimeout` cleared in
cleanup (React-Compiler-safe; **no** `try/finally`). Add a check icon for the
saved state. Hidden when `stage === 'finalized'` (unchanged).

### F. Help / terminology — one "?" panel

Replace the ⌘K chip with a **"?" help button** (new shared `RunHeader.Help`)
opening ONE panel (`Popover`) =

- **Keyboard shortcuts:** ⌘K command palette · J/K next/prev article · `\`
  toggle PDF · ⌘B sidebar · Esc.
- **Workflow glossary:** Extract / Consensus / Finalize / blind / "N differ".

Tooltips on hover+focus for each stage node (A), the CTA (B), and the "N differ"
chip (`Reviewers`). **Do NOT** add undo/redo (it does not exist — autosave per
field, no document history). **KEEP** the ⋮ menu (Compare, Reopen).

The ⌘K command palette stays reachable by keyboard (its handler is unchanged);
only the discoverability chip is replaced by "?". Wire the new key handlers
(extraction): `\` → toggle PDF, `J`/`K` → next/prev article (blocked while
typing in inputs), `Esc` → close palette/help. QA wires `\` only (single
article, no worklist).

### G. Long labels — truncate + tooltip only when truncated

A shared `TruncatedText` helper (header lib): caps width, and shows the full
text on hover **and** focus via a real shadcn `Tooltip` **only when actually
truncated** (`scrollWidth > clientWidth`, measured via ref in an effect).
Applies to every text slot (breadcrumb last crumb, role chip, etc.). Full title
also stays in the `Worklist` popover and the ⌘K palette (already present).

## 4. The ⌘B sidebar — real app navigation (chosen)

**Decision (user, 2026-06-20):** the left ⌘B toggle controls the **real app
navigation sidebar**. The two full-screen run routes
(`/projects/:projectId/extraction/:articleId`,
`/projects/:projectId/articles/:articleId/quality-assessment/:templateId`)
currently render **outside** `SidebarProvider`/`ProjectLayout`
(`frontend/App.tsx:99-117`), so they have no app sidebar. We bring it in via a
small shared **focus workspace shell**, collapsed by default for focus.

### 4.1 `RunWorkspaceShell` (new shared component)

`frontend/components/runs/RunWorkspaceShell.tsx`:

- Props: `{ projectId: string; activeTab: SidebarTabId; children: ReactNode }`.
- Wraps children in `SidebarProvider` (default behaviour: **collapsed**;
  persists via the existing shared `prumo:sidebar:collapsed` key for
  consistency with the project shell).
- Layout: `h-screen flex` row → `ProjectSidebar` + `<main className="flex-1
  min-h-0 overflow-hidden">{children}</main>`.
- `ProjectSidebar` props:
  - `activeTab` = the route's tab (`'extraction'` or `'quality'`),
  - `onTabChange={(tab) => navigate(\`/projects/${projectId}?tab=${tab}\`)}`
    — i.e. **leave focus mode** and land on the project tab (do **not** reuse
    `ProjectContext.changeTab`, which only mutates `?tab=` and would rewrite the
    focus URL; and do **not** mount `ProjectProvider`, whose effect appends
    `?tab=` to the focus route on mount),
  - `projectName` from a cached project-summary lookup (e.g. `useProjectsList`,
    already fetched by `SidebarHeader`'s switcher; TanStack dedupes).
- Binds **⌘B** (chord, `mod`) → `toggleSidebar` (minimal; G-nav sequences are
  out of scope to avoid surprises during data entry). No `Topbar` is rendered —
  the `RunHeader` is the bar.

`ProjectSidebar` and its `SidebarHeader`/`SidebarFooter` depend only on
`useSidebar` / `useAuth` / `useProjectsList` (verified) — **not**
`ProjectContext` — so the shell needs no `ProjectProvider`.

### 4.2 Route wiring (`frontend/App.tsx`)

Wrap both lazy page elements in `<RunWorkspaceShell activeTab="extraction|quality">`
inside the existing `ProtectedRoute`/`ErrorBoundary`/`Suspense`. The shell reads
`projectId` from `useParams`.

### 4.3 Page adjustments

- `ExtractionFullScreen` / `QualityAssessmentFullScreen`: change the page root
  from `h-screen` to `h-full` so it fills the shell's `main` column (the shell
  owns `h-screen`). Verify the `ResizablePanelGroup` (PDF/form) and
  `AssessmentShell` still fill height.
- Each page reads `useSidebar()` (now in scope) and passes
  `pressed={!sidebarCollapsed}` + `onToggle={toggleSidebar}` to
  `RunHeader.SidebarToggle` (extraction via two new optional `ExtractionHeader`
  props `sidebarCollapsed` + `onToggleSidebar`; QA inline in its header JSX).

### 4.4 Risk

Adding a collapsed sidebar column changes the page DOM. The sidebar is
`hidden lg:block` and collapsed-by-default, so it must not overlay or block the
form at the Playwright `lg` viewport. **Frontend E2E must be run locally** and
the existing extraction E2E selectors confirmed green before merge (§9).

## 5. Shared vs extraction-specific

| Concern | Lives in | QA inherits? |
| --- | --- | --- |
| A (3-node rail), D (layout + SidebarToggle + mirrored PanelToggle), E (transient Save), F (Help panel), G (truncation) | shared `RunHeader` | **yes** |
| B (Mark ready + next-article nav), C (role-aware bar) | extraction `buildExtractionTransition` + `ExtractionHeader`/`ExtractionFullScreen` | no |
| `RunWorkspaceShell` | shared `frontend/components/runs/` | both pages adopt |

`buildQaTransition` (`frontend/lib/qa/qaTransition.ts`) is **unchanged**.

## 6. Copy changes (`frontend/lib/copy/`)

**`runs.ts` (shared)** — add:

- `stageExtract: 'Extract'` (rail node; `stageConsensus`/`stageFinalized` exist).
- `stageExtractTooltip`, `stageConsensusTooltip`, `stageFinalizedTooltip`
  (defining tooltips).
- Help panel: `helpButton` (aria), `helpTitle`, `shortcutsHeading`,
  `glossaryHeading`, the per-shortcut and per-glossary lines (Extract /
  Consensus / Finalize / blind / "N differ"), `shortcutPalette`,
  `shortcutNextPrev`, `shortcutTogglePdf`, `shortcutSidebar`, `shortcutEsc`.
- `sidebarToggle` (aria-label for the left toggle).
- Remove the now-unused `submitForReview` / `reconcile` shared keys **only if**
  no consumer references them (the shared `finalize` stays — QA uses it). Keep
  `gateRemaining` key removal optional (StageRail no longer uses it).

**`extraction.ts`** — replace/retire the misleading strings:

- `runHeaderSubmitForReview` and `runHeaderReconcile` are **removed** (no longer
  built). Add `runHeaderMarkReady: 'Mark ready →'`,
  `runHeaderMarkReadyTooltip`, `runHeaderFinalizeTooltip`. Keep
  `runHeaderFinalize`, `runHeaderGateBlocked`, `runHeaderCompareToggle`,
  `runHeaderReopenForRevision`, `runHeaderReopening`.

English only; all user-facing text via `frontend/lib/copy/`.

## 7. Docs to fix (root cause of the confusion)

- `docs/reference/extraction-hitl-architecture.md` — add a glossary entry
  distinguishing **"Stage (DB)"** (`pending/proposal/review/consensus/finalized`)
  from **"User-facing phase"** (Extract → Consensus → Finalized). State plainly
  that DB stages are **not** the user-facing model, and define **"review" =
  reviewing the AI suggestions within one's OWN extraction (NOT peer review by
  others)**.
- The **frozen** spec
  `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` must
  **NOT** be edited.
- `docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md` — lightly
  update the notes that surfaced raw DB stage names ("Reconcile", "Submit for
  review", "advance to consensus") to the Extract → Consensus → Finalized
  vocabulary; do not rewrite the spec.

## 8. Constraints

- **React Compiler `panicThreshold: 'all_errors'`** — no `try/finally` (or
  `throw`-in-`try`) in component/hook bodies; IO lives in
  `frontend/services/*` returning `ErrorResult`. Timers/measurement use
  `useEffect` + cleanup.
- All user-facing text through `frontend/lib/copy/` (`runs` namespace for shared,
  `extraction` for extraction-specific). English only.
- Read API errors from `error.message` (envelope), not `detail`.
- Data access stays through the typed client / existing hooks; no new
  `supabase.from(...)` reads.

## 9. Test plan

Update / add (all run from the **repo root**: `npm run test:run`):

- `frontend/components/runs/header/__tests__/stage.test.ts` — 3-node model;
  **assert backend `review` maps to current `extract`** (and `proposal` too);
  `consensus`/`finalized`/`cancelled`/`pending`/`null` mappings.
- `frontend/components/runs/header/__tests__/StageRail.test.tsx` — three labels
  (`stageExtract`/`stageConsensus`/`stageFinalized`); current node has
  `data-testid="run-stage-current"`; `aria-label="Run stage"`; **no** progress
  underline/`gateRemaining` chip; node tooltips wired.
- `frontend/test/stageTransition.test.ts` — new Extract-phase "Mark ready"
  transition available to **non-resolvers** (`canResolveConflicts:false`,
  `stage:'review'` and `'proposal'` → non-null, `to:'consensus'`,
  `label:'runHeaderMarkReady'`); gated vs open `onAdvance`; consensus →
  Finalize gated on `canResolveConflicts`; removed submit/reconcile branches.
- `frontend/test/qaTransition.test.ts` — unchanged behaviour still green
  (regression guard after the optional `tooltip` field is added).
- `frontend/test/copyRuns.test.ts` — resolves new shared keys (`stageExtract`,
  tooltips, help/glossary, `sidebarToggle`).
- New: **next-article navigation** from `onMarkReady` (unit-test the
  next-in-order/​end-of-queue selection; mock `advanceMutation` + `navigate`).
- Existing header component tests (PrimaryAction, RunHeader, Breadcrumb,
  Worklist, Reviewers, RoleChip, CommandPalette) stay green; update any that
  assert removed UI.
- `node scripts/enumerate_compiler_bailouts.mjs` → no new bailouts.
- `npm run typecheck` + `npm run lint` clean.
- **Frontend E2E** (`npm run test:e2e:local`) green — especially the extraction
  route with the new shell (sidebar collapsed, selectors intact).
- Design-review the `/projects/:projectId/extraction/:articleId` route
  (`/design-review`): one-line bar, mirrored toggles, transient Save, "?" panel,
  collapsed sidebar + ⌘B.

## 10. Out of scope / deferred (no silent caps)

- **Status-aware "next not-yet-ready" article preference** — needs a batch-runs
  endpoint the worklist lacks (`Worklist.tsx` TODO). Ships as plain
  next-in-order; flagged here and in code.
- **G-nav sequences** in the focus shell — only ⌘B is wired.
- **Per-article status pills** in the worklist popover — unchanged.
- Backend role enforcement on `/advance` — out of scope (frontend gate only, as
  today).

## 11. Files touched (index)

Shared header lib: `stage.ts`, `StageRail.tsx`, `PanelToggle.tsx`,
`PrimaryAction.tsx`, `SaveSlot.tsx`, `RunHeaderContext.tsx`, `RunHeader.tsx`
(+ `index.ts`), new `SidebarToggle.tsx`, `Help.tsx`, `TruncatedText.tsx`.
Shell: new `RunWorkspaceShell.tsx`; `App.tsx`. Extraction:
`ExtractionHeader.tsx`, `ExtractionFullScreen.tsx`,
`lib/extraction/stageTransition.ts`. QA:
`QualityAssessmentFullScreen.tsx` (SidebarToggle wiring + `h-full`). Copy:
`runs.ts`, `extraction.ts`. Docs: `extraction-hitl-architecture.md`,
`2026-06-19-extraction-view-ux-design.md`. Tests as in §9.
