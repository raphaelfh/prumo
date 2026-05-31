---
status: draft
last_reviewed: 2026-05-30
owner: '@raphaelfh'
---

# User-Facing Vocabulary for the HITL "Run" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the internal HITL "Run" entity-noun from appearing in user-facing copy, replacing it with researcher-facing vocabulary (assessment / AI extraction / article-anchored phrasing), and lock it with a regression guard.

**Architecture:** Pure frontend copy change — edit 7 string values across two copy modules plus one hardcoded toast literal. No backend, DB, API, or internal rename. A new Vitest guard test asserts the new wording and fails if the plural entity-noun "Runs" ever re-enters any copy value. A note in the canonical architecture doc teaches future devs the rule.

**Tech Stack:** TypeScript (strict), React 18, Vitest 4 (jsdom), the in-house copy module at `frontend/lib/copy/`.

**Spec:** [`docs/superpowers/specs/2026-05-30-run-user-facing-vocabulary-design.md`](../specs/2026-05-30-run-user-facing-vocabulary-design.md)

**Branch / worktree:** work happens in the current worktree (`claude/keen-archimedes-e4e843`). All commands run from the **repo root** (`vitest`/`eslint` config lives there, not in `frontend/`).

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `frontend/lib/copy/consensus.ts` | Consensus-settings copy. Holds the shared banner. | Modify (2 values) |
| `frontend/lib/copy/extraction.ts` | Extraction + AI-panel copy. | Modify (5 values) |
| `frontend/pages/QualityAssessmentFullScreen.tsx` | QA assessment page; finalize toast is a hardcoded literal. | Modify (1 literal) |
| `frontend/test/copy-run-vocabulary.test.ts` | Regression guard for the rule. | Create |
| `docs/reference/extraction-hitl-architecture.md` | Canonical reference devs read before touching `extraction_*`. | Modify (add §2.1) |

**Exact target strings** (single source of truth for every task below):

| Key / location | New value |
| --- | --- |
| `consensus.runsBannerTitle` | `These settings only affect articles started from now on` |
| `consensus.runsBannerBody` | `Articles already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment.` |
| `extraction.aiPanelStatusNotRun` | `Not started` |
| `extraction.aiPanelHistoryTitle` | `AI extraction history` |
| `extraction.aiPanelHistoryDesc` | `Previous AI extractions for this article` |
| `extraction.aiPanelNoRunsFound` | `No AI extractions found` |
| `extraction.panelNotRun` | `Not started` |
| QA toast (`QualityAssessmentFullScreen.tsx:327`) | `Assessment finalized.` |

---

## Task 1: Write the failing regression guard test

**Files:**

- Create: `frontend/test/copy-run-vocabulary.test.ts`

- [ ] **Step 1: Create the test file**

Create `frontend/test/copy-run-vocabulary.test.ts` with exactly this content:

```ts
/**
 * Regression guard: the internal HITL "Run" entity term must NOT leak into
 * user-facing copy. The *verb* "to run" ("Run AI") is fine; only the entity
 * *noun* is banned. See:
 * docs/superpowers/specs/2026-05-30-run-user-facing-vocabulary-design.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import copy, { consensus, extraction } from '@/lib/copy';

const here = dirname(fileURLToPath(import.meta.url));

/** Recursively yield every string leaf in a copy namespace tree. */
function* strings(value: unknown): Iterable<string> {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) yield* strings(item);
  }
}

describe('user-facing copy does not leak the internal "Run" entity', () => {
  it('phrases the consensus banner around "article", never "Run"', () => {
    expect(consensus.runsBannerTitle).toBe(
      'These settings only affect articles started from now on',
    );
    expect(consensus.runsBannerBody).toBe(
      'Articles already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment.',
    );
    expect(consensus.runsBannerTitle).not.toMatch(/\bRuns?\b/);
    expect(consensus.runsBannerBody).not.toMatch(/\bRuns?\b/);
  });

  it('uses "AI extraction" in the AI suggestions panel, never "Run"/"runs"', () => {
    expect(extraction.aiPanelHistoryTitle).toBe('AI extraction history');
    expect(extraction.aiPanelHistoryDesc).toBe(
      'Previous AI extractions for this article',
    );
    expect(extraction.aiPanelNoRunsFound).toBe('No AI extractions found');
    expect(extraction.aiPanelStatusNotRun).toBe('Not started');
    expect(extraction.panelNotRun).toBe('Not started');
  });

  it('contains no copy value with the plural entity-noun "Runs"', () => {
    const offenders = [...strings(copy)].filter((s) => /\bRuns\b/.test(s));
    expect(offenders).toEqual([]);
  });

  it('no longer ships the hardcoded "Run finalized" QA toast', () => {
    const src = readFileSync(
      resolve(here, '../pages/QualityAssessmentFullScreen.tsx'),
      'utf8',
    );
    expect(src).not.toContain('Run finalized');
    expect(src).toContain('Assessment finalized.');
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npx vitest run frontend/test/copy-run-vocabulary.test.ts`
Expected: **FAIL** — all four `it` blocks red (old copy still says "new Runs", "Run History", "Previous AI runs", "No runs found", "Not run", and the source still contains `Run finalized`).

