# #197 Frontend Typecheck Burn-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `npm run typecheck` from 183 errors to 0 in small, independently-reviewable PRs batched by error class, then flip the frontend typecheck CI gate from non-blocking to blocking and close issue #197.

**Architecture:** A ratchet locks the error ceiling first (no new errors can land while we burn down), mirroring the repo's existing backend coverage ratchet. Each subsequent PR eliminates one error *class* (or a tight file cluster), lowers the committed budget, and merges to `dev` green. The final PR sets the budget to 0, replaces the ratchet with a plain blocking `tsc`, and closes #197.

**Tech Stack:** TypeScript 5 (strict), `tsc -p tsconfig.app.json --noEmit`, React 18 + Vite, the in-house i18n module at `frontend/lib/copy/` (single-locale English objects, keys validated as a string-literal union by `t(namespace, key)`), GitHub Actions (`.github/workflows/ci.yml`), Node ESM scripts.

---

## Baseline (measured on `dev` @ `c70254f`, 2026-06-06)

`npm run typecheck 2>&1 | grep -c "error TS"` → **183**. By class:

| Class | Code | Count | Fix shape | Task |
|---|---|---:|---|---|
| Unused locals/imports | TS6133 | 22 | delete the dead binding / import | 2 |
| Implicit-`any` params | TS7006 | 7 | add an explicit param type | 3 |
| Module/name resolution | TS2307/2304/2552 | 4 | fix import path / add import / fix scope bug | 4 |
| Possibly-`null` | TS18047 | 10 | guard / non-null after assertion | 5 |
| **i18n missing keys** | TS2345 (key-union) | **74** | add 62 missing keys to the copy module | 6 |
| Property-does-not-exist | TS2339 | 21 | correct the type / access | 7 |
| Type-mismatch tail | TS2322/2345-other/2769/2353/2739/2740/2698/2589/2554/2352/2344 | 45 | per-case | 8 |
| **Total** | | **183** | | |

> Regenerate the live list at any time:
> ```bash
> npm run typecheck 2>&1 | grep "error TS" > /tmp/ts.txt
> grep -oE "error TS[0-9]+" /tmp/ts.txt | sort | uniq -c | sort -rn
> ```

**Important context:**
- The gate at `.github/workflows/ci.yml:439-441` is `continue-on-error: true` (non-blocking). `vite build` uses esbuild (strips types), so these errors do **not** break the app build — only `tsc` sees them.
- `tsconfig.app.json` `"include": ["frontend"]` covers `frontend/e2e/` (Playwright) and `frontend/test/` (Vitest) too. **Keep them in scope** — several e2e errors are real bugs (e.g. leading-slash import paths). Do not "fix" by excluding directories.
- Every PR targets `dev`, squash-merged, English-only copy/commits (CLAUDE.md §1), Conventional Commits.

---

## File Structure

| File | Responsibility | Created/Modified in |
|---|---|---|
| `scripts/typecheck-ratchet.mjs` | Run tsc, count `error TS`, fail if `count > budget` (and remind to lower when `count < budget`). | Task 1 (create), Task 9 (delete) |
| `scripts/typecheck-budget.txt` | The single committed integer ceiling. Lowered by every burn-down PR. | Task 1 (create `183`), Tasks 2-8 (lower), Task 9 (delete) |
| `package.json` | Add `"typecheck:ratchet"` script. | Task 1 (add), Task 9 (remove) |
| `.github/workflows/ci.yml` | The "Type check (frontend)" step. | Task 1 (ratchet, blocking), Task 9 (plain `tsc`, blocking) |
| `frontend/lib/copy/extraction.ts` (+ maybe `common.ts`) | Add the 62 missing i18n keys. | Task 6 |
| ~40 component/hook/test/e2e files | Per-class fixes. | Tasks 2-8 |

---

### Task 1: Ratchet harness — lock the ceiling at 183

**Why first:** makes every later PR safe — once merged, CI fails any PR that *adds* a type error, so the burn-down can proceed incrementally without regressions.

**Files:**
- Create: `scripts/typecheck-ratchet.mjs`
- Create: `scripts/typecheck-budget.txt`
- Modify: `package.json` (scripts block)
- Modify: `.github/workflows/ci.yml:433-441`

