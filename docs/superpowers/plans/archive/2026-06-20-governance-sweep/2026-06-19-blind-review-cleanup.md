---
status: shipped
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Blind-Review Post-Merge Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the "clean, no-legacy" pass over the merged manager-blind-review work — consolidate the duplicated HITL `kind` type, delete the dead `project.py` schema module, and route the Quality-Assessment page's user-facing text through the copy layer.

**Architecture:** Pure cleanup. No behavior changes, no new endpoints, no migrations. Each task is an independent, mechanically-verifiable slice (typecheck / grep / existing test suite). It builds on `dev` after PR #318 (manager blind-review) and PR #319 (the first `/simplify` pass that already removed the dead `ProjectSettings` class).

**Tech Stack:** TypeScript strict + React 19 (frontend), FastAPI + Pydantic v2 (backend), vitest + pytest, the in-house copy layer at `frontend/lib/copy/`.

## Global Constraints

- **English only** for code, comments, commits, docs. (CLAUDE.md hard rule.)
- **All user-facing text goes through `frontend/lib/copy/`** via `t('<namespace>', '<key>')` — never hardcode strings in components. (`.claude/rules/frontend.md`.)
- **Never hand-edit** `frontend/types/api/{openapi.json,schema.d.ts}` — they are generated. Do not derive the canonical kind type by editing them.
- **No `supabase.from(...)` reads added outside the integration layer**; no `fetch()` in services. (Not expected to come up here.)
- **React Compiler `panicThreshold: 'all_errors'`** — no `try/finally` or `throw` in component/hook bodies.
- **Behavior must not change.** Every task's deliverable is verified by an existing-suite-green run plus a focused grep/test; no user-visible difference.
- Frontend tooling runs from the **repo root** (`npm run …`); backend from `backend/` (`uv run …`). The local eslint full run is polluted by stale `.claude/worktrees/*` — lint changed files explicitly with `npx eslint --parser-options=tsconfigRootDir:"$(pwd)" <files>`.

## Out of Scope (explicitly NOT this plan)

