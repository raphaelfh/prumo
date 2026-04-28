# PDF Viewer — Phase 0: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the PDF viewer stack to a security-patched, locally-served, ESM-aligned baseline and scaffold an empty `@prumo/pdf-viewer` module that subsequent phase plans will fill in.

**Architecture:** This plan does not introduce new architecture. It (a) aligns `pdfjs-dist` (3.4 → 5.7) with `react-pdf` (10.1 → 10.4) — closing CVE-2024-4367 — (b) migrates the PDF.js worker off the unpkg CDN to a locally-bundled Vite asset, (c) creates an empty but tested `frontend/pdf-viewer/` module skeleton with a `@prumo/pdf-viewer` path alias, and (d) drops three unused `@react-pdf-viewer/*` packages whose upstream is archived.

**Tech Stack:** Vite 8, Vitest 4, TypeScript 5.8 strict, React 18.3, pdfjs-dist 5.7+, react-pdf 10.4+

**Out of scope:** New abstractions (engine interface, store factory, plugin system). Those go in Plan 2 (Headless Core) and later.

**Predecessors:** None (first plan in the PDF viewer refactor).

**Successors:** Plan 2 — Headless Core (types + store factory).

---

## File Structure

### Files created

| Path | Purpose |
|---|---|
| `frontend/pdf-viewer/index.ts` | Module entry barrel |
| `frontend/pdf-viewer/core/index.ts` | Core sub-module barrel (placeholder) |
| `frontend/pdf-viewer/core/types.ts` | Reserved for Plan 2 — placeholder export only |
| `frontend/pdf-viewer/README.md` | Module purpose + plan index |
| `frontend/pdf-viewer/__tests__/scaffolding.test.ts` | Sanity test (module is importable) |
| `frontend/lib/pdf-worker.ts` | Local worker URL helper (replaces unpkg CDN) |

### Files modified

| Path | Change |
|---|---|
| `package.json` | `pdfjs-dist` → `^5.7.0`; `react-pdf` → `^10.4.1`; remove `@react-pdf-viewer/*` |
| `frontend/lib/pdf-config.ts` | Use local worker; align options with v5; drop unpkg URLs |
| `tsconfig.json` | Add `@prumo/pdf-viewer` path alias |
| `tsconfig.app.json` | Add `@prumo/pdf-viewer` path alias |
| `vitest.config.ts` | Add `@prumo/pdf-viewer` resolve alias |

### Files removed

None in this plan. Removal of legacy viewer code (`frontend/components/PDFViewer/*`, `frontend/stores/usePDFStore.ts`, `frontend/services/pdfSearchService.ts`, `frontend/hooks/usePDFPerformance.ts`) is in Plan 8.

---

## Task 1: Branch hygiene + version inventory

**Files:** None modified — read-only inspection.

- [ ] **Step 1: Verify worktree is clean**

```bash
git status
```

Expected: working tree clean.

- [ ] **Step 2: Inventory current PDF dependency versions**

```bash
node -p "JSON.stringify({pdfjs: require('./package.json').dependencies['pdfjs-dist'], reactPdf: require('./package.json').dependencies['react-pdf'], embedCore: require('./package.json').dependencies['@react-pdf-viewer/core'], embedLayout: require('./package.json').dependencies['@react-pdf-viewer/default-layout'], embedSearch: require('./package.json').dependencies['@react-pdf-viewer/search']}, null, 2)"
```

Expected:
```json
{
  "pdfjs": "^3.4.120",
  "reactPdf": "^10.1.0",
  "embedCore": "^3.12.0",
  "embedLayout": "^3.12.0",
  "embedSearch": "^3.12.0"
}
```

- [ ] **Step 3: Confirm `@react-pdf-viewer/*` is not imported anywhere**

```bash
grep -rn "@react-pdf-viewer" frontend --include="*.ts" --include="*.tsx" || echo "no matches"
```

Expected: `no matches`.

- [ ] **Step 4: List the four `pdf-config` consumers that must keep working**

```bash
grep -rln "@/lib/pdf-config" frontend
```

Expected:
```
frontend/config/app.config.ts
frontend/components/PDFViewer/core/PDFViewerCore.tsx
frontend/components/PDFViewer/core/PDFCanvas.tsx
frontend/hooks/usePDFPerformance.ts
```