- [ ] **Step 1: Create the budget file**

`scripts/typecheck-budget.txt`:
```
183
```

- [ ] **Step 2: Create the ratchet script**

`scripts/typecheck-ratchet.mjs`:
```js
#!/usr/bin/env node
// Typecheck ratchet: fail if frontend tsc errors exceed the committed budget.
// Lower scripts/typecheck-budget.txt in the same PR that fixes errors.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const budget = Number(readFileSync(join(here, 'typecheck-budget.txt'), 'utf8').trim());

let out = '';
try {
  out = execSync('npx tsc -p tsconfig.app.json --noEmit', { encoding: 'utf8' });
} catch (e) {
  out = `${e.stdout || ''}${e.stderr || ''}`;
}
const count = (out.match(/error TS\d+/g) || []).length;
console.log(`typecheck errors: ${count} (budget ${budget})`);

if (count > budget) {
  console.error(`❌ Typecheck errors increased: ${count} > budget ${budget}.`);
  console.error('Fix the new error(s) or do not introduce them.');
  process.exit(1);
}
if (count < budget) {
  console.error(`✅ Errors reduced to ${count}. Lower scripts/typecheck-budget.txt to ${count} in this PR to ratchet down.`);
  process.exit(1);
}
console.log('✅ At budget.');
```

- [ ] **Step 3: Add the npm script**

In `package.json` `"scripts"`, after `"typecheck"`:
```json
"typecheck:ratchet": "node scripts/typecheck-ratchet.mjs",
```

- [ ] **Step 4: Wire it into CI (blocking, replaces the non-blocking step)**

Replace `.github/workflows/ci.yml:433-441` (the comment block + the step) with:
```yaml
      # Frontend typecheck RATCHET. The error budget lives in
      # scripts/typecheck-budget.txt and is lowered by each burn-down PR
      # (#197). This step is BLOCKING: it fails if errors exceed budget,
      # so no new type errors can land while we burn down. The final #197
      # PR sets the budget to 0 and replaces this with a plain `tsc`.
      - name: Type check ratchet (frontend)
        run: npm run typecheck:ratchet
```

- [ ] **Step 5: Verify locally — at budget passes**

Run: `npm run typecheck:ratchet`
Expected: `typecheck errors: 183 (budget 183)` then `✅ At budget.` exit 0.

- [ ] **Step 6: Verify the ratchet bites — temporary regression fails**

Add a throwaway type error (e.g. in any `.ts` file add `const _x: number = 'nope';`), then:
Run: `npm run typecheck:ratchet`
Expected: `❌ Typecheck errors increased: 184 > budget 183.` exit 1. **Remove the throwaway line.**

- [ ] **Step 7: Commit, PR, merge**

```bash
git checkout -b chore/typecheck-ratchet
git add scripts/typecheck-ratchet.mjs scripts/typecheck-budget.txt package.json .github/workflows/ci.yml
git commit -m "ci(frontend): add typecheck error ratchet (budget 183) for #197 burn-down"
git push -u origin chore/typecheck-ratchet
gh pr create --base dev --title "ci(frontend): typecheck error ratchet (#197)" --body "Locks the frontend typecheck ceiling at 183 and makes the gate blocking, so the #197 burn-down can proceed without regressions. Budget lowered per follow-up PR."
# wait for green, then:
gh pr merge --squash --delete-branch
```

---

### Task 2: Remove unused locals & imports (TS6133 ×22 → 0)

**Files (exact list — regenerate to confirm):**
```bash
npm run typecheck 2>&1 | grep "error TS6133"
```
Known sites include: 10× unused `React` default import (`AISuggestionsPanel.tsx:8`, `ConfigureTemplateFirst.tsx:7`, `TemplateManager.tsx:8`, `ErrorState.tsx:6`, `ActiveFilterChips.tsx:1`, `EmptyListState.tsx:1`, `FilterNumericRangeField.tsx:1`, `FilterTextField.tsx:1`, `ListCount.tsx:1`, `ListFilterPanel.tsx:1`); unused `_`-prefixed locals (`ArticleForm.tsx:501` `_result`, `UnitEditor.tsx:62` `_ALL_UNITS`, `TemplateManager.tsx:64` `_handleCreateTemplate`, `ApiKeysSection.tsx:147` `_handleDeactivate`, `useFieldManagement.ts:81` `_isReviewer`, `calendar.tsx:45-46` `_props`); unused named imports (`EntitySelectorComparison.tsx:98` `instanceId`, `file-drop-zone.tsx:15` `File`, `grouping.ts:27-28` `myInstances`/`myUserId`, `useModelManagement.test.tsx:18` `ReactNode`).