- The **data-path consolidation** (the still-PostgREST run-resolution reads: `ExtractionValueService.findActiveRun` / `findFormRunsByArticle` / `findLatestFinalizedRun`, and `aiSuggestionService`'s use of them). That is the separate, in-progress "Extraction data-path consolidation" effort (see CLAUDE.md "Current focus") with its own plans — do not fold it in here.
- Repo-wide Portuguese-comment sweeps outside the blind-review-adjacent files named below.

---

### Task 1: Make `ReviewKind` the single canonical HITL-kind type

The union `'extraction' | 'quality_assessment'` is hand-declared in **four** places plus two inline literals. `ReviewKind` (in `frontend/lib/comparison/permissions.ts`, the lowest layer) is the correct canonical home — `lib/` is a leaf that hooks/services/components already import, so pointing the others at it introduces no cycle and no layering inversion.

**Files:**
- Modify: `frontend/lib/comparison/permissions.ts:28` (mark canonical)
- Modify: `frontend/hooks/hitl/useHITLProjectTemplates.ts:28`
- Modify: `frontend/services/qaTemplateService.ts:177`
- Modify: `frontend/hooks/extraction/useArticleExtractionValues.ts:27`
- Modify: `frontend/services/extractionRunService.ts:76`
- Modify: `frontend/e2e/flows/blind-review-manager.api.e2e.ts:54`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ReviewKind` remains the exported name from `@/lib/comparison/permissions` (unchanged signature). `HITLKind` and `HITLKindParam` keep their names but become aliases of `ReviewKind` (so their many consumers are untouched).

- [ ] **Step 1: Mark `ReviewKind` canonical**

In `frontend/lib/comparison/permissions.ts`, replace line 28:

```ts
export type ReviewKind = 'extraction' | 'quality_assessment';
```

with:

```ts
/**
 * Canonical HITL "kind" discriminator. The single source of this union —
 * `HITLKind`, `HITLKindParam`, and any other kind type alias to this. Do not
 * re-declare the literal elsewhere (it drifts). Mirrors the backend
 * `TemplateKind` enum / the generated `schema.d.ts` kind fields.
 */
export type ReviewKind = 'extraction' | 'quality_assessment';
```

- [ ] **Step 2: Alias `HITLKind` to `ReviewKind`**

In `frontend/hooks/hitl/useHITLProjectTemplates.ts`, add the import near the top (with the other `@/` imports) and replace line 28:

```ts
import type { ReviewKind } from '@/lib/comparison/permissions';
// …
export type HITLKind = ReviewKind;
```

- [ ] **Step 3: Alias `HITLKindParam` to `ReviewKind`**

In `frontend/services/qaTemplateService.ts`, add the import and replace line 177:

```ts
import type { ReviewKind } from '@/lib/comparison/permissions';
// …
export type HITLKindParam = ReviewKind;
```

- [ ] **Step 4: Point `ValuesKind` and the inline literals at `ReviewKind`**

In `frontend/hooks/extraction/useArticleExtractionValues.ts`, add the import and replace line 27:

```ts
import type { ReviewKind } from '@/lib/comparison/permissions';
// …
type ValuesKind = ReviewKind;
```

In `frontend/services/extractionRunService.ts`, add the import and replace the inline field at line 76 (`kind: 'extraction' | 'quality_assessment';`) with:

```ts
  kind: ReviewKind;
```

In `frontend/e2e/flows/blind-review-manager.api.e2e.ts`, add the import and replace line 54 (`type Kind = "extraction" | "quality_assessment";`) with:

```ts
import type { ReviewKind } from '@/lib/comparison/permissions';
// …
type Kind = ReviewKind;
```

- [ ] **Step 5: Verify the literal lives in exactly one hand-written place**

Run:

```bash
rg -n "'extraction'\s*\|\s*'quality_assessment'|\"extraction\"\s*\|\s*\"quality_assessment\"" frontend --glob '!frontend/types/api/**'
```

Expected: the ONLY hit is `frontend/lib/comparison/permissions.ts:28` (the canonical declaration). If any other hand-written file still inlines the union, replace it with `ReviewKind` (import from `@/lib/comparison/permissions`) and re-run.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). The aliasing is structurally identical, so all existing `HITLKind`/`HITLKindParam` consumers keep compiling.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/comparison/permissions.ts frontend/hooks/hitl/useHITLProjectTemplates.ts frontend/services/qaTemplateService.ts frontend/hooks/extraction/useArticleExtractionValues.ts frontend/services/extractionRunService.ts frontend/e2e/flows/blind-review-manager.api.e2e.ts
git commit -m "refactor(types): one canonical ReviewKind for the HITL kind union"
```

---

### Task 2: Delete the dead `project.py` schema module

Every class in `backend/app/schemas/project.py` (`TimingConfig`, `PICOTSConfig`, `ProjectCreate`, `ProjectUpdate`, `ProjectResponse`, `AddMemberRequest`, `UpdateMemberRequest`, `MemberResponse`, `ProjectListItem`, `ProjectListResponse`) is referenced **only** by its own unit test — no endpoint, service, or repository imports any of them (projects/members are CRUD'd directly via Supabase from the frontend). The module is dead code carrying Portuguese docstrings; deleting it also subsumes those i18n violations.

**Files:**
- Delete: `backend/app/schemas/project.py`
- Modify: `backend/app/schemas/__init__.py` (remove the `from app.schemas.project import (...)` block + the 10 `__all__` entries)
- Delete: `backend/tests/unit/test_project_schemas.py`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (removal). No live import path changes.

- [ ] **Step 1: Prove the module is dead (no live consumer)**

Run from repo root:

```bash
grep -rEn "from app\.schemas\.project import|app\.schemas\.project|\b(TimingConfig|PICOTSConfig|ProjectCreate|ProjectUpdate|ProjectResponse|AddMemberRequest|UpdateMemberRequest|MemberResponse|ProjectListItem|ProjectListResponse)\b" backend/app
```

Expected: matches ONLY inside `backend/app/schemas/__init__.py` (the re-export) and `backend/app/schemas/project.py` itself. **If any other `backend/app/**` file matches, STOP** — that class is live; keep it and narrow this task to the genuinely-dead classes. (As inventoried 2026-06-19, there were no live consumers.)

- [ ] **Step 2: Delete the schema module and its test**

```bash
git rm backend/app/schemas/project.py backend/tests/unit/test_project_schemas.py
```

- [ ] **Step 3: Remove the re-export from the schemas package**

In `backend/app/schemas/__init__.py`, delete the entire import block:

```python
from app.schemas.project import (
    AddMemberRequest,
    MemberResponse,
    PICOTSConfig,
    ProjectCreate,
    ProjectListItem,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
    TimingConfig,
    UpdateMemberRequest,
)
```

and delete these 10 entries from the `__all__` list (they appear as quoted strings, e.g. `"ProjectCreate",`):
`"ProjectCreate"`, `"ProjectUpdate"`, `"ProjectResponse"`, `"ProjectListItem"`, `"ProjectListResponse"`, `"PICOTSConfig"`, `"TimingConfig"`, `"AddMemberRequest"`, `"UpdateMemberRequest"`, `"MemberResponse"`.

- [ ] **Step 4: Verify imports resolve + ruff clean**

Run from `backend/`:

```bash
uv run python -c "import app.schemas; import app.main"
uv run ruff check app/schemas/__init__.py
```

Expected: both succeed (no `ImportError`, no unused-import / undefined-name errors). `import app.main` proves the whole app still wires up without the deleted module.

- [ ] **Step 5: Run the backend unit suite + a smoke of the app**

Run from `backend/`:

```bash
uv run pytest tests/unit -q
```

Expected: PASS (the only file referencing the deleted classes — `test_project_schemas.py` — is gone). If the coverage gate complains about total coverage, note it: removing dead code and its dead tests is coverage-neutral on real behavior; the gate runs in CI against the integration suite.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(schemas): delete dead project.py schema module (unused CRUD/member DTOs)"
```

---

### Task 3: Route the Quality-Assessment page's user-facing text through `t()`

`frontend/pages/QualityAssessmentFullScreen.tsx` hardcodes ~12 user-facing strings (button labels, toasts, the kind badge, loading text, the missing-params error), violating the copy rule. Reuse existing `common` keys where present; add new `qa` keys for the QA-specific strings.

**Files:**
- Modify: `frontend/lib/copy/qa.ts` (add keys)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` (route strings through `t`)
- Test: `frontend/test/QualityAssessmentFullScreen.test.tsx` (existing assertions reference visible text — keep them green)

**Interfaces:**
- Consumes: existing `common.back`, `common.loading` (already in `frontend/lib/copy/common.ts`).
- Produces: new `qa.*` copy keys listed in Step 1.

- [ ] **Step 1: Add the new `qa` copy keys**

In `frontend/lib/copy/qa.ts`, add to the `qa` object (group them with a comment near the existing compare-toggle keys):

```ts
  // QualityAssessmentFullScreen — header, status, toasts
  badge: 'Quality Assessment',
  loadingTemplate: 'Loading template…',
  missingRouteParams: 'Missing route parameters.',
  extractWithAI: 'Extract with AI',
  extractingProgress: 'Extracting…',
  publishButton: 'Publish assessment',
  publishingProgress: 'Publishing…',
  publishedState: 'Published',
  finalizationSuccess: 'Assessment finalized.',
  reopenSuccess: 'Assessment reopened for revision.',
  publishSuccess: 'Assessment published.',
  publishEmptyError: 'Fill at least one signaling question before publishing.',
```

- [ ] **Step 2: Replace the hardcoded strings in the page**

In `frontend/pages/QualityAssessmentFullScreen.tsx`, make these exact replacements (the file already imports `t` from `@/lib/copy`):

| Current | Replace with |
| --- | --- |
| `toast.success("Assessment finalized.");` | `toast.success(t('qa', 'finalizationSuccess'));` |
| `toast.success("Assessment reopened for revision.");` | `toast.success(t('qa', 'reopenSuccess'));` |
| `"Fill at least one signaling question before publishing.",` | `t('qa', 'publishEmptyError'),` |
| `toast.success("Assessment published.");` | `toast.success(t('qa', 'publishSuccess'));` |
| `Missing route parameters.` (JSX text) | `{t('qa', 'missingRouteParams')}` |
| `aria-label="Back"` | `aria-label={t('common', 'back')}` |
| `Back` (JSX text in the back button) | `{t('common', 'back')}` |
| `Quality Assessment` (JSX text in `qa-kind-badge`) | `{t('qa', 'badge')}` |
| `template?.name ?? (loading ? "Loading…" : "—")` | `template?.name ?? (loading ? t('common', 'loading') : "—")` |
| `{extractingAI ? "Extracting…" : "Extract with AI"}` | `{extractingAI ? t('qa', 'extractingProgress') : t('qa', 'extractWithAI')}` |
| `{publishing ? "Publishing…" : finalized ? "Published" : "Publish assessment"}` | `{publishing ? t('qa', 'publishingProgress') : finalized ? t('qa', 'publishedState') : t('qa', 'publishButton')}` |
| `Loading template…` (JSX text in the loading block) | `{t('qa', 'loadingTemplate')}` |

Leave the `"—"` em-dash placeholder and the `PrumoPdfViewer` stub text (not user-facing copy) as-is.

- [ ] **Step 3: Verify no hardcoded user-facing literal remains**

Run:

```bash
rg -n '"[A-Z][a-z].*[a-z]"|>[A-Z][a-z]+ ' frontend/pages/QualityAssessmentFullScreen.tsx | rg -v "t\(|data-testid|className|aria-label=\{|import|//|/\*"
```

Expected: no user-facing English sentence/label literals remain (matches should be only attribute values like testids/classes, never display text). Manually confirm the back button, badge, loading text, AI button, publish button, and the four toasts all read from `t(...)`.

- [ ] **Step 4: Run the QA page test + the copy-vocabulary test + typecheck**

Run:

```bash
npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx frontend/test/copy-run-vocabulary.test.ts
npm run typecheck
```

Expected: PASS. The QA page test asserts visible text (e.g. the `qa-kind-badge` content "Quality Assessment", the `qa-extract-ai-button` text "Extract with AI") — those strings are unchanged at runtime (the copy values equal the old literals), so the assertions still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/copy/qa.ts frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "refactor(qa): route Quality-Assessment page text through the copy layer"
```

---

### Task 4: Language + polish sweep

Small, independent hygiene fixes flagged by the cleanup review.

**Files:**
- Modify: `frontend/components/extraction/header/HeaderPDFControls.tsx:25,30` (Portuguese comments → English)
- Modify: `frontend/lib/copy/consensus.ts` (regroup the manager-visibility keys)
- Modify: `frontend/lib/copy/qa.ts` (reword `compareToggleAria`)
- Test: `frontend/test/components/QualityAssessmentConfiguration.test.tsx` (add the manager-OFF case)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (copy/comment/test only).

- [ ] **Step 1: English comments in `HeaderPDFControls.tsx`**

Replace line 25 `// Modo comparação` with `// Comparison mode`, and line 30 `/** Modo compacto (apenas ícones) para mobile */` with `/** Compact mode (icons only) for mobile */`.

- [ ] **Step 2: Regroup the consensus copy keys**

In `frontend/lib/copy/consensus.ts`, the six manager-visibility keys (`managerVisibilityCardTitle`, `managerVisibilityCardDesc`, `managerVisibilityLabel`, `managerVisibilityHint`, `managerVisibilitySaved`, `managerVisibilityError`) were inserted between `arbitratorLabel` and `arbitratorHint`. Move `arbitratorHint` up so it sits directly after `arbitratorLabel`, and keep the six manager-visibility keys together as their own commented block below the arbitrator keys. Result order:

```ts
    arbitratorLabel: 'Arbitrator',
    arbitratorHint:
        'A project member who breaks ties or sets the canonical value when reviewers disagree.',

    // Manager review visibility (per-kind blind toggle)
    managerVisibilityCardTitle: 'Manager review visibility',
    managerVisibilityCardDesc:
        'Control whether managers see other reviewers while extracting. Reviewers are always blind to each other.',
    managerVisibilityLabel: "Show other reviewers' responses to managers",
    managerVisibilityHint:
        'When off, managers review blind — they only see their own values until they turn this on. Reviewers are always blind to each other.',
    managerVisibilitySaved: 'Reviewer visibility updated.',
    managerVisibilityError: 'Could not update reviewer visibility.',
```

(Pure reordering — no key names or values change.)

- [ ] **Step 3: Make the compare-toggle aria describe the action**

In `frontend/lib/copy/qa.ts`, replace `compareToggleAria: 'Toggle comparison view',` with:

```ts
  compareToggleAria: 'Switch between assessment and comparison views',
```

(The visible label already flips between "Comparison"/"Assessment"; this aria-label now names the action regardless of state.)

- [ ] **Step 4: Add the missing "manager + setting OFF" test case**

In `frontend/test/components/QualityAssessmentConfiguration.test.tsx`, add a case after the existing "enables the toggle for a manager and reflects the persisted on-value" test:

```ts
  it("enables the toggle for a manager with the setting OFF", () => {
    mockedPermissions.mockReturnValue({
      ...BASE,
      userRole: "manager",
      isBlindMode: true,
      canSeeOthers: false,
      canManageBlindMode: true,
    });
    render(<QualityAssessmentConfiguration projectId="p1" />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeEnabled();
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
```

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run frontend/test/components/QualityAssessmentConfiguration.test.tsx
npm run typecheck
npx eslint --parser-options=tsconfigRootDir:"$(pwd)" frontend/components/extraction/header/HeaderPDFControls.tsx frontend/lib/copy/consensus.ts frontend/lib/copy/qa.ts frontend/test/components/QualityAssessmentConfiguration.test.tsx
```

Expected: 4 tests pass in the config suite (the new manager-OFF case included); typecheck clean; eslint clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/header/HeaderPDFControls.tsx frontend/lib/copy/consensus.ts frontend/lib/copy/qa.ts frontend/test/components/QualityAssessmentConfiguration.test.tsx
git commit -m "chore(blind-review): english comments, copy regroup, aria + test polish"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — clean.
- [ ] `npm run test:run` — full frontend suite green.
- [ ] `cd backend && uv run pytest tests/unit -q` — green (and `make test-backend` in CI for the integration suite).
- [ ] `bash scripts/fitness/run_all.sh` — `check_legacy_concepts.py` + `check_glossary_sync.py` + layering all OK.
- [ ] Add this plan to `.markdownlintignore` (single entry, per the docs-ci convention) before opening the PR.
- [ ] Open one PR to `dev` titled `refactor(blind-review): cleanup sweep — canonical kind, dead schemas, QA copy` and enable auto-merge (`--squash`).

## Self-Review

**Spec coverage:** Every inventory item maps to a task — kind-alias consolidation (6 sites) → Task 1; dead `project.py` module + `__init__` exports + test file → Task 2; QA-page hardcoded strings (12) → Task 3; the project.py Portuguese docstrings are subsumed by Task 2's deletion; HeaderPDFControls Portuguese comments + consensus key ordering + `compareToggleAria` + the QA-config manager-OFF test → Task 4. The data-path consolidation is explicitly out of scope.

**Placeholder scan:** No "TBD/handle appropriately" — each step has the exact current string and its exact replacement, exact file paths, and exact verify commands.

**Type consistency:** `ReviewKind` is the one canonical name (Task 1); `HITLKind`/`HITLKindParam` remain exported names aliased to it (so their consumers don't change). New `qa.*` keys in Task 3 are referenced with the identical names in the page edits. No signature drift.