No commit — verification only.

---

## Task 2: Create empty `frontend/pdf-viewer/` module skeleton

**Files:**
- Create: `frontend/pdf-viewer/index.ts`
- Create: `frontend/pdf-viewer/core/index.ts`
- Create: `frontend/pdf-viewer/core/types.ts`
- Create: `frontend/pdf-viewer/README.md`

The skeleton is created before the path alias (Task 3) so the alias resolves to an existing file.

- [ ] **Step 1: Create `frontend/pdf-viewer/core/types.ts`**

```ts
// Reserved for Plan 2 — Headless Core types (PDFSource, PDFEngine, ViewerState, Citation, ...).
// This file exists so the module is importable and the build passes during Phase 0.
export const PDF_VIEWER_MODULE_VERSION = '0.0.0-phase0' as const;
```

- [ ] **Step 2: Create `frontend/pdf-viewer/core/index.ts`**

```ts
export {PDF_VIEWER_MODULE_VERSION} from './types';
```

- [ ] **Step 3: Create `frontend/pdf-viewer/index.ts`**

```ts
export {PDF_VIEWER_MODULE_VERSION} from './core';
```

- [ ] **Step 4: Create `frontend/pdf-viewer/README.md`**

````markdown
# @prumo/pdf-viewer

Modular, headless PDF viewer for the Prumo research platform.

## Status

**Phase 0** — Foundation only. The module currently exposes only a version constant.

The full refactor is split across the following plans (one per subsystem):

| Phase | Plan filename | Title |
|---|---|---|
| 0 | `2026-04-28-pdf-viewer-phase0-foundation.md` | Foundation: stack upgrade + scaffolding |
| 1a | `2026-XX-XX-pdf-viewer-phase1a-core-types-store.md` | Headless core: types + store factory |
| 1b | `2026-XX-XX-pdf-viewer-phase1b-pdfjs-engine.md` | PDF.js engine + multi-instance demo |
| 2a | `2026-XX-XX-pdf-viewer-phase2a-plugins-primitives.md` | Plugin system + compound primitives |
| 2b | `2026-XX-XX-pdf-viewer-phase2b-plugin-migration.md` | Plugin migration (zoom/search/nav/virt/thumbnails) |
| 3 | `2026-XX-XX-pdf-viewer-phase3-citation-api.md` | Citation API + ExtractionEvidence integration |
| 4 | `2026-XX-XX-pdf-viewer-phase4-annotations.md` | W3C annotations + Recogito (blocked on schema coordination) |
| 5 | `2026-XX-XX-pdf-viewer-phase5-reader-view-cleanup.md` | Reader view + a11y + legacy cleanup |

Filenames marked `XX-XX` are placeholder dates — set when each plan is written.

## Architecture (target — end of Phase 5)

```
@prumo/pdf-viewer/
├── core/             — IPDFEngine interface, store factory, primitives
├── engines/pdfjs/    — concrete PDF.js v5 implementation
├── engines/pdfium/   — (reserved) future PDFium-WASM implementation
├── plugins/          — toolbar, search, zoom, nav, virtualization,
│                       thumbnails, annotations, ai-citations, region-capture
└── ui/               — opt-in shadcn-style toolbar components
```

Engine swappable behind `IPDFEngine`. State per-instance (Zustand factory + Context). Plugins tree-shakable.

## Importing

```ts
import {PDF_VIEWER_MODULE_VERSION} from '@prumo/pdf-viewer';
```

This README will expand with consumer-facing API documentation as Phase 1+ ships.
````

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer/
git commit -m "feat(pdf-viewer): scaffold empty module skeleton

Creates frontend/pdf-viewer/ with placeholder exports.
Real types and primitives arrive in Plan 2 (Headless Core)."
```

---

## Task 3: Add `@prumo/pdf-viewer` path alias to TypeScript and Vitest

**Files:**
- Modify: `tsconfig.json`
- Modify: `tsconfig.app.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update `tsconfig.json` paths**

Replace the `paths` block:
```json
"paths": {
  "@/*": [
    "./frontend/*"
  ]
},
```
with:
```json
"paths": {
  "@/*": [
    "./frontend/*"
  ],
  "@prumo/pdf-viewer": [
    "./frontend/pdf-viewer/index.ts"
  ],
  "@prumo/pdf-viewer/*": [
    "./frontend/pdf-viewer/*"
  ]
},
```