- [ ] **Step 1: Apply the pattern per site**

For each error:
- **Unused `import React from 'react'`** with JSX present (react-jsx runtime ⇒ React import not needed): delete the line. If the file uses `React.X` (e.g. `React.memo`), instead switch to a named import (`import { memo } from 'react'`) and update call sites.
- **Unused `_`-prefixed local** (genuinely dead, e.g. `const _ALL_UNITS = …`): delete the declaration and any now-dead RHS. If a destructure (`const { _isReviewer } = …`), drop just that binding.
- **Unused named import**: remove from the import list; delete the `import {}` line if it becomes empty.

Worked example — `frontend/components/extraction/AISuggestionsPanel.tsx:8`:
```diff
-import React from 'react';
```
Worked example — `frontend/lib/comparison/grouping.ts:27-28`:
```diff
-  const myInstances = …;   // delete: never read
-  const myUserId = …;      // delete: never read
```

- [ ] **Step 2: Verify the class is gone and nothing else broke**

Run: `npm run typecheck 2>&1 | grep -c "error TS6133"`
Expected: `0`
Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `161`

- [ ] **Step 3: Lint the touched files**

Run: `npx eslint <each touched file>`
Expected: exit 0 (no `no-unused-vars`, no broken imports).

- [ ] **Step 4: Lower the budget**

Set `scripts/typecheck-budget.txt` to `161`. Run `npm run typecheck:ratchet` → `✅ At budget.`

- [ ] **Step 5: Commit, PR, merge**

```bash
git checkout -b chore/ts-unused-cleanup
git add -A
git commit -m "refactor(frontend): remove unused imports and locals (TS6133, #197)"
git push -u origin chore/ts-unused-cleanup
gh pr create --base dev --title "refactor(frontend): remove unused imports/locals (#197)" --body "Clears all 22 TS6133 errors. Budget 183 → 161. No behaviour change."
gh pr merge --squash --delete-branch   # after green
```

---

### Task 3: Annotate implicit-`any` parameters (TS7006 ×7 → 0)

**Files:** `EntitySelectorComparison.tsx:61,197`, `SingleInstanceComparison.tsx:21,86`, `chart.tsx:163,163,249`.

- [ ] **Step 1: Add the real parameter type at each site**

Pattern: find the callback whose param is untyped and give it the element type of the array it maps/filters. Read the array's declared type to pick the right one — do **not** annotate with `any` (defeats the gate).

