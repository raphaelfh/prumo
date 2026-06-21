---
status: shipped
created: 2026-06-11
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# React Compiler Zero Bailouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 80 React Compiler bailout files by extracting handler
IO into `frontend/services/` behind a typed `ErrorResult` contract, make
`panicThreshold: 'all_errors'` permanent in CI, then remove the ~210 manual
memo sites the bailouts were pinning.

**Architecture:** Services own IO and exceptions (module-level functions are
never compiled); exported service functions return `Promise<ErrorResult<T>>`
and never throw or toast; components/hooks keep only UI state with
straight-line handlers. Two stacked PRs: A (extraction + oddballs +
`all_errors` flip), B (memo removal via the #268 method).

**Tech Stack:** React 19 + React Compiler (babel-plugin-react-compiler v1),
Vite 8 + `@rolldown/plugin-babel`, vitest, Playwright, existing
`frontend/lib/error-utils.ts` and `frontend/services/` layer.

**Spec:** `docs/superpowers/specs/2026-06-11-react-compiler-zero-bailouts-design.md`

**Hard constraints (apply to every task):**

- **Relocate, never rewrite IO**: `supabase.from(...)` / `supabase.auth.*` /
  `supabase.storage.*` / `supabase.rpc(...)` calls move into services
  **verbatim** — same table, same filters, same ordering. Adding NEW reads
  violates `.claude/rules/frontend.md` (dual-read-path incident class).
  Swapping to the typed API client is the consolidation project's job, not
  this PR's.
- **PR A does not remove memoization.** `useMemo`/`useCallback`/`memo()`
  stay exactly where they are until PR B's triage.
- **Services never toast and take no UI callbacks.** All toasts, copy keys,
  and state setting stay in the component/hook.
- **English only** in code/comments/commits.
- Repo root for all frontend commands (`npm run ...`), never `cd frontend`.

---

## PR A — service extraction, oddballs, `all_errors` flip

### Task 0: Workspace setup + baseline

Work in the existing worktree
`.claude/worktrees/react-compiler-zero-bailouts` (branch
`worktree-react-compiler-zero-bailouts`, contains the spec commit
`4eddc18`). It has no `node_modules` yet.

- [ ] **Step 1: Install dependencies**

```bash
npm install
```

- [ ] **Step 2: Baseline tests**

```bash
npm run test:run 2>&1 | tail -5
```

Expected: full suite green (record the count — ~451+ tests — in
`/tmp/pr-notes.md` as the baseline). If anything fails, STOP and report;
do not proceed on a dirty baseline.

---

### Task 1: Commit the bailout enumerator script

**Files:**
- Create: `scripts/enumerate_compiler_bailouts.mjs`

- [ ] **Step 1: Write the script**

```js
// scripts/enumerate_compiler_bailouts.mjs
// Lists every frontend file the React Compiler fails to compile, with
// error categories. A panicking build stops at the FIRST failure; this
// script sweeps ALL files in one pass. Uses: sweep progress + PR-body
// counts (zero-bailouts plan), and previewing new bailouts before a
// babel-plugin-react-compiler upgrade. Files opted out via the
// 'use no memo' directive are skipped by the compiler and never listed.
// Run from the repo root: node scripts/enumerate_compiler_bailouts.mjs
import { transformAsync } from '@babel/core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const entries = await readdir('frontend', { recursive: true });
const files = entries
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f))
  .filter((f) => !/(\.test\.|\.spec\.|__tests__|__mocks__)/.test(f))
  .map((f) => path.join('frontend', f));

let failures = 0;
for (const file of files.sort()) {
  const code = await readFile(file, 'utf8');
  try {
    await transformAsync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]],
    });
  } catch (e) {
    failures += 1;
    const kinds = [...new Set(
      [...String(e.message).matchAll(/^\s*(Todo|Invariant|InvalidReact|Compilation Skipped): (.+)$/gm)]
        .map((m) => `${m[1]}: ${m[2]}`),
    )];
    console.log(`${file}\n   ${kinds.join('\n   ') || String(e.message).split('\n')[0]}`);
  }
}
console.log(`\nBAILOUT FILES: ${failures} of ${files.length}`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify the starting state**

```bash
node scripts/enumerate_compiler_bailouts.mjs | tail -1
```

Expected: `BAILOUT FILES: 80 of 474` (the 2026-06-11 inventory; small
drift from dev movement is acceptable — record the actual number).

- [ ] **Step 3: Commit**

```bash
git add scripts/enumerate_compiler_bailouts.mjs
git commit -m "chore(scripts): add react compiler bailout enumerator"
```

---

### Task 2: `toResult` service helper (TDD)

**Files:**
- Modify: `frontend/lib/error-utils.ts` (append after `withErrorHandlingResult`)
- Create: `frontend/lib/error-utils.test.ts`

`withErrorHandlingResult` exists but toasts by default — wrong for the
service layer. `toResult` is the no-UI variant: log + normalize only.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/lib/error-utils.test.ts
import {describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn(), info: vi.fn()},
}));

import {toast} from 'sonner';
import {toResult} from './error-utils';

describe('toResult', () => {
  it('wraps a resolved value in ok:true', async () => {
    const result = await toResult(async () => 42, 'test.op');
    expect(result).toEqual({ok: true, data: 42});
  });

  it('normalizes a thrown supabase-style error object', async () => {
    const result = await toResult(async () => {
      throw {message: 'row not found', code: 'PGRST116'};
    }, 'test.op');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('row not found');
    }
  });

  it('never toasts — presentation is the caller’s job', async () => {
    await toResult(async () => {
      throw new Error('boom');
    }, 'test.op');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run frontend/lib/error-utils.test.ts
```

Expected: FAIL — `toResult` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/lib/error-utils.ts` (after `withErrorHandlingResult`):

```ts
/**
 * Service-layer Result wrapper: runs an async operation and converts
 * the outcome to ErrorResult. No toast, no UI — logging only. Exported
 * service functions use this so they never throw across the boundary;
 * components decide presentation by branching on `ok`
 * (zero-bailouts spec, 2026-06-11).
 */
export async function toResult<T>(
  operation: () => Promise<T>,
  context: string
): Promise<ErrorResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (err) {
    const error = normalizeError(err);
    logger.error(`[${context}]`, error);
    return { ok: false, error };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run frontend/lib/error-utils.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/error-utils.ts frontend/lib/error-utils.test.ts
git commit -m "feat(frontend): add toResult service-layer helper to error-utils"
```

---

### Task 3: Canonical extraction #1 — loader hook (`useProjectsList`)

This is the template every loader hook in later batches follows. The hook
keeps its public signature and state machine; only the IO moves.

**Files:**
- Create: `frontend/services/projectsService.ts`
- Create: `frontend/test/services/projectsService.test.ts`
- Modify: `frontend/hooks/useProjectsList.ts`

- [ ] **Step 1: Write the failing service test**

```ts
// frontend/test/services/projectsService.test.ts
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjects} from '@/services/projectsService';

function chain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjects', () => {
  it('returns ok with rows ordered by created_at desc', async () => {
    const rows = [{id: 'p1'}, {id: 'p2'}];
    const c = chain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjects();

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.order).toHaveBeenCalledWith('created_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(chain({data: null}) as never);
    const result = await listProjects();
    expect(result).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      chain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjects();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run frontend/test/services/projectsService.test.ts
```

Expected: FAIL — module `@/services/projectsService` does not exist.

- [ ] **Step 3: Create the service**

```ts
// frontend/services/projectsService.ts
/**
 * Projects service — IO for the project list/navigation surfaces.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase reads are relocated verbatim from hooks (no
 * new reads); the data-path consolidation owns the typed-client swap.
 */
import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {ProjectListItem} from '@/types/project';

export function listProjects(): Promise<ErrorResult<ProjectListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select('*')
      .order('created_at', {ascending: false});
    if (error) throw error;
    return data ?? [];
  }, 'projectsService.listProjects');
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run frontend/test/services/projectsService.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Rewire the hook**

`frontend/hooks/useProjectsList.ts` becomes (note: `useCallback` STAYS —
removal is PR B; the supabase import goes away):

```ts
/**
 * Hook to manage project list
 * Reusable between desktop and mobile sidebar
 */

import {useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {listProjects} from '@/services/projectsService';
import type {ProjectListItem} from '@/types/project';

export const useProjectsList = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const result = await listProjects();
    if (result.ok) {
      setProjects(result.data);
    } else {
      toast.error(t('pages', 'dashboardCouldNotLoadProjects'));
      console.error(result.error);
    }
    setLoading(false);
  }, []);

  const switchProject = useCallback((projectId: string) => {
    navigate(`/projects/${projectId}`);
  }, [navigate]);

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadProjects());
  }, [loadProjects]);

  return {
    projects,
    loading,
    loadProjects,
    switchProject,
  };
};
```

- [ ] **Step 6: Verify the file now compiles + suite is green**

```bash
node scripts/enumerate_compiler_bailouts.mjs | grep -c useProjectsList; npm run test:run 2>&1 | tail -3
```

Expected: `0` from the grep; suite green.

- [ ] **Step 7: Commit**

```bash
git add frontend/services/projectsService.ts frontend/test/services/projectsService.test.ts frontend/hooks/useProjectsList.ts
git commit -m "refactor(frontend): extract useProjectsList IO to projectsService (canonical loader hook)"
```

---

### Task 4: Canonical extraction #2 — component handlers (`ProfileSection`)

Template for component handlers, including the **early-return trap**: the
original `loadProfile` early-returns inside `try` when unauthenticated and
relies on `finally` for cleanup. The new shape converts the early return
into a branch so cleanup is unconditional.

**Files:**
- Create: `frontend/services/profileService.ts`
- Modify: `frontend/components/user/ProfileSection.tsx:52-108`

- [ ] **Step 1: Create the service**

```ts
// frontend/services/profileService.ts
/**
 * Profile service — IO for the user profile settings section.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. Supabase calls
 * relocated verbatim from ProfileSection (no new reads).
 */
import {supabase} from '@/integrations/supabase/client';
import {logger} from '@/lib/logger';
import {normalizeError, toResult, type ErrorResult} from '@/lib/error-utils';

export interface ProfileData {
  email: string;
  avatarUrl: string;
  fullName: string;
}

/** Resolves to null when no user is signed in (caller decides messaging). */
export function fetchProfile(): Promise<ErrorResult<ProfileData | null>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    if (!user) return null;

    const {data: profileData, error} = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Non-fatal in the original handler: fall back to auth-user fields.
    if (error) logger.error('[profileService.fetchProfile]', normalizeError(error));

    return {
      email: user.email ?? '',
      avatarUrl: profileData?.avatar_url ?? '',
      fullName: profileData?.full_name ?? '',
    };
  }, 'profileService.fetchProfile');
}

export function saveProfile(
  values: {fullName: string; avatarUrl: string},
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const {error} = await supabase
      .from('profiles')
      .update({full_name: values.fullName, avatar_url: values.avatarUrl})
      .eq('id', user.id);
    if (error) throw error;
  }, 'profileService.saveProfile');
}
```

- [ ] **Step 2: Rewire the handlers**

In `frontend/components/user/ProfileSection.tsx`, replace `loadProfile`
(lines 52–79) and `onSubmit` (lines 86–108); drop the now-unused
`supabase` import; add `import {fetchProfile, saveProfile} from
'@/services/profileService';`:

```ts
  const loadProfile = async () => {
    setLoading(true);
    const result = await fetchProfile();
    if (!result.ok) {
      console.error('Error loading profile:', result.error);
      toast.error(t('user', 'profileErrorLoading'));
    } else if (result.data === null) {
      toast.error(t('user', 'profileErrorNotAuthenticated'));
    } else {
      setEmail(result.data.email);
      setAvatarUrl(result.data.avatarUrl);
      form.reset({full_name: result.data.fullName});
    }
    setLoading(false);
  };
```

```ts
  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    const result = await saveProfile({fullName: values.full_name, avatarUrl});
    if (result.ok) {
      toast.success(t('user', 'profileUpdated'));
    } else {
      console.error('Error saving profile:', result.error);
      toast.error(result.error.message || t('user', 'profileErrorSaving'));
    }
    setSaving(false);
  };
```

- [ ] **Step 3: Verify compile + suite**

```bash
node scripts/enumerate_compiler_bailouts.mjs | grep -c ProfileSection; npm run typecheck && npm run test:run 2>&1 | tail -3
```

Expected: `0`; typecheck clean; suite green.

- [ ] **Step 4: Commit**

```bash
git add frontend/services/profileService.ts frontend/components/user/ProfileSection.tsx
git commit -m "refactor(frontend): extract ProfileSection handlers to profileService (canonical component)"
```

---

### Sweep batches — shared extraction recipe

Tasks 5–10 apply this recipe to their file lists. For each file:

1. **Inventory the bail sites**: run the enumerator, note each error in
   the file (`try/finally`, `throw`-in-`try`, value-block-in-`try`).
2. **Extract the IO core** of each offending handler into the domain
   service (`frontend/services/<domain>Service.ts` — extend the existing
   module if one exists: `aiSuggestionService`, `sectionExtractionService`,
   `extractionValueService`, `feedbackService`, `zoteroImportService`,
   `apiKeysService`, `hitlConfigService`, …; otherwise create one with the
   same header comment as `projectsService.ts`). The function returns
   `ErrorResult<T>` via `toResult`. Supabase/fetch calls relocate
   **verbatim**.
3. **Rewrite the handler straight-line** (Task 3/4 shape): pending flag →
   `await` service → branch on `result.ok` → toast/state → clear flag.
4. **Early-return audit** (per handler, write it in the commit message if
   non-trivial): every `return` inside the old `try` relied on `finally`
   for cleanup — the new shape must clear pending flags on ALL exit paths
   (prefer branches over returns, as in Task 4).
5. **Multi-step handlers** (e.g. `useExtractionData` with 6 throw sites):
   one service function per coherent IO unit — do NOT merge unrelated
   queries into one mega-function just to clear the file.
6. **Keep all memoization** (`useMemo`/`useCallback`/`memo()`) untouched.
7. **New service tests** only where the service function contains logic
   (mapping, fallbacks, multi-step sequencing) — follow the
   `projectsService.test.ts` mock pattern in `frontend/test/services/`.
   Pure relocations of a single query don't need a dedicated unit test
   (existing component/hook tests + E2E cover them).

**Per-batch verification (identical for Tasks 5–10):**

```bash
npx eslint <batch-files-or-dirs> && npm run typecheck && npm run test:run 2>&1 | tail -3
node scripts/enumerate_compiler_bailouts.mjs | tail -1
```

Expected: lint/typecheck/tests green; `BAILOUT FILES` strictly lower than
the previous batch (record per-batch counts in `/tmp/pr-notes.md`).

**Per-batch commit:**

```bash
git add -A frontend/services frontend/test/services <batch files>
git commit -m "refactor(frontend): extract <domain> handlers to services (compiler batch N/6)"
```

---

### Task 5: Batch 1/6 — articles components (6 files)

**Files (Modify):**
- `frontend/components/articles/AddArticleDialog.tsx`
- `frontend/components/articles/ArticleDetailDialog.tsx`
- `frontend/components/articles/ArticleFileUploadDialogNew.tsx`
- `frontend/components/articles/ArticleForm.tsx`
- `frontend/components/articles/ArticlesExportDialog.tsx`
- `frontend/components/articles/ArticlesList.tsx`
- Create/extend: `frontend/services/articlesService.ts` (new; uploads may
  also extend `articlesExportService.ts` where the logic already lives)

- [ ] **Step 1:** Apply the shared recipe to the 6 files.
- [ ] **Step 2:** Per-batch verification (commands above).
- [ ] **Step 3:** Per-batch commit (`compiler batch 1/6`).

---

### Task 6: Batch 2/6 — extraction components + dialogs (16 files)

**Files (Modify):**
- `frontend/components/extraction/ArticleExtractionTable.tsx`
- `frontend/components/extraction/ExtractionExportDialog.tsx`
- `frontend/components/extraction/ExtractionInterface.tsx`
- `frontend/components/extraction/FieldsManager.tsx`
- `frontend/components/extraction/FieldsManagerWithDragDrop.tsx`
- `frontend/components/extraction/InstanceCard.tsx`
- `frontend/components/extraction/SectionAccordion.tsx`
- `frontend/components/extraction/TemplateConfigEditor.tsx`
- `frontend/components/extraction/ai/AISuggestionHistoryPopover.tsx`
- `frontend/components/extraction/dialogs/AddFieldDialog.tsx`
- `frontend/components/extraction/dialogs/AddSectionDialog.tsx`
- `frontend/components/extraction/dialogs/CreateCustomTemplateDialog.tsx`
- `frontend/components/extraction/dialogs/EditFieldDialog.tsx`
- `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`
- `frontend/components/extraction/dialogs/RemoveSectionDialog.tsx`
- `frontend/components/extraction/hierarchy/RemoveModelDialog.tsx`
- Extend: `extractionInstanceService.ts`, `extractionValueService.ts`,
  `templateImportService.ts`, `sectionExtractionService.ts`,
  `aiSuggestionService.ts` (create `templateService.ts` only if no
  existing module fits)

- [ ] **Step 1:** Apply the shared recipe to the 16 files.
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Per-batch commit (`compiler batch 2/6`).

---

### Task 7: Batch 3/6 — extraction hooks (18 files)

**Files (Modify):**
- `frontend/hooks/extraction/ai/useAISuggestions.ts`
- `frontend/hooks/extraction/ai/useRunAIExtraction.ts`
- `frontend/hooks/extraction/colaboracao/useAllUserInstances.ts`
- `frontend/hooks/extraction/colaboracao/useOtherExtractions.ts`
- `frontend/hooks/extraction/useBatchAllModelsSectionsExtraction.ts` (try-family part only; its `++` oddball is Task 11)
- `frontend/hooks/extraction/useBatchSectionExtractionChunked.ts`
- `frontend/hooks/extraction/useExtractedValues.ts`
- `frontend/hooks/extraction/useExtractionData.ts`
- `frontend/hooks/extraction/useExtractionFormAIActions.ts`
- `frontend/hooks/extraction/useExtractionSession.ts`
- `frontend/hooks/extraction/useFieldManagement.ts`
- `frontend/hooks/extraction/useFinalizedExtractionRun.ts`
- `frontend/hooks/extraction/useFullAIExtraction.ts`
- `frontend/hooks/extraction/useGlobalTemplates.ts`
- `frontend/hooks/extraction/useModelExtraction.ts`
- `frontend/hooks/extraction/useModelManagement.ts`
- `frontend/hooks/extraction/useSectionExtraction.ts`
- `frontend/hooks/extraction/useTopLevelSectionsExtraction.ts`

These are the densest files (autosave/session timing contracts live in
their tests). Loader hooks keep public signatures (Task 3 template).
`useExtractedValues` has a dense vitest suite — run it after each file,
not only per batch:

```bash
npx vitest run frontend/test/hooks --silent 2>&1 | tail -3
```

- [ ] **Step 1:** Apply the shared recipe to the 18 files.
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Per-batch commit (`compiler batch 3/6`).

---

### Task 8: Batch 4/6 — QA / HITL / runs / project-settings (10 files)

**Files (Modify):**
- `frontend/components/hitl/HITLArticleTable.tsx`
- `frontend/components/project/settings/AdvancedSettingsSection.tsx`
- `frontend/components/project/settings/TeamMembersSection.tsx`
- `frontend/components/quality/QualityAssessmentConfiguration.tsx`
- `frontend/hooks/hitl/useHITLProjectTemplates.ts`
- `frontend/hooks/qa/useProjectQATemplate.ts`
- `frontend/hooks/qa/useQAAssessmentSession.ts`
- `frontend/hooks/qa/useQATemplate.ts`
- `frontend/hooks/runs/useAutoSaveProposals.ts`
- `frontend/hooks/shared/useComparisonPermissions.ts`
- Extend: `hitlConfigService.ts`; create `qaTemplateService.ts`,
  `projectSettingsService.ts` as needed

`useAutoSaveProposals` carries autosave timing contracts — its tests are
the gate, do not restructure its debounce/flush logic, only relocate IO.

- [ ] **Step 1:** Apply the shared recipe to the 10 files.
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Per-batch commit (`compiler batch 4/6`).

---

### Task 9: Batch 5/6 — user / auth / pages / navigation (14 files)

**Files (Modify):**
- `frontend/components/user/ApiKeysSection.tsx`
- `frontend/components/user/SecuritySection.tsx`
- `frontend/components/layout/SidebarHeader.tsx`
- `frontend/components/navigation/NotificationCenter.tsx`
- `frontend/pages/Auth.tsx`
- `frontend/pages/Dashboard.tsx`
- `frontend/pages/ExtractionFullScreen.tsx`
- `frontend/pages/ProjectView.tsx`
- `frontend/pages/QualityAssessmentFullScreen.tsx`
- `frontend/pages/ResetPassword.tsx`
- `frontend/hooks/useFeedback.ts`
- `frontend/hooks/useNavigation.ts`
- `frontend/hooks/useProjectMemberRole.ts`
- `frontend/hooks/useProjectSettings.ts`
- Extend: `apiKeysService.ts`, `feedbackService.ts`, `profileService.ts`
  (Task 4); create `authService.ts` for the Auth/ResetPassword/Security
  supabase.auth flows

Auth flows: relocate `supabase.auth.signInWithPassword` /
`signUp` / `resetPasswordForEmail` / `updateUser` calls verbatim into
`authService.ts`; session/redirect handling stays in the pages.

- [ ] **Step 1:** Apply the shared recipe to the 14 files.
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Per-batch commit (`compiler batch 5/6`).

---

### Task 10: Batch 6/6 — uploads / zotero / misc hooks (7 files)

**Files (Modify):**
- `frontend/hooks/useFileUpload.ts`
- `frontend/hooks/useMultiFileUpload.ts`
- `frontend/hooks/usePreserveScroll.ts`
- `frontend/hooks/useScreenCapture.ts`
- `frontend/hooks/useZoteroImport.ts`
- `frontend/hooks/useZoteroIntegration.ts`
- `frontend/hooks/zotero/useZoteroSyncStatus.ts`
- Extend: `zoteroImportService.ts`; create `fileUploadService.ts`
  (supabase.storage calls relocate verbatim)

`usePreserveScroll` and `useScreenCapture` use browser APIs, not network
IO — their try/finally still moves to a module function (same recipe; a
service is any non-compiled module function, the API it wraps doesn't
matter).

- [ ] **Step 1:** Apply the shared recipe to the 7 files.
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Per-batch commit (`compiler batch 6/6`).

---

### Task 11: Oddball fixes (8 files)

**Files (Modify/Delete):** listed per item.

- [ ] **Step 1: Delete `frontend/hooks/performance/useOptimizedCache.ts`**

Verify zero consumers first, then delete (also remove any test file):

```bash
rg -l "useOptimizedCache" frontend --glob '!**/useOptimizedCache*'
```

Expected: no output. Then `git rm frontend/hooks/performance/useOptimizedCache.ts`
(and its test if `rg --files frontend | rg useOptimizedCache` shows one).

- [ ] **Step 2: Props-destructuring fixes (2 files)**

`frontend/components/shared/comparison/EntitySelectorComparison.tsx` and
`frontend/components/shared/comparison/SingleInstanceComparison.tsx` —
error: "Inferred dependency was `props`, but the source dependencies were
[…, props.currentUser.userId, props.onValueUpdate]". Destructure ALL used
props at the top of the component so memo deps reference locals:

```ts
// before
export function SingleInstanceComparison(props: Props) {
  ... useMemo(..., [instance, props.onValueUpdate]) ...
// after
export function SingleInstanceComparison({onValueUpdate, currentUser, ...rest}: Props) {
  ... useMemo(..., [instance, onValueUpdate]) ...
```

Keep the manual deps lists otherwise IDENTICAL (PR A does not change memo
behavior).

- [ ] **Step 3: `++` captured in lambdas (2 files)**

`frontend/components/shared/comparison/ComparisonTable.tsx` and
`frontend/hooks/extraction/useBatchAllModelsSectionsExtraction.ts` —
error: "Handle UpdateExpression to variables captured within lambdas".
Replace the mutated counter with accumulation the compiler can model:

```ts
// before
let matches = 0;
rows.forEach((r) => { if (r.same) matches++; });
// after
const matches = rows.filter((r) => r.same).length;
```

(Adapt to the actual loop shape found in each file; the invariant is: no
`x++`/`x--` on a closure-captured variable inside a lambda.)

- [ ] **Step 4: Non-reorderable JSX expression (2 files)**

`frontend/components/shared/list/FilterNumericRangeField.tsx` and
`frontend/components/ui/file-drop-zone.tsx` — hoist the flagged
expression out of the JSX into a named const above the `return`:

```tsx
// before
<Foo value={cond ? heavyExpr(a) : other.b!} />
// after
const fooValue = cond ? heavyExpr(a) : other.b!;
<Foo value={fooValue} />
```

The enumerator names the exact expression and line.

- [ ] **Step 5: `resizable-panel.tsx` Invariant**

`frontend/components/ui/resizable-panel.tsx` — compiler bug-class error
(`InferMutationAliasingEffects`). Attempt: simplify the flagged
assignment flow (usually a conditional write to a ref/local the compiler
can't alias-track). Timebox ~30 min. If it does not clear: add the
escape hatch as the FIRST line of the component body, with the reason:

```ts
export function ResizablePanel(...) {
  'use no memo'; // kept: compiler Invariant (InferMutationAliasingEffects), babel-plugin-react-compiler v1 — re-test on upgrade
```

- [ ] **Step 6: Verify zero bailouts**

```bash
node scripts/enumerate_compiler_bailouts.mjs
```

Expected: `BAILOUT FILES: 0 of 47X` and exit 0. Any `'use no memo'` files
(budget ≤ 2) are listed by:

```bash
rg -l "use no memo" frontend
```

- [ ] **Step 7: Run full verification + commit**

```bash
npm run lint && npm run typecheck && npm run test:run 2>&1 | tail -3
git add -A
git commit -m "refactor(frontend): fix remaining compiler oddballs, reach zero bailouts"
```

---

### Task 12: Flip `panicThreshold: 'all_errors'` + signposting

**Files:**
- Modify: `vite.shared-plugins.ts`
- Modify: `vite.config.ts:47-50` (stale comment)
- Modify: `.claude/rules/frontend.md`

- [ ] **Step 1: Flip the shared preset**

In `vite.shared-plugins.ts`:

```ts
export function reactWithCompiler(): PluginOption[] {
  // panicThreshold 'all_errors': any component/hook the compiler cannot
  // compile fails the build AND vitest (shared preset). Escape hatch for
  // genuinely uncompilable files: 'use no memo' + a // kept: comment.
  // Full-tree listing: node scripts/enumerate_compiler_bailouts.mjs
  return [react(), babel({presets: [reactCompilerPreset({panicThreshold: 'all_errors'})]})];
}
```

- [ ] **Step 2: Update the stale enumeration comment in `vite.config.ts`**

Replace the comment block above `plugins: reactWithCompiler(),` (lines
47–50) with:

```ts
  // React + React Compiler — shared with vitest.config.ts so the test
  // pipeline can never drift from the app pipeline. panicThreshold
  // 'all_errors' is permanent: a non-compiling component fails the build.
  // See scripts/enumerate_compiler_bailouts.mjs for a full-tree listing.
```

- [ ] **Step 3: Add the React Compiler section to `.claude/rules/frontend.md`**

Append:

```md
## React Compiler

- The build runs `babel-plugin-react-compiler` with `panicThreshold:
  'all_errors'` (`vite.shared-plugins.ts`): a component or hook the
  compiler cannot compile fails the build and vitest. Don't write
  `try/finally` (or `throw` inside `try`) in component/hook bodies —
  move IO into a `frontend/services/` function returning
  `ErrorResult<T>` (`frontend/lib/error-utils.ts:toResult`); exported
  service functions never throw across the boundary and never toast.
- Last-resort opt-out for a file the compiler genuinely cannot handle:
  `'use no memo'` directive plus a `// kept:` comment with the reason.
- `scripts/enumerate_compiler_bailouts.mjs` lists every non-compiling
  file in one pass (useful before compiler upgrades).
```

- [ ] **Step 4: Prove the gate works (negative test)**

Temporarily add `try { console.log(1); } finally { console.log(2); }`
inside the `ProfileSection` component body
(`frontend/components/user/ProfileSection.tsx`), then:

```bash
npm run build 2>&1 | grep -c "TryStatement"
```

Expected: ≥1 — the build FAILS with the Todo error (the panic threshold
is live). Revert the probe:
`git checkout -- frontend/components/user/ProfileSection.tsx`. (vitest
shares the preset via `vite.shared-plugins.ts`, so the same panic
applies there whenever a test imports a non-compiling file.)

- [ ] **Step 5: Coverage proof + full gates**

```bash
node scripts/check_compiler_coverage.mjs && npm run lint && npm run typecheck && npm run test:run 2>&1 | tail -3 && npm run build
```

Expected: coverage PASS; all gates green; build green (record bundle
delta vs dev in `/tmp/pr-notes.md`).

- [ ] **Step 6: Commit**

```bash
git add vite.shared-plugins.ts vite.config.ts .claude/rules/frontend.md
git commit -m "feat(build): make panicThreshold all_errors permanent — zero-bailout CI invariant"
```

---

### Task 13: PR A — E2E, smoke, ship

- [ ] **Step 1: Full local E2E**

```bash
npm run test:e2e:local
```

Expected: dev baseline profile — no NEW failures or skips vs dev. (Local
Supabase must be up: `make start`; `make db-fresh` if fixtures are stale.)

- [ ] **Step 2: Manual smoke (`teste@prumo.local` / `Senha123`) — handler emphasis**

On the local preview, exercising error paths and pending flags:

- Profile: load, save, save with backend stopped (failure toast, button re-enables)
- Security + API keys sections: save/validate flows
- Articles: add dialog, file upload (multi-file), export, list refresh
- Extraction: open run, type (latency), autosave badge cycles, AI suggestion fire + history popover, field/section dialogs open–submit–cancel
- QA: open assessment, publish flow
- Auth: logout, login, reset-password request
- Zotero: import status panel
- Dashboard: create project
- Notification center + sidebar navigation

Every failure toast must appear once (not zero, not duplicated), every
pending spinner must clear.

- [ ] **Step 3: Push and open PR A**

```bash
git branch -m worktree-react-compiler-zero-bailouts feat/compiler-zero-bailouts
git push -u origin feat/compiler-zero-bailouts
gh pr create --base dev --label needs-review --title "refactor(frontend): zero React Compiler bailouts — service extraction + all_errors gate"
gh pr merge feat/compiler-zero-bailouts --auto --squash
```

PR body: spec link, bailout count 80→0, `'use no memo'` list (≤2),
services created/extended, bundle delta, gate checklist from
`/tmp/pr-notes.md`. (If `gh` times out on DNS, use the documented
`curl --resolve api.github.com:443:140.82.121.6` workaround.)

---

## PR B — memo removal sweep (stacked on A)

### Task 14: Branch + triage report

- [ ] **Step 1: Cut the branch**

```bash
git checkout -b feat/compiler-memo-unlock feat/compiler-zero-bailouts
```

(If PR A has already squash-merged: `git fetch origin && git checkout -b
feat/compiler-memo-unlock origin/dev` instead. If A merges while B is in
flight: `git rebase --onto origin/dev feat/compiler-zero-bailouts
feat/compiler-memo-unlock` before pushing.)

- [ ] **Step 2: Regenerate the memo inventory**

```bash
grep -rEn "useMemo\(|useCallback\(|React\.memo\(|[^a-zA-Z.]memo\(" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|frontend/test/" > /tmp/memo-inventory.txt; wc -l /tmp/memo-inventory.txt
```

Expected: ~226 sites (210 newly unlocked + 16 documented exceptions).

- [ ] **Step 3: One-off exhaustive-deps report**

```js
// eslint.deps-report.config.js — one-off triage report, DELETE after this task
import base from './eslint.config.js';

export default [
  ...base,
  {
    files: ['frontend/**/*.{ts,tsx}'],
    rules: { 'react-hooks/exhaustive-deps': 'warn' },
  },
];
```

```bash
npx eslint frontend -c eslint.deps-report.config.js 2>&1 | tee /tmp/deps-report.txt | grep -c "exhaustive-deps"; rm eslint.deps-report.config.js
```

Flagged sites (missing OR unnecessary deps) = audit cases; unflagged =
safe mechanical removals.

---

### Removal rules (Tasks 15–17) — the #268 rule set

**Rule A — unflagged `useMemo` → inline:**

```ts
// before
const reviewers = useMemo(() => reviewersQuery.data ?? [], [reviewersQuery.data]);
// after
const reviewers = reviewersQuery.data ?? [];
```

**Rule B — unflagged `useCallback` → plain function:**

```ts
// before
const scrollPrev = useCallback(() => { api?.scrollPrev(); }, [api]);
// after
const scrollPrev = () => { api?.scrollPrev(); };
```

**Rule C — plain `memo()` → unwrap** (allowed everywhere the parent now
compiles — confirm the parent is NOT in `rg -l "use no memo" frontend`):

```ts
// before
export const FieldsHeader = memo(function FieldsHeader({ a, b }: Props) { ... });
// after
export function FieldsHeader({ a, b }: Props) { ... }
```

**Rule D — flagged "missing dependency" (deps intentionally narrower):**
if the callback is a latest-props handler, convert to `useEffectEvent`
(React 19.2 stable); otherwise KEEP with
`// kept: deps intentionally narrower — removal changes effect cadence (zero-bailouts spec)`.

**Rule E — flagged "unnecessary dependency" (deps broader):** prefer a
pure derivation from the dep itself; if non-trivial, KEEP with
`// kept: extra dep forces recompute of impure read (zero-bailouts spec)`.

**Rule F — custom comparators stay** (`memo(X, arePropsEqual)`):
`FieldInput.tsx`, `ExtractionFormView.tsx`, and any others — ensure the
`// kept: custom comparator` comment exists.

**Rule G — post-edit transform audit (the #268 "compiled-no-memo"
lesson):** after each file's edits, confirm the file still appears
compiled (no entry in the enumerator output, which now panics on
everything) AND its tests pass. If removing a memo in a *compiled* file
still regresses a timing-sensitive test, the site is load-bearing —
restore it WITH a `// kept:` comment.

**Per-batch verification (Tasks 15–17):**

```bash
npx eslint <batch-dirs> && npm run typecheck && npm run test:run 2>&1 | tail -3
node scripts/enumerate_compiler_bailouts.mjs | tail -1
```

Expected: all green; `BAILOUT FILES: 0` (removal must never reintroduce a
bailout).

### Task 15: Removal batch 1/3 — components (articles, extraction, QA/HITL, shared, user)

- [ ] **Step 1:** Apply rules A–G to all memo sites in the 37 swept
  component files (Tasks 4–6, 8–9 component lists + oddball comparison
  components).
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Commit: `perf(frontend): remove unlocked manual memoization — components (1/3)`

### Task 16: Removal batch 2/3 — hooks

- [ ] **Step 1:** Apply rules A–G to all memo sites in the 36 swept hook
  files (Tasks 3, 7, 8, 10 hook lists). Extra care: hooks own the
  autosave/session timing contracts — run `npx vitest run
  frontend/test/hooks` after each dense file (`useExtractedValues`,
  `useAutoSaveProposals`, `useExtractionSession`).
- [ ] **Step 2:** Per-batch verification.
- [ ] **Step 3:** Commit: `perf(frontend): remove unlocked manual memoization — hooks (2/3)`

### Task 17: Removal batch 3/3 — pages + kept-list audit

- [ ] **Step 1:** Apply rules A–G to the 6 page files.
- [ ] **Step 2: Final kept-memo audit**

```bash
grep -rEn "useMemo\(|useCallback\(|React\.memo\(|[^a-zA-Z.]memo\(" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|frontend/test/" | wc -l
grep -rEn "useMemo\(|useCallback\(|React\.memo\(|[^a-zA-Z.]memo\(" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|frontend/test/" | grep -vc "kept:" || true
```

Expected: total ≈16; second command ≈0 — EVERY surviving site has a
`// kept:` comment on its line or the line above (add any missing, using
the Rule D/E/F texts).

- [ ] **Step 3:** Per-batch verification.
- [ ] **Step 4:** Commit: `perf(frontend): remove unlocked manual memoization — pages + kept-list audit (3/3)`

---

### Task 18: PR B — gates, smoke, ship

- [ ] **Step 1: Full gates + E2E**

```bash
npm run lint && npm run typecheck && npm run test:run 2>&1 | tail -3 && npm run build && npm run test:e2e:local
```

Expected: all green at dev baseline; bundle delta recorded.

- [ ] **Step 2: Manual smoke — render-performance emphasis**

`teste@prumo.local` on the local preview: ExtractionFullScreen typing
latency (the hottest path), autosave badge cycles, PDF panel resize,
multi-user comparison views, QA full screen publish, dialogs open/close
reset, sidebar/skeletons. Watch for the classic post-removal bug classes:
infinite render loops (fail loudly) and effect-cadence changes (autosave
firing more/less often than the badge shows).

- [ ] **Step 3: Push and open PR B**

```bash
git push -u origin feat/compiler-memo-unlock
gh pr create --base dev --label needs-review --title "perf(frontend): remove manual memoization unlocked by zero bailouts"
gh pr merge feat/compiler-memo-unlock --auto --squash
```

PR body: spec link, sites removed (210 → kept ≈16, all commented),
triage report summary (flagged vs unflagged counts), gate checklist.
Auto-merge waits for PR A; nudge with `gh pr update-branch` if dev moves.

---

## Execution notes

- **Order is strict** within each PR; Tasks 5–10 are parallelizable per
  batch ONLY if executors coordinate on shared service files (batches 2
  and 3 both extend extraction services — safer sequential).
- The local stack must be up for E2E (`make start`).
- If a batch reveals a handler whose extraction is genuinely unsafe to
  do mechanically (e.g. interleaved state machines in
  `useExtractionSession`), prefer extracting only the IO leaf calls and
  leaving orchestration in the hook — the recipe's goal is zero
  try-family syntax in compiled code, not maximal extraction.
- Worst-case fallback for any single file: `'use no memo'` + `// kept:`
  comment (budget ≤2 total, listed in the PR body) — never block the
  sweep on one stubborn file.