- [ ] **Step 2: Update `tsconfig.app.json` paths identically**

Replace:
```json
"paths": {
  "@/*": [
    "./frontend/*"
  ]
}
```
with:
```json
"paths": {
  "@/*": [
    "./frontend/*"
  ],
  "@prumo/pdf-viewer": [
    "./frontend/pdf-viewer/index.ts"
  ],
  "@prumo/pdf-viewer/*": [
    "./frontend/pdf-viewer/*"
  ]
}
```

- [ ] **Step 3: Update `vitest.config.ts` resolve.alias**

Replace:
```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './frontend'),
  },
},
```
with:
```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './frontend'),
    '@prumo/pdf-viewer': path.resolve(__dirname, './frontend/pdf-viewer/index.ts'),
  },
},
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json tsconfig.app.json vitest.config.ts
git commit -m "chore(pdf-viewer): add @prumo/pdf-viewer path alias"
```

---

## Task 4: Sanity test that `@prumo/pdf-viewer` is importable

**Files:**
- Create: `frontend/pdf-viewer/__tests__/scaffolding.test.ts`

- [ ] **Step 1: Write the test**

Create `frontend/pdf-viewer/__tests__/scaffolding.test.ts`:

```ts
import {describe, expect, it} from 'vitest';

describe('@prumo/pdf-viewer scaffolding', () => {
  it('exposes a version constant from the package root', async () => {
    const mod = await import('@prumo/pdf-viewer');
    expect(mod.PDF_VIEWER_MODULE_VERSION).toBe('0.0.0-phase0');
  });

  it('exposes the same constant from the core barrel via relative import', async () => {
    const mod = await import('../core');
    expect(mod.PDF_VIEWER_MODULE_VERSION).toBe('0.0.0-phase0');
  });
});
```

The second test uses a relative import on purpose: Vitest's bare-package alias is the contract that matters; deep aliases (`@prumo/pdf-viewer/core`) are out of scope for Phase 0.

- [ ] **Step 2: Run the test**

```bash
npx vitest run frontend/pdf-viewer/__tests__/scaffolding.test.ts
```

Expected: 2 tests passing.

If the first test fails with `Cannot find module '@prumo/pdf-viewer'`, re-verify Task 3 Step 3 (vitest alias).

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/__tests__/scaffolding.test.ts
git commit -m "test(pdf-viewer): add scaffolding sanity test"
```

---

## Task 5: Upgrade `pdfjs-dist` to 5.7+ and align `react-pdf` to 10.4+

**Files:**
- Modify: `package.json`

This task closes CVE-2024-4367 (CVSS 8.8 — arbitrary JS execution in pdf.js < 4.2.67) and aligns `react-pdf` v10 with its declared `pdfjs-dist` v5 peer.

- [ ] **Step 1: Update version pins in `package.json`**

Change:
```json
"pdfjs-dist": "^3.4.120",
```
to:
```json
"pdfjs-dist": "^5.7.0",
```

And change:
```json
"react-pdf": "^10.1.0",
```
to:
```json
"react-pdf": "^10.4.1",
```

- [ ] **Step 2: Reinstall dependencies**

```bash
npm install
```

Peer-dep warnings are acceptable; outright errors are not.

- [ ] **Step 3: Verify resolved versions**

```bash
node -p "require('pdfjs-dist/package.json').version" && node -p "require('react-pdf/package.json').version"
```

Expected: pdfjs-dist `5.7.x`; react-pdf `10.4.x`.

- [ ] **Step 4: Run unit tests to detect breakage**

```bash
npm run test:run
```

Expected: green. If something breaks, capture the error message before fixing — it informs Tasks 7 (config migration). Common breakages and resolutions:

- `Cannot read properties of undefined (reading 'GlobalWorkerOptions')` → import path changed; addressed in Task 7
- `pdfjs.version is undefined` → resolved in Task 7 by removing the `pdfjs.version` interpolation in `pdf-config.ts`
- A test that imports a removed pdfjs internal → patch the test to import from the new location, fix in this task

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): upgrade pdfjs-dist to ^5.7.0 and react-pdf to ^10.4.1

Closes CVE-2024-4367 (pdf.js < 4.2.67 arbitrary JS execution).
Aligns react-pdf 10 with its declared pdfjs-dist 5 peer."
```