Worked example — `frontend/components/shared/comparison/EntitySelectorComparison.tsx:61`:
```diff
-  fields.map((field) => …)
+  fields.map((field: ExtractionFieldComparison) => …)
```
(Use the element type already imported in the file; if the array is `someTyped[]`, hover/read its type. For `chart.tsx` the `item`/`index` come from Recharts `payload` — type as `{ payload?: Record<string, unknown> }` / `number` matching the existing `payload` shape in that file.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS7006"` → `0`
Run: `npm run typecheck 2>&1 | grep -c "error TS"` → `154`

- [ ] **Step 3: Lower budget to `154`, commit, PR, merge**

```bash
git checkout -b fix/ts-implicit-any-params
git add -A
git commit -m "fix(frontend): annotate implicit-any callback params (TS7006, #197)"
# budget file already staged via -A
gh pr create --base dev --title "fix(frontend): annotate implicit-any params (#197)" --body "Clears 7 TS7006. Budget 161 → 154."
```

---

### Task 4: Fix module/name-resolution bugs (TS2307 ×2, TS2304 ×1, TS2552 ×1 → 0)

These are **real bugs**, not type noise.

**Files & fixes:**
- `frontend/e2e/flows/extraction-refresh.ui.e2e.ts:44` — `Cannot find module '/frontend/lib/extraction/valueUpdates.ts'`. Leading-slash path. Change to the alias: `@/lib/extraction/valueUpdates` (drop `/` prefix and `.ts`).
- `frontend/e2e/flows/extraction-value-coherence.ui.e2e.ts:78` — same bug: `'/frontend/integrations/supabase/client.ts'` → `@/integrations/supabase/client`.
- `frontend/hooks/extraction/useExtractionData.ts:233` — `Cannot find name 'ExtractionField'`. Add the missing import from the types module that declares it (`grep -rn "interface ExtractionField\b\|type ExtractionField\b" frontend/types frontend/lib` to find the source), e.g. `import type { ExtractionField } from '@/types/extraction';`.
- `frontend/components/articles/ArticleFileUploadDialogNew.tsx:347` — `Cannot find name 'error'. Did you mean 'Error'?`. A reference to `error` outside the `catch (error)` scope. Read lines ~330-355: either move the usage inside the catch, or capture the value into an outer `let message` before the block. Fix the scope, don't rename to `Error`.

- [ ] **Step 1: Apply each fix** (read each call site first; the e2e ones are mechanical, the `ArticleFileUploadDialogNew` one needs the surrounding block read).
- [ ] **Step 2: Verify** `npm run typecheck 2>&1 | grep -cE "error TS(2307|2304|2552)"` → `0`; total → `150`.
- [ ] **Step 3:** Lower budget to `150`, commit (`fix(frontend): resolve broken imports + out-of-scope ref (#197)`), PR, merge.

---

### Task 5: Null-handling (TS18047 ×10 → 0)

**Files:** mostly e2e (`extraction-reopen.ui.e2e.ts:136,137`, `hitl-ai-proposal.api.e2e.ts:150,151,…`) plus a few app sites. Regenerate: `npm run typecheck 2>&1 | grep "error TS18047"`.

- [ ] **Step 1: Apply the right guard per site (do not blanket-`!`)**
- In **e2e/test helpers** where a query is known-present by construction, a non-null assertion is acceptable *after* an explicit `expect(x).not.toBeNull()` / `expect(x).toBeTruthy()` so the test fails loudly, e.g.:
```diff
-  const instance = instances.find(…);
-  await page.fill(`#${instance.id}`, …);
+  const instance = instances.find(…);
+  expect(instance, 'instance must exist').toBeTruthy();
+  await page.fill(`#${instance!.id}`, …);
```
- In **app code**, prefer optional chaining + a real fallback or early return over `!` (a null here is a real runtime risk):
```diff
-  return run.article_id;
+  if (!run) return null;
+  return run.article_id;
```
- [ ] **Step 2: Verify** `grep -c "error TS18047"` → `0`; total → `140`. For e2e changes, also run the relevant Playwright spec if feasible, otherwise rely on `Frontend Build` + the ratchet.
- [ ] **Step 3:** Lower budget to `140`, commit (`fix(frontend): guard possibly-null access (TS18047, #197)`), PR, merge.

---

### Task 6: Add the 62 missing i18n keys (TS2345 key-union ×74 → 0)

**Highest-value task** — these keys are referenced by `t('extraction', 'key')` but **absent** from `frontend/lib/copy/extraction.ts`, so the UI currently renders nothing/the raw key. Adding them fixes real missing-label bugs *and* clears 74 errors.

**Files:** `frontend/lib/copy/extraction.ts` (almost all), possibly `frontend/lib/copy/common.ts` for any key whose call site uses `t('common', …)`.

**Concentrated in:** `AddSectionDialog.tsx` (13), `TemplateConfigEditor.tsx` (13), `RemoveSectionDialog.tsx` (10), `AllowedUnitsList.tsx` (7), `SectionAccordion.tsx` (5), `FieldsTable.tsx` (5), `AddModelDialog.tsx` (4), `AllowedValuesList.tsx` (4), `FieldsManagerWithDragDrop.tsx` (4), `ModelSelector.tsx` (3), `AISuggestionDisplay.tsx` (2), `ArticlesExportDialog.tsx` (2), `QualityAssessmentInterface.tsx` (1), `AISuggestionDetailsPopover.tsx` (1).

- [ ] **Step 1: Confirm the live key list + namespace per key**

```bash
npm run typecheck 2>&1 | grep "error TS2345" | grep "parameter of type '\"" \
 | sed -E "s/.*Argument of type '\"?([a-zA-Z0-9_]+)\"?'.*/\1/" | grep -v '^string$' | sort -u
```
For each key, find its call site and the namespace it's called under:
```bash
grep -rn "'<key>'" frontend --include='*.tsx' --include='*.ts' | grep "t('"
```
Most are `t('extraction', …)`; the two `'string'` (non-literal) TS2345 are `ArticlesExportDialog.tsx:154,174` passing a runtime `string` into `t()` — fix those by narrowing the variable to the key union or mapping it, **not** by adding a key.

- [ ] **Step 2: Add each key to the matching copy object with an English value**

Add to the `extraction` object in `frontend/lib/copy/extraction.ts`, grouped near related keys. Proposed values (verify wording against each call site; `{{n}}` for interpolated counts):

| key | value |
|---|---|
| `typeColumn` | `Type` |
| `typeLabel` | `Type` |
| `fieldColumn` | `Field` |
| `requiredColumn` | `Required` |
| `technicalName` | `Technical name` |
| `fieldsCountLabel` | `{{n}} field(s)` |
| `fieldLabelPlaceholder` | `Field label` |
| `editLabelButton` | `Edit label` |
| `removeButton` | `Remove` |
| `suggestionsButton` | `Suggestions` |
| `subSections` | `Subsections` |
| `dashboardProgress` | `Progress` |
| `sectionSingle` | `section` |
| `sectionMultiple` | `sections` |
| `sectionCreateError` | `Error creating section` |
| `sectionCreatedSuccess` | `Section created successfully` |
| `sectionRemoveError` | `Error removing section` |
| `sectionRemovedSuccess` | `Section removed successfully` |
| `sectionAnalyzeError` | `Error analyzing section` |
| `sectionErrorAnalyzing` | `Error analyzing section` |
| `sectionEmptySafe` | `This section is empty and safe to remove` |
| `sectionWarnDataLost` | `This data will be permanently lost` |
| `sectionWarnFieldsRemoved` | `{{n}} field(s) will be removed` |
| `sectionWarnInstancesRemoved` | `{{n}} instance(s) will be removed` |
| `confirmSectionName` | `Type the section name to confirm` |
| `confirmSectionNameExact` | `The name must match exactly` |
| `placeholderSectionLabel` | `Section label` |
| `placeholderSectionDescription` | `Section description` |
| `placeholderOptions` | `Enter options` |
| `placeholderUnits` | `Enter units` |
| `labelRequired` | `Label is required` |
| `labelMin2` | `Label must be at least 2 characters` |
| `labelMax100` | `Label must be at most 100 characters` |
| `descriptionMax500` | `Description must be at most 500 characters` |
| `nameRequired` | `Name is required` |
| `nameMin2` | `Name must be at least 2 characters` |
| `nameMax50` | `Name must be at most 50 characters` |
| `nameFormat` | `Invalid name format` |
| `cardinalityUnique` | `Unique` |
| `cardinalityMultiple` | `Multiple` |
| `cardinalityRequired` | `Required` |
| `unitLabel` | `Unit` |
| `enterUnit` | `Enter a unit` |
| `searchUnit` | `Search unit` |
| `noUnitFound` | `No unit found` |
| `unitAlreadyAdded` | `Unit already added` |
| `max20Units` | `At most 20 units` |
| `enterValue` | `Enter a value` |
| `valueAlreadyAdded` | `Value already added` |
| `max100Values` | `At most 100 values` |
| `extractSectionWithAI` | `Extract section with AI` |
| `extractAllSectionsWithAI` | `Extract all sections with AI` |
| `extractingWithAI` | `Extracting with AI…` |
| `extractingAllSectionsWithAI` | `Extracting all sections with AI…` |
| `createInstanceBeforeExtract` | `Create an instance before extracting` |
| `modelCreateError` | `Error creating model` |
| `modelNameEmpty` | `Model name cannot be empty` |
| `modelNameMinLength` | `Model name must be at least 2 characters` |
| `modelNameDuplicate` | `A model with this name already exists` |
| `aiEvidenceClickTitle` | `Click to view evidence` |
| `aiEvidenceClickAria` | `View evidence for this suggestion` |
| `evidenceCitedAria` | `Cited evidence` |

> Note: `sectionAnalyzeError`/`sectionErrorAnalyzing` and `typeColumn`/`typeLabel` look like near-duplicates — confirm both call sites genuinely exist before adding both; if one is a typo at the call site, fix the call site instead.

- [ ] **Step 3: Verify**

Run: `npm run typecheck 2>&1 | grep "error TS2345" | grep -c "parameter of type '\""` → `0`
Run: `npm run typecheck 2>&1 | grep -c "error TS"` → `66`

- [ ] **Step 4: Smoke-check the UI** (optional but recommended): open one config dialog (e.g. Add Section) locally on `:5173` and confirm labels render instead of raw keys.

- [ ] **Step 5:** Lower budget to `66`, commit (`fix(i18n): add missing extraction copy keys (TS2345, #197)`), PR (note: "fixes missing UI labels in extraction config dialogs"), merge.

> If a 62-key diff feels too large to review in one PR, split by dialog cluster: PR 6a = section/field dialog keys (AddSection/RemoveSection/FieldsTable/TemplateConfigEditor), PR 6b = unit/value/model/AI keys. Lower the budget in two steps.

---

### Task 7: Property-does-not-exist (TS2339 ×21 → 0)

**Files:** `NotificationCenter.tsx` (6), `chart.tsx` (4), `SingleInstanceComparison.tsx` (3), `EntitySelectorComparison.tsx` (3), `useExtractionData.ts` (2), `extractionInstanceService.ts` (1), `useScreenCapture.ts` (1), `useComparisonPermissions.ts` (1). Regenerate: `npm run typecheck 2>&1 | grep "error TS2339"`.

- [ ] **Step 1: Fix per case — read the type, not the symptom**

These are not all the same. Decide per site:
- **Dead access** (the property never existed, like the `instance.status` case already removed from `ArticleExtractionTable`): delete the dead branch.
- **Wrong/loose type**: the object is typed too narrowly/widely — correct the interface or the source query's select. Prefer fixing the declared type over casting.
- **Genuinely dynamic** (e.g. Recharts payload in `chart.tsx`): type the access through a defined shape (`(payload as { value?: number }).value`), never `any`.

Worked example — `frontend/hooks/extraction/useExtractionData.ts:233` (`ExtractionField`): tie this together with the Task 4 missing-import fix if both touch the same type; otherwise add the property to the interface that should declare it.

- [ ] **Step 2: Verify** `grep -c "error TS2339"` → `0`; total → `45`.
- [ ] **Step 3:** Lower budget to `45`, commit (`fix(frontend): correct property access/types (TS2339, #197)`), PR, merge.

> Split allowed: `NotificationCenter` + `chart.tsx` (UI) as one PR, the comparison/hook/service sites as another, lowering budget in two steps.

---

### Task 8: Type-mismatch tail (TS2322 ×22, TS2345-other ×6, TS2769 ×6, TS2353 ×3, TS2739 ×2, + singletons TS2740/2698/2589/2554/2352/2344 → 0)

**Files (clusters):** `useExtractedValues.test.tsx` (3), `ModelSection.tsx` (3+2), `ProjectSettings.tsx` (2), `ExtractionFormView.tsx` (2), `calendar.tsx` (2), `useFileUpload.ts`/`useMultiFileUpload.ts` (file-list typing), `queryEntityTypes.ts`, `extractionInstanceService.ts`, `RISImportDialog.tsx`, `ArticleFileUploadDialogNew.tsx`, `types-validation.test.ts`, `errors.ts`, `ExtractionFullScreen.tsx`, `e2e/_fixtures/storage.ts`. Regenerate per code:
```bash
for c in 2322 2769 2353 2739 2740 2698 2589 2554 2352 2344; do echo "== TS$c =="; npm run typecheck 2>&1 | grep "error TS$c"; done
npm run typecheck 2>&1 | grep "error TS2345" | grep -v "parameter of type '\""   # the 6 non-i18n
```

- [ ] **Step 1: Fix per case, grouped by file** (read each; these are real shape mismatches — null vs non-null props, wrong generic args, object-literal excess properties). For the **test files** (`useExtractedValues.test.tsx`, `types-validation.test.ts`, `useExtractionData.test.tsx`) the fix is usually correcting the mock/fixture object to match the real type (e.g. `'ai'` vs `'human'` literal, missing required fields) — do **not** loosen the production type to satisfy a test.
- [ ] **Step 2: Verify** `npm run typecheck 2>&1 | grep -c "error TS"` → `0`.
- [ ] **Step 3:** Lower budget to `0`, commit (`fix(frontend): resolve remaining type mismatches (#197)`), PR, merge.

> This is the longest tail — split into 2-3 PRs by file cluster (UI / hooks+services / tests) if review size demands; lower the budget incrementally so each PR stays green against the ratchet.

---

### Task 9: Flip the gate to blocking & close #197

**Pre-req:** `npm run typecheck 2>&1 | grep -c "error TS"` → `0` and `scripts/typecheck-budget.txt` is `0`.

**Files:** `.github/workflows/ci.yml`, `package.json`, delete `scripts/typecheck-ratchet.mjs` + `scripts/typecheck-budget.txt`.

- [ ] **Step 1: Replace the ratchet step with a plain blocking typecheck**

`.github/workflows/ci.yml` — the "Type check ratchet (frontend)" step becomes:
```yaml
      # Frontend typecheck is clean (#197 burned down) — now blocking.
      - name: Type check (frontend)
        run: npm run typecheck
```

- [ ] **Step 2: Remove the ratchet plumbing**

```bash
git rm scripts/typecheck-ratchet.mjs scripts/typecheck-budget.txt
```
Remove the `"typecheck:ratchet"` line from `package.json`.

- [ ] **Step 3: Verify locally**

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 4: Commit, PR, merge — close #197**

```bash
git checkout -b ci/typecheck-blocking
git add -A
git commit -m "ci(frontend): make typecheck blocking; backlog cleared (closes #197)"
git push -u origin ci/typecheck-blocking
gh pr create --base dev --title "ci(frontend): make typecheck blocking (closes #197)" --body "All 183 frontend type errors burned down. tsc is clean; the gate is now blocking and the ratchet is removed. Closes #197."
gh pr merge --squash --delete-branch   # after green
```

- [ ] **Step 5: Confirm closure** — `gh issue view 197 --json state` → `CLOSED`.

---

## Self-Review

**1. Spec coverage:** Every one of the 183 baseline errors maps to a task by class (Tasks 2-8) and the budget math is exact: 22 + 7 + 4 + 10 + 74 + 21 + 45 = 183. Task 1 prevents regressions; Task 9 makes the win permanent and closes #197. ✅

**2. Placeholder scan:** Mechanical classes (TS6133/TS7006/TS2307/TS18047) list exact file:lines + worked before/after. The i18n task enumerates all 62 keys with concrete values. The per-case tasks (TS2339/TS2322 tail) give the exact regeneration commands, file clusters, decision rules, and worked examples — appropriate because these are genuinely heterogeneous and must be read individually; the plan tells the engineer *how to decide* per case rather than inventing a fake one-size fix. No "TBD"/"handle edge cases". ✅

**3. Type/name consistency:** Budget values are monotonic and consistent across tasks (183→161→154→150→140→66→45→0). `scripts/typecheck-budget.txt`, `scripts/typecheck-ratchet.mjs`, and the `typecheck:ratchet` npm script names match between Task 1 (create), Tasks 2-8 (use), and Task 9 (delete). The CI step name changes intentionally (`Type check ratchet (frontend)` in Task 1 → `Type check (frontend)` in Task 9). ✅

**Risk notes baked in:** never annotate with `any`; never loosen a production type to satisfy a test; never exclude e2e/test from tsconfig to hide errors; split the two largest tasks (6, 8) if review size demands, lowering the budget incrementally so each PR stays green against the ratchet.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-197-frontend-typecheck-burndown.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (PR), review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: `superpowers:executing-plans`.

Which approach?
