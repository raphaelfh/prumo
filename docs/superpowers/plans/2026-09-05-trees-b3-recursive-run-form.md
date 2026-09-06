---
status: in_progress
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Trees B3 — recursive run form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One recursive `EntrySection` renders the CHARMS tree — a root group with a selector, its singleton children, and a nested group rendering its own cards under the active entry — with working add / rename / remove / identify at each level. The model-named components are deleted and `ExtractionFullScreen.tsx` sheds the model plumbing.

**Architecture:** `EntrySection({group, parentInstanceId})` recurses. The ~30 props `ModelSection` takes cannot be threaded through recursion, so shared form plumbing moves into `EntryFormContext`, whose Provider sits **above** the `ExtractionFormView` memo boundary. Per-group state is `useEntryGroup`, one instance per rendered group.

**Tech Stack:** TypeScript strict, React 19 + React Compiler (`panicThreshold: 'all_errors'`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md` §8, §11, §13 item 3, §15.

**Panel (2026-09-05, three lenses — all three returned BLOCKING).** ~20 findings folded in. The load-bearing ones: my recursion test named a fixture that cannot do what I claimed; my React-Compiler guard test would have passed on the broken implementation; the nav-rail registry that drives **global progress** was absent from the plan; per-entry progress would have vanished silently; the only real-copy `{{noun}}` guard sits in a file this slice deletes; and the `role` predicate replacement is **not** row-equivalent on data the product can create.

## Scope correction: all `role` work moves to B5

§8 assigns four `role` changes to this slice. Three of them move to B5, for the same reason the plan already kept `entityTypeRoles.ts` alive — §11 assigns those files to **B3 and B5**:

| Change | Slice | Why |
| --- | --- | --- |
| `getTopLevelSections` role filter | **B5** | `AddSectionDialog.tsx:123-160` creates a root `study_section` with `cardinality='many'`; `extraction-multi-instance.e2e.ts:93-103` makes one. `parent IS NULL AND cardinality='one'` **drops** it. Not equivalent, and seeded templates cannot reveal that. |
| `useFullAIExtraction` role filter | **B5** | `fetchModelParentEntityTypeId` returns `results[0].id` and leans on 0016's partial unique index on `role='model_container'`. `parent IS NULL AND cardinality='many'` has no uniqueness → arbitrary pick the moment a template has two root groups. |
| `runViewAdapters.ts` drops `role` | **B5** | The backend still SENDS `role` (`schemas/extraction_run.py:250`). Dropping only the adapter mapping is silent — not a tsc error, not a runtime error, just `undefined` reaching readers. `types/extraction.ts:85` declares it required, so dropping the type instead cascades into ~15 spec files. |
| `entityTypeRoles.ts` partition half | **B3** | Run-form-only. `ENTITY_ROLE` survives for `templateTree.ts` (a §9/B5 file). |

Record all four in spec §13 item 5 before starting, the way B2's carry-overs were.

## Global Constraints

- **No backend change.** B2's endpoint is live.
- **Depth two is the ceiling until B5.** 0016's trigger requires a `model_section`'s parent be the `model_container`, so a nested group cannot own children. Consequence for testing, stated precisely: **both branches of `ownsChildren ? selector : cards` ARE reachable on CHARMS** — `prediction_models` (root, has children) takes the selector branch, `final_predictors` (nested, childless — verified: `seed.py:894/903` are FIELD defs, it has no child entity types) takes the cards branch through a **recursive** `EntrySection` call. What is unreachable is a *nested group that owns children*. Do not fabricate one; note it for B5.
- **React Compiler.** Provider **above** the memo boundary (precedent: `RunEditabilityProvider` in `ExtractionFullScreen.tsx`). Inside `ExtractionFormViewComponent` its 11-prop comparator would gate the entire context and freeze every consumer at every depth. Read context at the point of consumption. `values` must keep reaching `FieldInput` as a **prop** through `SectionAccordion` — `FieldInput`'s own comparator is what stops per-keystroke work.
- **Delete the `ExtractionFormView` memo comparator.** Its `// kept:` note is specifically about `models`/`modelsLoading` churn from `useModelManagement`, which this slice removes. It cannot stop what it was written to stop (context consumers re-render through `memo` anyway) and retains the power to block any prop it does not list.
- **`check_file_size.py` `MAX_LINES_DEFAULT = 800` is a hard fail for a NEW file** — no baseline entry. `EntrySection.tsx` must stay under it. `ExtractionFullScreen` sheds ~230-270 lines; landing ~1100-1180 against its 1378 cap. Tighten the baseline in the final commit only (`--update-baseline` writes the exact current count).
- **Copy values are an E2E contract.** `extraction-entry-identity.ui.e2e.ts` matches `addManually`'s value (`:75`), `modelRenameActiveTitle`'s value `'Rename active {{noun}}'` (`:106`), and `createModel`'s value (`:89`), plus a `title^="Add new "` attribute at `:74`. Rename the KEYS; keep the VALUES, and keep `title` alongside any new Tooltip — or update all four locators in this PR and say so.
- Both knip modes at zero; `check_copy_keys.py` green; eslint, `tsc --noEmit`, React Compiler build green.
- A new spec that `importActual`s a module reaching `@/integrations/supabase/client` fails **only in CI**; stub that module.

## Decisions (state in the PR body)

1. **Context above the memo boundary; `EntrySection` takes `{group, parentInstanceId}`.**
2. **`EntrySelector` becomes TABS, per §8** — `ModelSelector` is a `<Select>` (`:252 SelectTrigger`), so this is a rewrite, not the "mechanical rename" my first plan claimed. It gets its own task with role/keyboard/selection-vs-focus tests.
3. **Per-entry progress is KEPT**, re-homed off the `calculate_model_progress` RPC onto `computeRequiredFieldProgress` (`useExtractionProgress.ts:50`) scoped to the entry's subtree. That removes a `supabase.rpc` from the frontend (`.claude/rules/frontend.md` § Data access), removes the second async gap, and makes "no fetch in `useEntryGroup`" honest. The four RPC contract tests are deleted **with** the RPC read, not silently.
4. **`useEntryGroup` owns create / rename / remove**, not just selection — §8 says so and `RemoveEntryDialog` needs `hasExtractedData` / `extractedFieldsCount`. My first interface omitted them.
5. **`useAddEntry` moves INTO `EntrySection`** (or takes `parentInstanceId` explicitly). Today's `open(entityTypeId)` carries no parent and its non-model branch picks `instances.find(...)` — **the first instance of the parent type** — so adding under model #2 would create under model #1. Two sibling nested sections are otherwise indistinguishable.
6. **`Model` type moves to `entries/` as `Entry`** — it has four importers, two of which (`useExtractionFormAIActions`, `useBatchAllModelsSectionsExtraction`) survive this slice.
7. **The localStorage key changes shape**, so every user loses their remembered entry once. Say it in the PR body. Guard every read/write in try/catch — the hook runs N times per tree.

---

### Task 1: Move `Model` → `Entry`, port the noun guard

Do this FIRST: it unblocks every later deletion and preserves the only real-copy interpolation guard.

**Files:** create `frontend/components/extraction/entries/types.ts` (or extend `types/extraction.ts`); repoint `ExtractionFormView.tsx:20`, `useExtractionFormAIActions.ts:13`, `useBatchAllModelsSectionsExtraction.ts:20`, `useModelManagement.ts:24`. Port `hierarchy/entryLabelNoun.test.tsx` → `entries/EntrySelector.noun.test.tsx`.

- [ ] The noun guard runs against the **real** copy module (a key-echoing `t` mock cannot catch a broken `{{noun}}` — that is what its header says). Extend it to render an outer noun (`model`) and a nested noun (`predictor`) **simultaneously**: a single-noun test cannot catch a nested section that reads its parent's `entry_label`.
- [ ] Add a default-noun case: `entry_label: null` must read `entry`, never `model` (today's invariant, `ModelSection.test.tsx:172-176`).
- [ ] Green, commit.

---

### Task 2: `useEntryGroup` + `useEntryProgress`

**Files:** create `hooks/extraction/useEntryGroup.ts`, `hooks/extraction/useEntryProgress.ts`; tests alongside.

```ts
interface UseEntryGroupReturn {
  entries: ExtractionInstance[];        // by entity type AND parent, sort_order asc
  activeEntryId: string | null;
  setActiveEntryId: (id: string) => void;
  noun: string;
  createEntry: (key: string) => Promise<void>;
  renameEntry: (id: string) => void;
  removeEntry: (id: string) => Promise<void>;
}
```

- [ ] **Failing tests.** Entries filtered by entity type AND parent — assert **both** the included id and an excluded same-type instance under a different parent (S1: an entity-type-only filter passes without it). localStorage restored only when present in the list; the existence check applies to the **restored** id only, never to an explicit `setActiveEntryId` (otherwise a just-created entry snaps back to the first). Two nested groups under different parents keep independent selections.
- [ ] Port `useModelManagement.test.tsx:518` ("initial model preference") — `useEntryGroup` still restores against a list that changes shape on every run-view refetch, so that case survives even though the load-generation cases do not.
- [ ] `useEntryProgress` derives from `computeRequiredFieldProgress` over the entry's subtree instances. Delete `fetchModelProgress`, `loadModelInstances`, `ModelInstanceRow` and `extractionInstanceService.fetchModelProgress.test.ts` in this commit — `fetchModelProgress` passes plain `knip` and fails `knip --production` (its only remaining consumer is that test), the same split B2 hit.
- [ ] Green, commit.

---

### Task 3: `EntrySelector` (tabs) + `RemoveEntryDialog`

**Files:** create `entries/EntrySelector.tsx`, `entries/RemoveEntryDialog.tsx`; port `hierarchy/ModelSelector.readonly.test.tsx`; delete both originals + `hierarchy/entryLabelNoun.test.tsx` (ported in Task 1).

Select → Tabs. Every control must satisfy `.claude/rules/frontend.md` § UI & copy — and four violations exist **today** that a rename would carry forward:

| control | today | required |
| --- | --- | --- |
| AI-extract trigger (`:200-213`) | no Tooltip, no aria-label, `hidden sm:inline` | Tooltip + `sr-only @[…]:not-sr-only` |
| Add / "New" (`:235-244`) | no Tooltip, no aria-label, `hidden sm:inline` | Tooltip + `sr-only …` |
| Rename (`:268-278`) | aria-label ✓, no Tooltip | + Tooltip |
| Remove (`:281-291`) | neither | Tooltip + aria-label |
| Extract-all (`:313-331`) | Tooltip ✓, no aria-label | + aria-label |

- [ ] Tests: `getAllByRole('tab')`, `aria-selected`, roving tabindex; selection and focus draw **different** vocabularies (§4.6 — a rule that did not apply to a Select and does apply to tabs); `getByRole('button', {name: /New/})` — which passes under `sr-only` and **fails** under `hidden`, the assertion with teeth; a non-empty-accessible-name sweep over every selector button.
- [ ] Port the readonly test and run it green **before** deleting the original.
- [ ] Commit.

---

### Task 4: `EntryFormContext` + recursive `EntrySection`

**Files:** create `entries/EntryFormContext.tsx`, `entries/EntrySection.tsx`, `entries/EntrySection.test.tsx`.

- [ ] **The React-Compiler guard, written so it can fail.** My first version ("mount two nested sections under different parents, assert different entries") passes on the broken implementation, because entries come from `useEntryGroup(parentInstanceId)` — a prop — not from context. The discriminating test: mount, then change a **context-carried** value at the Provider only, keeping `group`/`parentInstanceId` referentially identical, and assert a field inside a **nested** `EntrySection` shows the new value. Then **mutation-check it**: temporarily rewrite `EntrySection` to receive the plumbing as a prop from its parent, run the spec, and quote the RED output in the PR body. vitest compiles through `reactCompilerPreset`, so the guard is real — unproven-red it is not a guard.
- [ ] **Recursion test, on the real shape.** `EntrySection(prediction_models)` renders a selector; it recurses into `EntrySection(final_predictors, parent=activeEntry)` which renders the **card list** (childless). Switching the outer model swaps which predictor cards show — and the fixture must give the two models **different, non-empty** predictor sets, or the assertion passes for the wrong reason (S2).
- [ ] Childless-group test: assert the positive (`getByRole('button', {name: /Add .*Predictor/})`) as well as the absence of a selector — the negative alone passes on a component that renders nothing (S3).
- [ ] Keep `EntrySection.tsx` under 800 lines (hard fail, no baseline).
- [ ] Commit.

---

### Task 5: Nav rail + global progress (recursive registry)

**Files:** `lib/extraction/sectionRegistry.ts`, `components/extraction/SectionNavRail.tsx`, `frontend/test/sectionRegistry.test.ts`.

`buildSectionRegistry({studyLevelSections, modelParentEntityType, modelChildSections, activeModelId})` is model-shaped and typed `level: 0 | 1`. It drives the nav rail **and** `globalProgressFromRegistry` — the run's global required-field progress. Absent from my first plan entirely; its two model-shaped tests would have stayed green while the feature regressed, because they call the builder directly.

- [ ] Recursive registry over the tree with unbounded depth; `registerSection` goes in `EntryFormContext`.
- [ ] Rewrite the two model-shaped cases in `sectionRegistry.test.ts` for a tree, and assert global progress over a nested group's instances.
- [ ] Commit.

---

### Task 6: Wire it up, delete the model surface

**Files:** `ExtractionFormView.tsx`, `ExtractionFullScreen.tsx`, `useAddEntry.ts`, `useExtractionFormAIActions.ts`, copy files; delete `ModelSection.tsx` + test, `useModelManagement.ts` + test, `hierarchy/*`; trim `entityTypeRoles.ts` and `frontend/test/lib/entityTypeRoles.test.ts`; rewrite `frontend/test/ExtractionFormView.test.tsx` (573 lines, mocks the deleted `hierarchy/ModelSelector` path) and `frontend/test/spinner-fix.e2e.test.tsx` (its documented chain is `ExtractionFormView → ModelSection → SectionAccordion → FieldInput`).

- [ ] `useExtractionFormAIActions` moves into `EntrySection` (it takes `activeModelId` + `models`, and §8 puts "extract all for this {noun}" on **every** group's selector). Its `onRefreshModels().then(onRefreshInstances)` collapses to `onRefreshInstances()` — `refreshModels` dies with the hook.
- [ ] `useAddEntry`: parent from the enclosing section (Decision 5). Its two model-branch tests (`useAddEntry.test.tsx:134,:191`) go; `:191` asserts `extractionScreenSelectModelFirst`, which then orphans — delete the key in the same commit.
- [ ] **Copy rename — the full set**, not a `model*` prefix sweep. Beyond the obvious: `modelNamePlaceholder`, `modelNameHint`, `modelsAlreadyAdded`, `modelCreateError` (in `AddEntryDialog.tsx`, a file that SURVIVES); `modelExtractionErrorTitle`/`SuccessTitle`/`SuccessTokens` (in `useModelExtraction.ts`, which survives — and `useModelExtraction.test.tsx` asserts the literal key string, so it fails on rename); and the keys referenced only by the deleted components: `selectModelPlaceholder`, `addManually`, `removeModelTitle`, `removeModelDesc`, `removeModelWarningTitle`, `removeModelAnyway`, `removeModel`, `modelNotAuthenticatedOrInvalid`, `modelCreatedSuccess`, `modelRemovedSuccess`.
- [ ] Docs: `docs/reference/extraction-hitl-architecture.md:300-304` names `ModelSection`/`ModelSelector`/`partitionEntityTypes`; `docs/reference/test-strategy.md:185` names the deleted spec; `scripts/fitness/check_legacy_concepts.py:73-77` allowlists `entityTypeRoles.ts` with a rationale that goes stale.
- [ ] Gates: both knip modes, `check_copy_keys.py`, `check_file_size.py`, `tsc`, eslint, `npm run test:run`.
- [ ] Commit.

---

### Task 7: `/design-review` + E2E + quality-scan

- [ ] `/design-review` on the run form. §8 restructures the whole per-entry region and Task 3 replaces a dropdown with tabs — the diff cannot tell you whether it reads right.
- [ ] `npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --workers 1` — **run it, do not assert it**. Four locators depend on copy values and a `title` attribute (Global Constraints).
- [ ] `make quality-scan`.

## Verify (§13 item 3)

```bash
npm run test:run && npx tsc --noEmit && npm run lint
npx knip --no-tag-hints && npx knip --production --no-tag-hints
python3 scripts/fitness/check_file_size.py && python3 scripts/fitness/check_copy_keys.py
make quality-scan
npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --workers 1
```

§13 item 3's goal text also says "a depth-three fixture with two root groups renders every level". This slice **narrows** that: depth three is unrepresentable until 0069 drops the trigger. Stated, not quietly skipped.

Every claim of green quotes the command's output (§15).