---

## Task 6: Create local worker URL helper

**Files:**
- Create: `frontend/lib/pdf-worker.ts`

Replaces the unpkg CDN worker URL with a Vite-bundled local asset.

- [ ] **Step 1: Create the helper**

Create `frontend/lib/pdf-worker.ts`:

```ts
/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Local URL of the PDF.js worker script, served by Vite.
 * Replaces the prior unpkg CDN URL — eliminates a third-party runtime dependency.
 */
export const PDF_WORKER_SRC = workerUrl;
```

The `?url` suffix is a Vite asset URL import — Vite copies the file into the build output and returns its hashed URL. The triple-slash directive declares the `?url` query type if `frontend/vite-env.d.ts` doesn't already.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/pdf-worker.ts
git commit -m "chore(pdf-viewer): add local worker URL helper"
```

---

## Task 7: Migrate `pdf-config.ts` to use the local worker and v5-aligned options

**Files:**
- Modify: `frontend/lib/pdf-config.ts` (lines 1–23)

- [ ] **Step 1: Replace the worker setup and `PDF_OPTIONS`**

In `frontend/lib/pdf-config.ts`, replace lines 1–23 (everything from `import {pdfjs} from 'react-pdf';` through the closing `};` of `PDF_OPTIONS`) with:

```ts
import {pdfjs} from 'react-pdf';
import {PDF_WORKER_SRC} from '@/lib/pdf-worker';

// Configure PDF.js worker — served locally by Vite (was unpkg CDN previously).
pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

export const PDF_OPTIONS = {
  // cMaps and standard fonts: PDF.js v5 falls back to defaults when these are
  // unset. The research-paper PDFs we ingest are Latin-script with standard
  // fonts; defaults are adequate. If non-Latin (CJK, Arabic) PDFs surface
  // missing-glyph artifacts, follow up with local cMap/font serving.

  // Security hardening for untrusted PDFs.
  // Keeps scripting/eval disabled to reduce attack surface.
  isEvalSupported: false,
  enableScripting: false,

  // Performance
  enableXfa: false,
  disableAutoFetch: false,
  disableStream: false,
  disableRange: false,

  // Memory management
  maxImageSize: 16777216,
  cacheSize: 100,
  useOnlyCssZoom: true,
};
```

The lines below `PDF_OPTIONS` (`LARGE_PDF_THRESHOLD`, `PERFORMANCE_CONFIG`, `CONTINUOUS_SCROLL_CONFIG`) stay as-is — they will be removed in Plan 8 along with the legacy viewer.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: exit 0.

- [ ] **Step 3: Run unit tests**

```bash
npm run test:run
```

Expected: green.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

In the browser:
1. Navigate to a project with at least one article that has a PDF.
2. Open the extraction view; toggle the PDF panel open.
3. The PDF must render.
4. In DevTools → Network, confirm **zero requests to `unpkg.com`**.
5. Confirm the worker request resolves to a `localhost:5173/...` URL.

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/pdf-config.ts
git commit -m "chore(pdf-viewer): serve worker locally instead of unpkg CDN

Removes runtime dependency on unpkg.com. Worker is now bundled by Vite
via the pdf-worker helper. cMaps and standard fonts fall back to PDF.js
defaults (adequate for Latin-script research papers; non-Latin support
can be added if missing-glyph artifacts surface)."
```

---

## Task 8: Verify existing PDF viewer still works after upgrade

**Files:** None modified — verification only.

- [ ] **Step 1: Run all unit tests**

```bash
npm run test:run
```

Expected: green.

- [ ] **Step 2: Run the local e2e suite**

```bash
npm run test:e2e:local
```

Expected: green. If `pdf-collapsed-default.ui.e2e.ts` fails because of the upgrade, fix the regression here before moving on.

- [ ] **Step 3: Manual full-flow smoke test**

```bash
npm run dev
```

1. Open a project with articles that have PDFs.
2. Open the Extraction Full Screen page for one article.
3. Toggle the PDF panel open.
4. Verify: PDF renders; page nav works (prev/next + page input); zoom works (in/out + presets); search works (open panel, type a query, navigate matches); continuous scroll works.
5. Close the article and open a different one — the new PDF must replace the old cleanly with no stale state visible.