Do **not** commit yet (red test).

---

## Task 2: Rephrase the consensus banner around "article"

**Files:**

- Modify: `frontend/lib/copy/consensus.ts:11-13`

- [ ] **Step 1: Replace the banner title**

In `frontend/lib/copy/consensus.ts`, change:

```ts
    runsBannerTitle: 'These settings only affect new Runs',
```

to:

```ts
    runsBannerTitle: 'These settings only affect articles started from now on',
```

- [ ] **Step 2: Replace the banner body**

In the same file, change:

```ts
    runsBannerBody:
        'Runs already in progress keep the snapshot they were created with. Changes here apply to the next Run created for an article.',
```

to:

```ts
    runsBannerBody:
        'Articles already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment.',
```

> Keep the key names (`runsBannerTitle` / `runsBannerBody`) unchanged — key renames are out of scope (the key is internal, not user-facing).

---

## Task 3: Switch the AI panel to "AI extraction" vocabulary

**Files:**

- Modify: `frontend/lib/copy/extraction.ts` (lines 114, 129, 130, 131, 460)

- [ ] **Step 1: Status label (line ~114)**

Change:

```ts
    aiPanelStatusNotRun: 'Not run',
```

to:

```ts
    aiPanelStatusNotRun: 'Not started',
```

- [ ] **Step 2: History title (line ~129)**

Change:

```ts
    aiPanelHistoryTitle: 'Run History',
```

to:

```ts
    aiPanelHistoryTitle: 'AI extraction history',
```

- [ ] **Step 3: History description (line ~130)**

Change:

```ts
    aiPanelHistoryDesc: 'Previous AI runs for this article',
```

to:

```ts
    aiPanelHistoryDesc: 'Previous AI extractions for this article',
```

- [ ] **Step 4: Empty-history label (line ~131)**

Change:

```ts
    aiPanelNoRunsFound: 'No runs found',
```

to:

```ts
    aiPanelNoRunsFound: 'No AI extractions found',
```

- [ ] **Step 5: Second "Not run" label (line ~460, under `// AISuggestionsPanel`)**

Change:

```ts
    panelNotRun: 'Not run',
```

to:

```ts
    panelNotRun: 'Not started',
```

> Leave the **verb** strings untouched: `aiPanelRunAI` ("Run AI"), `aiPanelStatusNotRunDesc`, `aiPanelNoRunsDesc`, `aiPanelNoSuggestionsDesc`.

---

## Task 4: Fix the hardcoded QA finalize toast, go green, and commit

**Files:**

- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:327`

- [ ] **Step 1: Align the outlier toast with its siblings**

In `frontend/pages/QualityAssessmentFullScreen.tsx`, change:

```ts
    toast.success("Run finalized.");
```

to:

```ts
    toast.success("Assessment finalized.");
```

(The sibling toasts in the same file already say `"Assessment reopened for revision."` and `"Assessment published."` — this aligns the last one.)

- [ ] **Step 2: Run the guard test and confirm it PASSES**

Run: `npx vitest run frontend/test/copy-run-vocabulary.test.ts`
Expected: **PASS** — all four `it` blocks green.

- [ ] **Step 3: Commit the functional change**

```bash
git add frontend/test/copy-run-vocabulary.test.ts \
        frontend/lib/copy/consensus.ts \
        frontend/lib/copy/extraction.ts \
        frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m 'fix(copy): stop the internal "Run" term leaking into user-facing UI