Stop the dev server.

- [ ] **Step 4: Document any regressions found and fix in this task**

If anything is broken, fix it in this task as additional commits before proceeding to Task 9. Phase 0 must end on a green baseline.

- [ ] **Step 5: No commit needed if no regressions; otherwise commit fixes with**

```bash
git commit -m "fix(pdf-viewer): <describe regression> after pdfjs v5 upgrade"
```

---

## Task 9: Remove unused `@react-pdf-viewer/*` dependencies

**Files:**
- Modify: `package.json`

These three packages are not imported (verified in Task 1, Step 3). Upstream was archived in March 2026 and shipped under a commercial license.

- [ ] **Step 1: Uninstall the three packages**

```bash
npm uninstall @react-pdf-viewer/core @react-pdf-viewer/default-layout @react-pdf-viewer/search
```

`package.json` should drop the three lines.

- [ ] **Step 2: Re-verify no source file references them**

```bash
grep -rn "@react-pdf-viewer" frontend src 2>/dev/null || echo "no matches"
```

Expected: `no matches`.

- [ ] **Step 3: Run unit tests**

```bash
npm run test:run
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): remove unused @react-pdf-viewer/* packages

These packages were declared but never imported. The upstream project
was archived in March 2026 and shipped under a commercial license."
```

---

## Task 10: Final integration verification

**Files:** None — verification only.

- [ ] **Step 1: Run a production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Verify the bundle is free of stale unpkg references**

```bash
grep -r "unpkg" dist/ 2>/dev/null || echo "no unpkg in bundle"
```

Expected: `no unpkg in bundle`. If `unpkg` appears, re-check Task 7 — the legacy `pdf-config.ts` worker URL was likely missed.

- [ ] **Step 3: Verify the worker is locally bundled**

```bash
ls dist/assets/ | grep -iE "pdf.*worker"
```

Expected: at least one filename matching `pdf.worker.<hash>.mjs` (or similar). Confirms Vite bundled the worker.

- [ ] **Step 4: Final test pass**

```bash
npm run test:run && npm run test:e2e:local
```

Expected: all green.

- [ ] **Step 5: Inspect commit history**

```bash
git log --oneline | head -10
```

Verify recent commits cover (in some order): scaffold module, add path alias, scaffolding test, upgrade deps, worker helper, migrate config, remove unused deps. Branch is clean and mergeable.

- [ ] **Step 6: Hand off**

Open a PR (or push for review). This plan does not prescribe merge — escalate to the human reviewer with the branch ready.

---

## Self-review checklist

After all tasks complete, verify:

- [ ] `node -p "require('pdfjs-dist/package.json').version"` returns `5.7.x`
- [ ] `node -p "require('react-pdf/package.json').version"` returns `10.4.x`
- [ ] `@react-pdf-viewer/*` packages are gone from `package.json` and `node_modules`
- [ ] No file under `frontend/` (or built `dist/`) imports from `unpkg.com`
- [ ] The PDF worker is served locally (visible in dev `Network` tab as `localhost:...`)
- [ ] The legacy `frontend/components/PDFViewer/` still renders PDFs in dev
- [ ] `frontend/pdf-viewer/__tests__/scaffolding.test.ts` passes
- [ ] `@prumo/pdf-viewer` resolves at both type-check time and test-run time
- [ ] `npm run build` succeeds
- [ ] `npm run test:run && npm run test:e2e:local` is green

---

## Out of scope for this plan (handed to subsequent plans)

- `IPDFEngine` interface and any abstraction over PDF.js → **Plan 2** (Headless Core)
- Per-instance store factory + Context → **Plan 2**
- `<ViewerProvider>`, `<Viewer.Root>`, layered primitives → **Plan 4** (Plugin System + Primitives)
- Replacing `pdfSearchService` with PDF.js `PDFFindController` → **Plan 5** (Plugin Migration)
- TanStack Virtual virtualization → **Plan 5**
- Removing legacy `usePDFStore`, `usePDFPerformance`, `pdfSearchService`, `frontend/components/PDFViewer/` → **Plan 8** (Cleanup)
- OpenDataLoader-PDF backend pipeline → **Plan 6** (Citation API)
- W3C annotations table + Recogito → **Plan 7** (blocked on `claude/strange-wiles-a189ef` schema coordination)