Researchers do not have the engineering "Run" mental model. Use the
vocabulary their tools (Covidence/DistillerSR) already use: "assessment"
in QA, "AI extraction" in the AI panel, and an article-anchored phrasing
for the shared consensus banner. The verb "to run" is left untouched.
Adds a Vitest guard that fails if the plural entity-noun "Runs" returns
to any copy value.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'
```

---

## Task 5: Document the rule for future devs

**Files:**

- Modify: `docs/reference/extraction-hitl-architecture.md` (frontmatter + status line + insert §2.1)

- [ ] **Step 1: Bump the review date (frontmatter, line ~3)**

Change `last_reviewed: 2026-05-24` to `last_reviewed: 2026-05-30`.

- [ ] **Step 2: Bump the inline status line (line ~9)**

Change `> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh` to `> **Status:** Stable · Last reviewed: 2026-05-30 · Owner: @raphaelfh`.

- [ ] **Step 3: Insert the vocabulary subsection**

Find the end of §2 — the paragraph ending `template afterwards never affects existing runs.` — and the line `## 3. Database — final schema` that follows it. Insert this between them:

```markdown
### 2.1 User-facing vocabulary (do not leak "Run")

"Run" is internal ubiquitous language. It is correct in code, the schema,
the API (`/api/v1/runs/...`), and these docs — but it MUST NOT appear as a
**noun** in user-facing copy or toasts. End users are systematic-review
researchers; "Run" means nothing to them, whereas the tools they already
use (Covidence, DistillerSR) speak of *extraction* and *assessment*.

User-facing vocabulary is context-specific:

| Surface | Say | Not |
| --- | --- | --- |
| Quality-assessment screens | "assessment" | "Run" |
| AI suggestions panel | "AI extraction" | "Run" / "AI runs" |
| Shared (e.g. consensus settings) | phrase around "article" | "Run" |

The **verb** "to run" ("Run AI", "run assessments") is fine — only the
entity *noun* is banned. A copy regression guard
(`frontend/test/copy-run-vocabulary.test.ts`) fails if the plural noun
"Runs" reappears in any copy value. Rationale and the full string-level
change set live in
`docs/superpowers/specs/2026-05-30-run-user-facing-vocabulary-design.md`.
```

- [ ] **Step 4: Commit the docs note**

```bash
git add docs/reference/extraction-hitl-architecture.md
git commit -m 'docs(extraction): record the "Run" user-facing vocabulary rule

Teach future devs that "Run" is internal-only and must not surface in UI
copy, with the context-specific mapping and a pointer to the guard test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:run`
Expected: **PASS** — no regressions; the new `copy-run-vocabulary` test is included and green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: **PASS** — no new eslint errors in the touched files.

- [ ] **Step 3: Browser preview of the three surfaces**

Start the dev server (preview_start) and confirm the new copy renders:

1. **Consensus banner** — Project Settings → "Review consensus" tab → the banner reads *"These settings only affect articles started from now on"* (no "Runs").
2. **AI suggestions panel** — open an article's extraction screen → AI panel shows *"AI extraction history"*, the empty state *"No AI extractions found"*, and the status *"Not started"* before any AI call.
3. **QA finalize toast** — open a quality assessment, publish/finalize it → the toast reads *"Assessment finalized."*

Expected: all three show the new wording; no "Run"/"Runs" entity-noun visible.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

- §3 Bucket 1 (consensus 2 + toast) → Tasks 2 & 4. ✅
- §3 Bucket 3 (AI panel 5 values) → Task 3. ✅
- §3 "kept as-is" (verbs) → explicit "leave untouched" notes in Tasks 2 & 3. ✅
- §4 Documentation deliverable → Task 5. ✅
- §6 Regression guard (changed-key asserts + plural-"Runs" net + toast source check) → Task 1 test. ✅
- §6 Manual preview of 3 surfaces → Task 6 Step 3. ✅
- §7 Files touched → all five files appear in tasks. ✅

**2. Placeholder scan** — no TBD/TODO; every code/edit step shows the full literal. ✅

**3. Type/string consistency** — the eight target strings in the File Structure table are byte-identical to the values asserted in the Task 1 test and the values written in Tasks 2–4 (notably the long `runsBannerBody` is one literal in both the test and `consensus.ts`, and the toast literal `Assessment finalized.` matches the test's `toContain`). The two `Not run` → `Not started` edits are disambiguated by their distinct keys (`aiPanelStatusNotRun` vs `panelNotRun`). ✅
