---
status: in_progress
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Extraction RunHeader Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-present the shared `RunHeader` around the real user-facing phases
(Extract → Consensus → Finalized), give the extraction bar a single role/phase-aware
primary action, bracket it with mirror-image ⌘B/`\` panel toggles, and bring the
real app navigation sidebar into the two full-screen run pages — all
presentation-only (no `ExtractionRunStage`/API change).

**Architecture:** Changes are isolated to the shared header lib
(`frontend/components/runs/header/*`), a new shared focus shell
(`frontend/components/runs/RunWorkspaceShell.tsx`), the extraction transition
builder, the two full-screen pages, copy, and two docs. Design doc:
`docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md`.

**Tech Stack:** TypeScript strict, React 19 + Vite, shadcn/Radix, in-house i18n
(`frontend/lib/copy/`), vitest, Playwright. React Compiler with
`panicThreshold: 'all_errors'`.

## Global Constraints

- **Repo root is the frontend tooling root.** Run `npm run test:run`,
  `npm run typecheck`, `npm run lint`, `node scripts/enumerate_compiler_bailouts.mjs`
  from the repo root. **Never** `cd frontend`.
- **React Compiler `panicThreshold: 'all_errors'`:** no `try/finally` or
  `throw`-in-`try` in component/hook bodies; IO in `frontend/services/*`
  returning `ErrorResult`; timers/measurement via `useEffect` + cleanup.
- **All user-facing text** through `frontend/lib/copy/` — `runs` namespace for
  shared, `extraction` for extraction-specific. **English only.**
- **Do not change** the `ExtractionRunStage` enum
  (`frontend/types/ai-extraction.ts`) or any backend/API behaviour.
- **Preserve for E2E:** `data-testid="run-stage-current"`, the literal
  **"Finalized"** rail label, `aria-label="Run stage"`.
- API errors read from `error.message` (envelope), not `detail`.
- Target test file: `npm run test:run -- <path>` runs vitest on one file.
- Commit per task with a conventional-commit message. PRs target `dev`.

---

### Task 1: Add new shared + extraction copy keys (additive)

Foundation for every later task. **Additive only** — do not remove
`submitForReview`/`reconcile` yet (Task 14 removes them once nothing references
them), so the tree stays green.

**Files:**
- Modify: `frontend/lib/copy/runs.ts`
- Modify: `frontend/lib/copy/extraction.ts:552-558`
- Test: `frontend/test/copyRuns.test.ts`

**Interfaces:**
- Produces (runs): `stageExtract`, `stageExtractTooltip`, `stageConsensusTooltip`,
  `stageFinalizedTooltip`, `sidebarToggle`, `helpButton`, `helpTitle`,
  `shortcutsHeading`, `glossaryHeading`, `shortcutPalette`, `shortcutNextPrev`,
  `shortcutTogglePdf`, `shortcutSidebar`, `shortcutEsc`, `glossaryExtract`,
  `glossaryConsensus`, `glossaryFinalize`, `glossaryBlind`, `glossaryDiffer`.
- Produces (extraction): `runHeaderMarkReady`, `runHeaderMarkReadyTooltip`,
  `runHeaderFinalizeTooltip`.

- [ ] **Step 1: Write the failing test** — extend `frontend/test/copyRuns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/copy';

describe('runs copy namespace', () => {
  it('resolves shared run-header keys', () => {
    expect(t('runs', 'revision')).toBe('Revision');
    expect(t('runs', 'stageConsensus')).toBe('Consensus');
    expect(t('runs', 'finalize')).toBe('Finalize');
  });

  it('resolves the new 3-node + help + sidebar keys', () => {
    expect(t('runs', 'stageExtract')).toBe('Extract');
    expect(t('runs', 'stageExtractTooltip')).not.toBe('');
    expect(t('runs', 'stageConsensusTooltip')).not.toBe('');
    expect(t('runs', 'stageFinalizedTooltip')).not.toBe('');
    expect(t('runs', 'sidebarToggle')).not.toBe('');
    expect(t('runs', 'helpTitle')).not.toBe('');
    expect(t('runs', 'shortcutPalette')).not.toBe('');
    expect(t('runs', 'glossaryExtract')).not.toBe('');
  });

  it('resolves the new extraction primary-action keys', () => {
    expect(t('extraction', 'runHeaderMarkReady')).toBe('Mark ready →');
    expect(t('extraction', 'runHeaderMarkReadyTooltip')).not.toBe('');
    expect(t('extraction', 'runHeaderFinalizeTooltip')).not.toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/copyRuns.test.ts`
Expected: FAIL (`stageExtract` etc. resolve to `''`).

- [ ] **Step 3: Add the keys.** In `frontend/lib/copy/runs.ts`, inside the
`runs` object, replace the StageRail block and the CommandPalette block, and add
a Help/glossary block:

```ts
  // StageRail (3 user-facing nodes: Extract → Consensus → Finalized)
  revision: 'Revision',
  stageExtract: 'Extract',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
  stageExtractTooltip: 'Fill the form and review AI suggestions for this article.',
  stageConsensusTooltip: 'Reconcile reviewer values into one agreed answer.',
  stageFinalizedTooltip: 'Locked and published — reopen to make changes.',
  gateRemaining: '{{count}} left',
```

Add a Help + sidebar + glossary block (anywhere in the object, English only):

```ts
  // SidebarToggle (left, mirrors PanelToggle)
  sidebarToggle: 'Toggle navigation',
  // Help panel ("?" button)
  helpButton: 'Help and shortcuts',
  helpTitle: 'Help',
  shortcutsHeading: 'Keyboard shortcuts',
  glossaryHeading: 'Workflow',
  shortcutPalette: 'Command palette',
  shortcutNextPrev: 'Next / previous article',
  shortcutTogglePdf: 'Toggle source panel',
  shortcutSidebar: 'Toggle navigation',
  shortcutEsc: 'Close dialogs',
  glossaryExtract: 'Extract — fill the form and review AI suggestions.',
  glossaryConsensus: 'Consensus — reconcile diverging reviewer values.',
  glossaryFinalize: 'Finalize — lock and publish the agreed values.',
  glossaryBlind: 'Blind — you cannot see other reviewers’ values.',
  glossaryDiffer: '"N differ" — fields where reviewers disagree.',
```

Leave the existing `submitForReview` / `reconcile` keys in place for now.

- [ ] **Step 4: Add extraction keys.** In `frontend/lib/copy/extraction.ts`,
near line 552, add (keep `runHeaderSubmitForReview`/`runHeaderReconcile` for now):

```ts
    runHeaderMarkReady: 'Mark ready →',
    runHeaderMarkReadyTooltip: 'Mark this extraction ready for consensus and open the next article.',
    runHeaderFinalizeTooltip: 'Lock and publish the agreed values.',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- frontend/test/copyRuns.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/copy/runs.ts frontend/lib/copy/extraction.ts frontend/test/copyRuns.test.ts
git commit -m "feat(runs): add 3-node rail, help, sidebar, and mark-ready copy keys"
```

---

### Task 2: `stage.ts` — fold proposal+review into a 3-node UI model

**Files:**
- Modify: `frontend/components/runs/header/stage.ts`
- Test: `frontend/components/runs/header/__tests__/stage.test.ts`

**Interfaces:**
- Produces: `StageKey = 'extract' | 'consensus' | 'finalized'`;
  `stageNodeStates(stage: ExtractionRunStage | null): StageNode[]` returning 3
  nodes in `ORDER` with `state` of `done|current|future|cancelled`.

- [ ] **Step 1: Rewrite the test** (`stage.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { stageNodeStates } from '@/components/runs/header/stage';

describe('stageNodeStates (3-node user-facing model)', () => {
  it('maps proposal AND review to the current Extract node', () => {
    for (const s of ['proposal', 'review'] as const) {
      const nodes = stageNodeStates(s);
      expect(nodes.map((n) => [n.key, n.state])).toEqual([
        ['extract', 'current'],
        ['consensus', 'future'],
        ['finalized', 'future'],
      ]);
    }
  });
  it('marks Extract done and Consensus current at consensus', () => {
    expect(stageNodeStates('consensus').map((n) => n.state)).toEqual([
      'done', 'current', 'future',
    ]);
  });
  it('marks Extract + Consensus done and Finalized current at finalized', () => {
    expect(stageNodeStates('finalized').map((n) => n.state)).toEqual([
      'done', 'done', 'current',
    ]);
  });
  it('treats pending/null as Extract current', () => {
    expect(stageNodeStates('pending').map((n) => n.state)).toEqual([
      'current', 'future', 'future',
    ]);
    expect(stageNodeStates(null).map((n) => n.state)).toEqual([
      'current', 'future', 'future',
    ]);
  });
  it('marks every node cancelled when the run is cancelled', () => {
    expect(stageNodeStates('cancelled').every((n) => n.state === 'cancelled')).toBe(true);
    expect(stageNodeStates('cancelled').map((n) => n.key)).toEqual([
      'extract', 'consensus', 'finalized',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/stage.test.ts`
Expected: FAIL (still 4 nodes).

- [ ] **Step 3: Rewrite `stage.ts`:**

```ts
import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export type StageKey = 'extract' | 'consensus' | 'finalized';
export interface StageNode {
  key: StageKey;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['extract', 'consensus', 'finalized'];

/**
 * Maps a DB stage to a user-facing 3-node index. `proposal` and `review` both
 * collapse into the single `extract` node — `review` is reviewing one's OWN AI
 * suggestions, not peer review, and is reached via an invisible auto-advance.
 */
function uiIndex(stage: ExtractionRunStage | null): number {
  switch (stage) {
    case 'consensus':
      return 1;
    case 'finalized':
      return 2;
    default:
      // pending / null / proposal / review → Extract
      return 0;
  }
}

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, state: 'cancelled' as const }));
  }
  const currentIndex = uiIndex(stage);
  return ORDER.map((key, i) => ({
    key,
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/stage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/stage.ts frontend/components/runs/header/__tests__/stage.test.ts
git commit -m "feat(runs): fold proposal+review into a single Extract rail node"
```

---

### Task 3: `StageRail.tsx` — 3 nodes, per-node tooltips, drop progress underline/chip

**Files:**
- Modify: `frontend/components/runs/header/StageRail.tsx`
- Test: `frontend/components/runs/header/__tests__/StageRail.test.tsx`

**Interfaces:**
- Consumes: `stageNodeStates`, `StageKey` (Task 2); shadcn
  `Tooltip`/`TooltipTrigger`/`TooltipContent` from `@/components/ui/tooltip`.
- Produces: a `<nav aria-label="Run stage">` with 3 nodes; current node carries
  `data-testid="run-stage-current"`; no progress underline, no `gateRemaining`
  chip.

- [ ] **Step 1: Rewrite the test** (`StageRail.test.tsx`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const value = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: true,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 0 }, transition: null,
};

describe('RunHeader.StageRail (3-node)', () => {
  it('renders three nodes, marks Extract current for review, shows revision tag', () => {
    render(
      <RunHeader value={value}>
        <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
      </RunHeader>,
    );
    ['stageExtract', 'stageConsensus', 'stageFinalized'].forEach((l) =>
      expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.queryByText('stageProposal')).toBeNull();
    expect(screen.queryByText('stageReview')).toBeNull();
    expect(screen.getByText('stageExtract').closest('[data-state]')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('run-stage-current')).toBeInTheDocument();
    expect(screen.getByLabelText('Run stage')).toBeInTheDocument();
    expect(screen.getByText('revision')).toBeInTheDocument();
  });

  it('does not render a gate-remaining chip in the rail', () => {
    render(
      <RunHeader value={{ ...value, transition: { to: 'consensus', label: 'x', gate: { ok: false, reason: 'r', remaining: 27 }, onAdvance: () => {} } }}>
        <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.queryByText('gateRemaining')).toBeNull();
  });
});
```

Note: `aria-label="Run stage"` is literal (not a copy key), so `getByLabelText('Run stage')` works even with the mocked `t`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/StageRail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `StageRail.tsx`:**

```tsx
import { Circle, CircleCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunHeader } from './RunHeaderContext';
import { stageNodeStates, type StageNode, type StageKey } from './stage';

const STAGE_COPY_KEY: Record<StageKey, 'stageExtract' | 'stageConsensus' | 'stageFinalized'> = {
  extract: 'stageExtract',
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
};

const STAGE_TOOLTIP_KEY: Record<StageKey, 'stageExtractTooltip' | 'stageConsensusTooltip' | 'stageFinalizedTooltip'> = {
  extract: 'stageExtractTooltip',
  consensus: 'stageConsensusTooltip',
  finalized: 'stageFinalizedTooltip',
};

const DOT: Record<StageNode['state'], string> = {
  done: 'text-success',
  current: 'text-info',
  future: 'text-muted-foreground/50',
  cancelled: 'text-destructive',
};

export function StageRail() {
  const { stage, isRevision } = useRunHeader();
  const nodes = stageNodeStates(stage);
  return (
    <nav className="flex items-center gap-1.5" aria-label="Run stage">
      {isRevision && (
        <span className="mr-1 whitespace-nowrap rounded-md bg-ai/10 px-2 py-0.5 text-[11px] font-medium text-ai">
          {t('runs', 'revision')}
        </span>
      )}
      {nodes.map((node, i) => (
        <div
          key={node.key}
          className="flex items-center gap-1.5"
          data-state={node.state}
          {...(node.state === 'current' ? { 'data-testid': 'run-stage-current' } : {})}
        >
          {i > 0 && <span className={cn('h-px w-3.5', nodes[i - 1].state === 'done' ? 'bg-success/40' : 'bg-border')} aria-hidden="true" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  node.state === 'current' && 'bg-info/10 font-medium text-foreground',
                  node.state !== 'current' && 'text-muted-foreground',
                )}
              >
                {node.state === 'done' ? (
                  <CircleCheck className={cn('h-3.5 w-3.5', DOT.done)} aria-hidden="true" />
                ) : node.key === 'finalized' && node.state === 'future' ? (
                  <Lock className={cn('h-3.5 w-3.5', DOT[node.state])} aria-hidden="true" />
                ) : node.state === 'current' ? (
                  <span className={cn('h-[7px] w-[7px] rounded-full bg-info')} aria-hidden="true" />
                ) : (
                  <Circle className={cn('h-3.5 w-3.5', DOT[node.state])} aria-hidden="true" />
                )}
                <span className="hidden @[48rem]/headerbar:inline">{t('runs', STAGE_COPY_KEY[node.key])}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('runs', STAGE_TOOLTIP_KEY[node.key])}</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/StageRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/StageRail.tsx frontend/components/runs/header/__tests__/StageRail.test.tsx
git commit -m "feat(runs): 3-node stage rail with per-node tooltips, drop progress underline"
```

---

### Task 4: `StageTransition.tooltip` + `PrimaryAction` tooltip rendering

**Files:**
- Modify: `frontend/components/runs/header/RunHeaderContext.tsx:7-14`
- Modify: `frontend/components/runs/header/PrimaryAction.tsx`
- Test: `frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`

**Interfaces:**
- Produces: `StageTransition` gains optional `tooltip?: string`. `PrimaryAction`
  wraps the button in a shadcn `Tooltip` (hover+focus) when `transition.tooltip`
  is set.

- [ ] **Step 1: Add a failing test** — append to `PrimaryAction.test.tsx`:

```tsx
  it('shows the transition tooltip on focus when provided', async () => {
    render(
      <RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Mark ready →', tooltip: 'Mark ready and open next', gate: { ok: true }, onAdvance: () => {} } }}>
        <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
      </RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'Mark ready →' });
    btn.focus();
    expect(await screen.findByText('Mark ready and open next')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`
Expected: FAIL (tooltip not rendered; type error on `tooltip`).

- [ ] **Step 3: Widen the type.** In `RunHeaderContext.tsx`, add `tooltip?: string`
to both `StageTransition` variants:

```ts
export type StageTransition =
  | { to: string; label: string; tooltip?: string; gate: { ok: true }; onAdvance: () => void | Promise<void> }
  | {
      to: string;
      label: string;
      tooltip?: string;
      gate: { ok: false; reason: string; remaining: number };
      onAdvance: () => void | Promise<void>;
    };
```

- [ ] **Step 4: Render the tooltip.** Rewrite `PrimaryAction.tsx`:

```tsx
import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

export function PrimaryAction() {
  const helperId = useId();
  const { transition, submitting, progress } = useRunHeader();
  if (!transition) return null;
  const gated = transition.gate.ok === false;
  const helper = gated
    ? t('runs', 'requiredOfTotal')
        .replace('{{done}}', String(progress.completed))
        .replace('{{total}}', String(progress.total))
    : null;
  const button = (
    <Button
      size="sm"
      onClick={() => void transition.onAdvance()}
      disabled={submitting}
      aria-disabled={gated || undefined}
      aria-describedby={gated ? helperId : undefined}
      className={cn('shrink-0 whitespace-nowrap font-medium hover:bg-primary-hover', gated && 'opacity-70')}
    >
      {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {transition.label}
    </Button>
  );
  return (
    <div className="flex items-center gap-2">
      {helper && <span id={helperId} className="whitespace-nowrap text-[11px] text-muted-foreground">{helper}</span>}
      {transition.tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{transition.tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/header/RunHeaderContext.tsx frontend/components/runs/header/PrimaryAction.tsx frontend/components/runs/header/__tests__/PrimaryAction.test.tsx
git commit -m "feat(runs): optional transition tooltip rendered on the primary action"
```

---

### Task 5: `buildExtractionTransition` — Mark ready (Extract) + Finalize (Consensus)

**Files:**
- Modify: `frontend/lib/extraction/stageTransition.ts`
- Test: `frontend/test/stageTransition.test.ts`

**Interfaces:**
- Consumes: `StageTransition` (with optional `tooltip`).
- Produces: `BuildTransitionArgs` drops `onSubmit`/`onReconcile`, gains
  `onMarkReady: () => void | Promise<void>`. Extract phase
  (`proposal`|`review`) → `to:'consensus'`, `label: runHeaderMarkReady`,
  `tooltip: runHeaderMarkReadyTooltip`, built for every extractor. Consensus +
  `canResolveConflicts` → `to:'finalized'`, `label: runHeaderFinalize`,
  `tooltip: runHeaderFinalizeTooltip`.

- [ ] **Step 1: Rewrite the test** (`frontend/test/stageTransition.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildExtractionTransition } from '@/lib/extraction/stageTransition';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const noop = () => {};

function makeArgs(overrides: Partial<Parameters<typeof buildExtractionTransition>[0]> = {}) {
  return {
    stage: null as Parameters<typeof buildExtractionTransition>[0]['stage'],
    canResolveConflicts: false,
    isComplete: false,
    completed: 0,
    total: 30,
    onMarkReady: noop,
    onFinalize: noop,
    onGuide: noop,
    ...overrides,
  };
}

describe('buildExtractionTransition', () => {
  it('Extract phase (proposal) → Mark ready to consensus, available to every extractor', () => {
    const onMarkReady = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'proposal', canResolveConflicts: false, isComplete: true, completed: 10, total: 10, onMarkReady }));
    expect(r).not.toBeNull();
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderMarkReady');
    expect(r!.tooltip).toBe('runHeaderMarkReadyTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('Extract phase (review) → Mark ready even when canResolveConflicts=false', () => {
    const onMarkReady = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'review', canResolveConflicts: false, isComplete: true, completed: 5, total: 5, onMarkReady }));
    expect(r).not.toBeNull();
    expect(r!.to).toBe('consensus');
    expect(r!.label).toBe('runHeaderMarkReady');
    expect(r!.onAdvance).toBe(onMarkReady);
  });

  it('Extract phase gated (isComplete=false) → gate blocked, onAdvance===onGuide', () => {
    const onGuide = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'review', isComplete: false, completed: 3, total: 30, onGuide }));
    expect(r!.gate.ok).toBe(false);
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(27);
    expect(r!.onAdvance).toBe(onGuide);
  });

  it('Consensus + canResolveConflicts + complete → Finalize, onAdvance===onFinalize', () => {
    const onFinalize = vi.fn();
    const r = buildExtractionTransition(makeArgs({ stage: 'consensus', canResolveConflicts: true, isComplete: true, onFinalize }));
    expect(r!.to).toBe('finalized');
    expect(r!.label).toBe('runHeaderFinalize');
    expect(r!.tooltip).toBe('runHeaderFinalizeTooltip');
    expect(r!.gate.ok).toBe(true);
    expect(r!.onAdvance).toBe(onFinalize);
  });

  it('Consensus without canResolveConflicts → null (reviewer cannot finalize)', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'consensus', canResolveConflicts: false }))).toBeNull();
  });

  it('finalized / cancelled / null → null', () => {
    expect(buildExtractionTransition(makeArgs({ stage: 'finalized' }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: 'cancelled' }))).toBeNull();
    expect(buildExtractionTransition(makeArgs({ stage: null }))).toBeNull();
  });

  it('remaining clamps to 0 when completed > total', () => {
    const r = buildExtractionTransition(makeArgs({ stage: 'proposal', isComplete: false, completed: 35, total: 30 }));
    expect((r!.gate as { ok: false; remaining: number }).remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/test/stageTransition.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `stageTransition.ts`:**

```ts
import { t } from '@/lib/copy';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { StageTransition } from '@/components/runs/header/RunHeaderContext';

export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  isComplete: boolean;
  completed: number;
  total: number;
  /** Extract phase: advance to consensus AND open the next article. */
  onMarkReady: () => void | Promise<void>;
  onFinalize: () => void | Promise<void>;
  onGuide: () => void;
}

function makeTransition(
  to: ExtractionRunStage,
  label: string,
  tooltip: string,
  isComplete: boolean,
  completed: number,
  total: number,
  advance: () => void | Promise<void>,
  onGuide: () => void,
): StageTransition {
  if (isComplete) {
    return { to, label, tooltip, gate: { ok: true }, onAdvance: advance };
  }
  return {
    to,
    label,
    tooltip,
    gate: {
      ok: false,
      reason: t('extraction', 'runHeaderGateBlocked'),
      remaining: Math.max(0, total - completed),
    },
    onAdvance: onGuide,
  };
}

export function buildExtractionTransition(args: BuildTransitionArgs): StageTransition | null {
  const { stage, canResolveConflicts, isComplete, completed, total, onMarkReady, onFinalize, onGuide } = args;

  // Extract phase: proposal + review collapse into one user step. Available to
  // EVERY extractor — POST /runs/{id}/advance is membership-gated, not role-gated.
  if (stage === 'proposal' || stage === 'review') {
    return makeTransition(
      'consensus',
      t('extraction', 'runHeaderMarkReady'),
      t('extraction', 'runHeaderMarkReadyTooltip'),
      isComplete,
      completed,
      total,
      onMarkReady,
      onGuide,
    );
  }

  // Consensus → Finalize, manager/consensus only.
  if (stage === 'consensus' && canResolveConflicts) {
    return makeTransition(
      'finalized',
      t('extraction', 'runHeaderFinalize'),
      t('extraction', 'runHeaderFinalizeTooltip'),
      isComplete,
      completed,
      total,
      onFinalize,
      onGuide,
    );
  }

  // consensus-without-permission, finalized, pending, cancelled, null → none.
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/test/stageTransition.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (callers will break — fixed in Task 11)**

Run: `npm run typecheck`
Expected: error only in `frontend/pages/ExtractionFullScreen.tsx` (still passes
`onSubmit`/`onReconcile`). This is expected; Task 11 fixes the caller. Do **not**
fix it here — keep the task boundary clean. Commit anyway (the unit test is green).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/extraction/stageTransition.ts frontend/test/stageTransition.test.ts
git commit -m "feat(extraction): single Mark-ready/Finalize transition (every extractor can advance)"
```

---

### Task 6: Shared `SidebarToggle` slot + mirror `PanelToggle`

**Files:**
- Create: `frontend/components/runs/header/SidebarToggle.tsx`
- Modify: `frontend/components/runs/header/PanelToggle.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx:36` (register slot)
- Test: `frontend/components/runs/header/__tests__/Toggles.test.tsx` (new)

**Interfaces:**
- Produces: `RunHeader.SidebarToggle` (`{ pressed?: boolean; onToggle?: () => void }`,
  renders `null` without `onToggle`); `RunHeader.PanelToggle` rewritten with
  `PanelRightClose`/`PanelRightOpen` crossfade + `aria-keyshortcuts="\\"`.

- [ ] **Step 1: Write the test** (`Toggles.test.tsx`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  isBlind: false, canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.SidebarToggle', () => {
  it('renders nothing without onToggle', () => {
    const { container } = render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle /></RunHeader.Left></RunHeader>,
    );
    expect(container.querySelector('button')).toBeNull();
  });
  it('toggles, exposes aria-pressed and Meta+B', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle pressed onToggle={onToggle} /></RunHeader.Left></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'sidebarToggle' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Meta+B');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe('RunHeader.PanelToggle (mirror)', () => {
  it('exposes aria-pressed and the backslash shortcut', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Right><RunHeader.PanelToggle pressed={false} onToggle={onToggle} /></RunHeader.Right></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'togglePanel' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('aria-keyshortcuts', '\\');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Toggles.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create `SidebarToggle.tsx`:**

```tsx
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

/**
 * Left app-navigation toggle. Prop-driven so the shared lib stays decoupled
 * from SidebarContext; renders nothing when no handler is wired. Mirrors the
 * right-hand PanelToggle (Meta+B ↔ "\\") to bracket the bar.
 */
export function SidebarToggle({ pressed, onToggle }: { pressed?: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts="Meta+B"
      aria-label={t('runs', 'sidebarToggle')}
      className="relative h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-muted/50 transition-colors duration-75"
    >
      <span className="relative block h-4 w-4">
        <PanelLeftClose
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        />
        <PanelLeftOpen
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
```

(`pressed` = sidebar **open**; `PanelLeftClose` shows when open, matching Topbar.)

- [ ] **Step 4: Rewrite `PanelToggle.tsx`:**

```tsx
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts="\"
      aria-label={t('runs', 'togglePanel')}
      className="relative h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-muted/50 transition-colors duration-75"
    >
      <span className="relative block h-4 w-4">
        <PanelRightClose
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        />
        <PanelRightOpen
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
```

- [ ] **Step 5: Register the slot.** In `RunHeader.tsx`, import `SidebarToggle`
and add it to the `Object.assign`:

```tsx
import { SidebarToggle } from './SidebarToggle';
// ...
export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, StageRail, PrimaryAction, PanelToggle, SidebarToggle, RoleChip, Reviewers, Save: SaveSlot, AIActions, Breadcrumb, Menu, MenuItem, Worklist, CommandPalette });
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Toggles.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/runs/header/SidebarToggle.tsx frontend/components/runs/header/PanelToggle.tsx frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/__tests__/Toggles.test.tsx
git commit -m "feat(runs): symmetric SidebarToggle + mirrored crossfade PanelToggle"
```

---

### Task 7: Transient `SaveSlot`

**Files:**
- Modify: `frontend/components/runs/header/SaveSlot.tsx`
- Test: `frontend/components/runs/header/__tests__/SaveSlot.test.tsx` (new)

**Interfaces:**
- Produces: `SaveSlot` shows `Saving…` (live), a check + `Saved` that auto-hides
  after ~2s, and `Save failed` (persistent, red). Same props
  (`{ state: SaveState; lastSavedAt: Date | null; hidden?: boolean }`).

- [ ] **Step 1: Write the test** (`SaveSlot.test.tsx`):

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SaveSlot } from '@/components/runs/header/SaveSlot';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SaveSlot (transient)', () => {
  it('shows Saving… while saving', () => {
    render(<SaveSlot state="saving" lastSavedAt={null} />);
    expect(screen.getByText('saving')).toBeInTheDocument();
  });
  it('shows Saved then fades it out', () => {
    render(<SaveSlot state="saved" lastSavedAt={new Date(0)} />);
    expect(screen.getByText('saved')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByText('saved')).toBeNull();
  });
  it('keeps Save failed visible', () => {
    render(<SaveSlot state="error" lastSavedAt={null} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('saveFailed')).toBeInTheDocument();
  });
  it('renders nothing when hidden', () => {
    const { container } = render(<SaveSlot state="saved" lastSavedAt={null} hidden />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/SaveSlot.test.tsx`
Expected: FAIL ("Saved" never hides).

- [ ] **Step 3: Rewrite `SaveSlot.tsx`** (timer via effect + cleanup, no try/finally):

```tsx
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

const SAVED_VISIBLE_MS = 2000;

export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  // Transient "Saved": visible briefly after a save lands, then fades.
  const [savedVisible, setSavedVisible] = useState(false);
  useEffect(() => {
    if (state !== 'saved') {
      setSavedVisible(false);
      return;
    }
    setSavedVisible(true);
    const id = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [state, lastSavedAt]);

  if (hidden) return null;
  const failed = state === 'error';
  const saving = state === 'saving';
  // Nothing to show: idle, or a Saved that has already faded.
  if (!saving && !failed && !savedVisible) return null;

  const label = saving ? t('runs', 'saving') : failed ? t('runs', 'saveFailed') : t('runs', 'saved');
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap text-[11px] transition-opacity duration-300',
        failed ? 'text-destructive' : 'text-muted-foreground',
      )}
      title={lastSavedAt ? lastSavedAt.toLocaleTimeString() : undefined}
    >
      {failed ? (
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
      ) : saving ? (
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
      ) : (
        <Check className="h-3 w-3 text-success" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/SaveSlot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/SaveSlot.tsx frontend/components/runs/header/__tests__/SaveSlot.test.tsx
git commit -m "feat(runs): transient Saved indicator (fades on success, persists on failure)"
```

---

### Task 8: Shared `Help` panel + `TruncatedText` helper

**Files:**
- Create: `frontend/components/runs/header/Help.tsx`
- Create: `frontend/components/runs/header/TruncatedText.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx` (register `Help`)
- Test: `frontend/components/runs/header/__tests__/Help.test.tsx` (new)

**Interfaces:**
- Produces: `RunHeader.Help` (a `Popover` with a `HelpCircle` trigger; content =
  shortcuts list + glossary). `TruncatedText` (`{ text: string; className?: string }`)
  — caps width, shows a `Tooltip` only when `scrollWidth > clientWidth`.

- [ ] **Step 1: Write the test** (`Help.test.tsx`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  isBlind: false, canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.Help', () => {
  it('opens a panel listing shortcuts and glossary', async () => {
    render(<RunHeader value={base}><RunHeader.Right><RunHeader.Help /></RunHeader.Right></RunHeader>);
    await userEvent.click(screen.getByRole('button', { name: 'helpButton' }));
    expect(screen.getByText('shortcutsHeading')).toBeInTheDocument();
    expect(screen.getByText('glossaryHeading')).toBeInTheDocument();
    expect(screen.getByText('glossaryExtract')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Help.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create `TruncatedText.tsx`** (overflow-measured tooltip):

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setTruncated(el.scrollWidth > el.clientWidth);
  }, [text]);

  const span = (
    <span ref={ref} className={cn('block truncate', className)}>
      {text}
    </span>
  );
  if (!truncated) return span;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Create `Help.tsx`:**

```tsx
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/lib/copy';

const SHORTCUTS: { combo: string; key: 'shortcutPalette' | 'shortcutNextPrev' | 'shortcutTogglePdf' | 'shortcutSidebar' | 'shortcutEsc' }[] = [
  { combo: '⌘K', key: 'shortcutPalette' },
  { combo: 'J / K', key: 'shortcutNextPrev' },
  { combo: '\\', key: 'shortcutTogglePdf' },
  { combo: '⌘B', key: 'shortcutSidebar' },
  { combo: 'Esc', key: 'shortcutEsc' },
];

const GLOSSARY: ('glossaryExtract' | 'glossaryConsensus' | 'glossaryFinalize' | 'glossaryBlind' | 'glossaryDiffer')[] = [
  'glossaryExtract', 'glossaryConsensus', 'glossaryFinalize', 'glossaryBlind', 'glossaryDiffer',
];

export function Help() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground" aria-label={t('runs', 'helpButton')}>
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[13px]">
        <p className="mb-2 font-medium">{t('runs', 'helpTitle')}</p>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('runs', 'shortcutsHeading')}</p>
        <ul className="mb-3 space-y-1">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('runs', s.key)}</span>
              <kbd className="rounded border border-border/60 bg-muted/40 px-1.5 font-sans text-[11px]">{s.combo}</kbd>
            </li>
          ))}
        </ul>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('runs', 'glossaryHeading')}</p>
        <ul className="space-y-1 text-muted-foreground">
          {GLOSSARY.map((g) => (
            <li key={g}>{t('runs', g)}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Register `Help`.** In `RunHeader.tsx` add `import { Help } from './Help';`
and append `Help` to the `Object.assign` list.

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Help.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/runs/header/Help.tsx frontend/components/runs/header/TruncatedText.tsx frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/__tests__/Help.test.tsx
git commit -m "feat(runs): one '?' help panel + overflow-only TruncatedText helper"
```

---

### Task 9: Apply `TruncatedText` to the breadcrumb

**Files:**
- Modify: `frontend/components/runs/header/Breadcrumb.tsx`
- Test: `frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`

**Interfaces:**
- Consumes: `TruncatedText` (Task 8). Breadcrumb last crumb wraps its label in
  `TruncatedText`; clickable crumbs stay buttons. Existing assertions
  (`renders all crumb labels`, `applies truncate class to the last crumb only`,
  back button, clickable vs span) must still pass.

- [ ] **Step 1: Confirm current tests still describe intent.** Keep the
existing `Breadcrumb.test.tsx`; add one case asserting the last crumb text is
present even when long:

```tsx
  it('still renders the last crumb label verbatim (wrapped for truncation)', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb onBack={vi.fn()} crumbs={[{ label: 'Projects' }, { label: 'A very long article title that should truncate' }]} />
        </RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByText('A very long article title that should truncate')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new case fails or passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`
Expected: existing cases PASS; new case PASS (text is present already) — proceed
to wire `TruncatedText` and keep it green.

- [ ] **Step 3: Modify `Breadcrumb.tsx`.** Import `TruncatedText`; for the last,
non-clickable crumb render `TruncatedText`. Replace the span branch:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';
import { TruncatedText } from './TruncatedText';

interface Crumb { label: string; onClick?: () => void; }
interface BreadcrumbProps { onBack: () => void; crumbs: Crumb[]; }

export function Breadcrumb({ onBack, crumbs }: BreadcrumbProps) {
  return (
    <nav className="flex shrink-0 items-center gap-1" aria-label="breadcrumb">
      <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label={t('common', 'back')} onClick={onBack}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
              {crumb.onClick ? (
                <button
                  type="button"
                  className="whitespace-nowrap rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              ) : isLast ? (
                <TruncatedText text={crumb.label} className="max-w-[220px] text-sm font-medium text-foreground" />
              ) : (
                <span className="whitespace-nowrap text-sm text-muted-foreground">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

Note: the existing test asserts the last crumb has class `truncate` — `TruncatedText`
applies `truncate` (Step 8.3), so `getByText(...).className` still matches `/truncate/`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`
Expected: PASS (all cases incl. `truncate` class on the last crumb).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/Breadcrumb.tsx frontend/components/runs/header/__tests__/Breadcrumb.test.tsx
git commit -m "feat(runs): truncate the breadcrumb title with an overflow-only tooltip"
```

---

### Task 10: `RunWorkspaceShell` (real app sidebar around the focus pages)

**Files:**
- Create: `frontend/components/runs/RunWorkspaceShell.tsx`
- Modify: `frontend/App.tsx:99-117`
- Test: `frontend/test/RunWorkspaceShell.test.tsx` (new)

**Interfaces:**
- Produces: `RunWorkspaceShell({ projectId, activeTab, children })` — renders
  `SidebarProvider` + `ProjectSidebar` + `<main>{children}</main>`, binds ⌘B to
  `toggleSidebar`, navigates on tab change to `/projects/${projectId}?tab=${tab}`.
- Consumes: `SidebarProvider`/`useSidebar` (`@/contexts/SidebarContext`),
  `ProjectSidebar` (`@/components/layout/ProjectSidebar`), `useProjectsList`,
  `useKeyboardShortcuts` (`@/hooks/useKeyboardShortcuts`), `SidebarTabId`
  (`@/components/layout/sidebarConfig`).

- [ ] **Step 1: Write the test** (`RunWorkspaceShell.test.tsx`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RunWorkspaceShell } from '@/components/runs/RunWorkspaceShell';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));
vi.mock('@/components/layout/ProjectSidebar', () => ({
  ProjectSidebar: ({ activeTab }: { activeTab: string }) => <aside data-testid="project-sidebar">{activeTab}</aside>,
}));
vi.mock('@/hooks/useProjectsList', () => ({ useProjectsList: () => ({ projects: [], loading: false }) }));

describe('RunWorkspaceShell', () => {
  it('renders the app sidebar (with the active tab) around its children', () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1/extraction/a1']}>
        <RunWorkspaceShell projectId="p1" activeTab="extraction">
          <div data-testid="page-body">body</div>
        </RunWorkspaceShell>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('project-sidebar')).toHaveTextContent('extraction');
    expect(screen.getByTestId('page-body')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/test/RunWorkspaceShell.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `RunWorkspaceShell.tsx`:**

```tsx
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { useProjectsList } from '@/hooks/useProjectsList';
import { useKeyboardShortcuts, type Binding } from '@/hooks/useKeyboardShortcuts';
import type { SidebarTabId } from '@/components/layout/sidebarConfig';

interface RunWorkspaceShellProps {
  projectId: string;
  activeTab: SidebarTabId;
  children: ReactNode;
}

function ShellInner({ projectId, activeTab, children }: RunWorkspaceShellProps) {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const { projects } = useProjectsList();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const projectName = projects.find((p) => p.id === projectId)?.name;

  // Focus shell only wires ⌘B (sidebar). G-nav is out of scope here.
  const bindings: Binding[] = [{ type: 'chord', key: 'b', mod: true, handler: toggleSidebar }];
  useKeyboardShortcuts({ bindings, enabled: true });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          activeTab={activeTab}
          onTabChange={(tab) => navigate(`/projects/${projectId}?tab=${tab}`)}
          projectName={projectName}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

/**
 * Wraps a full-screen run page in the real app navigation sidebar, collapsed by
 * default for focus. The page's RunHeader is the bar (no Topbar). ⌘B and the
 * RunHeader.SidebarToggle both drive the same collapse state.
 */
export function RunWorkspaceShell({ projectId, activeTab, children }: RunWorkspaceShellProps) {
  return (
    <SidebarProvider defaultCollapsed>
      <ShellInner projectId={projectId} activeTab={activeTab}>{children}</ShellInner>
    </SidebarProvider>
  );
}
```

- [ ] **Step 4: Wire routes in `App.tsx`.** Import the shell
(`import { RunWorkspaceShell } from "@/components/runs/RunWorkspaceShell";`) and a
small wrapper that reads `projectId` from params. Add near the other lazy
imports a tiny inline wrapper component, then wrap both page elements. Replace
the two route elements:

```tsx
// add import
import { useParams } from "react-router-dom";

// helper (place above `const App`)
function RunRoute({ tab, children }: { tab: "extraction" | "quality"; children: React.ReactNode }) {
  const { projectId } = useParams();
  return (
    <RunWorkspaceShell projectId={projectId ?? ""} activeTab={tab}>
      {children}
    </RunWorkspaceShell>
  );
}
```

Then in the extraction route element, wrap the suspense'd page:

```tsx
<ProtectedRoute>
  <ErrorBoundary context="extraction">
    <RunRoute tab="extraction">
      <Suspense fallback={<PageLoader />}>
        <ExtractionFullScreen />
      </Suspense>
    </RunRoute>
  </ErrorBoundary>
</ProtectedRoute>
```

And the quality-assessment route element analogously with `tab="quality"` around
`<QualityAssessmentFullScreen />`. (Keep whatever `ErrorBoundary context` string
already exists on each route.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from `App.tsx`/the shell (the pre-existing
`ExtractionFullScreen` transition error from Task 5 may still show — fixed next).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/runs/RunWorkspaceShell.tsx frontend/App.tsx frontend/test/RunWorkspaceShell.test.tsx
git commit -m "feat(runs): focus workspace shell brings the app sidebar into run pages"
```

---

### Task 11: `ExtractionFullScreen` — Mark-ready handler, next-article nav, sidebar wiring, key handlers, h-full

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Test: `frontend/test/extractionNextArticle.test.ts` (new — pure helper)

**Interfaces:**
- Produces: a pure helper `nextArticleTarget(articles, currentId): string | null`
  (next-in-order id, or `null` at end-of-queue) in a small module
  `frontend/lib/extraction/worklistNav.ts`; `ExtractionHeader` gains optional
  `sidebarCollapsed?: boolean` + `onToggleSidebar?: () => void` and renders
  `RunHeader.SidebarToggle` (left), `RunHeader.Help` (right, replacing the ⌘K
  chip).
- Consumes: `buildExtractionTransition` new `onMarkReady` arg (Task 5),
  `useSidebar` (Task 10 shell).

- [ ] **Step 1: Write the helper test** (`extractionNextArticle.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { nextArticleTarget } from '@/lib/extraction/worklistNav';

const arts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('nextArticleTarget', () => {
  it('returns the next article in order', () => {
    expect(nextArticleTarget(arts, 'a')).toBe('b');
    expect(nextArticleTarget(arts, 'b')).toBe('c');
  });
  it('returns null at the end of the queue', () => {
    expect(nextArticleTarget(arts, 'c')).toBeNull();
  });
  it('returns null when current is unknown or list is short', () => {
    expect(nextArticleTarget(arts, 'zz')).toBeNull();
    expect(nextArticleTarget([{ id: 'only' }], 'only')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/test/extractionNextArticle.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `frontend/lib/extraction/worklistNav.ts`:**

```ts
/** Next-in-order article id, or null at end-of-queue / unknown current. */
export function nextArticleTarget(
  articles: { id: string }[],
  currentId: string,
): string | null {
  const idx = articles.findIndex((a) => a.id === currentId);
  if (idx < 0 || idx >= articles.length - 1) return null;
  return articles[idx + 1].id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/test/extractionNextArticle.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Mark-ready handler in `ExtractionFullScreen.tsx`.**
Remove `handleReconcile` and `handleSubmitForReview`'s use as a transition arg
(keep `ensureReviewStage`; `handleSubmitForReview` may stay if referenced, else
delete). Add, after `handleReconcile`'s old position:

```tsx
  // "Mark ready" — flush + ensure review + advance to consensus, then open the
  // next article (next in worklist order; end-of-queue → back to the list).
  // Available to every extractor: /runs/{id}/advance is membership-gated.
  const onMarkReady = async () => {
    if (!activeRunId) return;
    await ensureReviewStage();
    const ok = await advanceMutation
      .mutateAsync({ target_stage: 'consensus' })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    const nextId = nextArticleTarget(articles, articleId ?? '');
    if (nextId) {
      navigate(`/projects/${projectId}/extraction/${nextId}`);
    } else {
      navigate(`/projects/${projectId}?tab=extraction`);
    }
  };
```

Add the import at the top: `import { nextArticleTarget } from '@/lib/extraction/worklistNav';`
and `import { useSidebar } from '@/contexts/SidebarContext';`.

Read the sidebar state near the other hooks:

```tsx
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
```

- [ ] **Step 6: Update the transition build** (replace the `onSubmit`/`onReconcile`
args):

```tsx
  const transition = buildExtractionTransition({
    stage,
    canResolveConflicts: permissions.canResolveConflicts,
    isComplete,
    completed: completedFields,
    total: totalFields,
    onMarkReady,
    onFinalize: handleFinalize,
    onGuide,
  });
```

- [ ] **Step 7: Pass sidebar props to the header** (in the `<ExtractionHeader ... />`):

```tsx
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
```

- [ ] **Step 8: Change the page root height.** Replace the outer
`<div className="h-screen flex flex-col bg-background">` with
`<div className="h-full flex flex-col bg-background">`.

- [ ] **Step 9: Update `ExtractionHeader.tsx`.** Add the two optional props to
`ExtractionHeaderProps`:

```tsx
  /** App sidebar collapse state + toggle (focus-shell wiring for ⌘B). */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
```

Destructure them in the component, render the SidebarToggle as the first child of
`RunHeader.Left`, add `\` + J/K + Esc key handling, replace the ⌘K chip with
`RunHeader.Help`, and move `RunHeader.Save` into `RunHeader.Left`. Concretely:

In the props destructure add `sidebarCollapsed, onToggleSidebar,`.

Add keyboard handling alongside the existing ⌘K effect (extend the same effect's
handler — still cleanup via `return`, no try/finally):

```tsx
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      // ⌘K palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditing) return;
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditing) return;
      // Esc closes the palette
      if (e.key === 'Escape') { setPaletteOpen(false); return; }
      // \ toggles the source panel
      if (e.key === '\\') { e.preventDefault(); onTogglePDF(); return; }
      // J / K next / prev article
      if (articles.length > 1 && (e.key === 'j' || e.key === 'J')) {
        const i = articles.findIndex((a) => a.id === currentArticleId);
        if (i >= 0 && i < articles.length - 1) onNavigateToArticle(articles[i + 1].id);
        return;
      }
      if (articles.length > 1 && (e.key === 'k' || e.key === 'K')) {
        const i = articles.findIndex((a) => a.id === currentArticleId);
        if (i > 0) onNavigateToArticle(articles[i - 1].id);
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [articles, currentArticleId, onNavigateToArticle, onTogglePDF]);
```

Replace the old ⌘K-only effect with the one above (single effect). In the JSX,
make `RunHeader.Left` start with the toggle + move `Save` in:

```tsx
          <RunHeader.Left>
            <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={onToggleSidebar} />
            <RunHeader.Breadcrumb onBack={onBack} crumbs={[{ label: projectName, onClick: () => navigate(`/projects/${props.projectId}`) }, { label: articleTitle }]} />
            {articles.length > 1 && (
              <RunHeader.Worklist articles={articles} currentId={currentArticleId} onNavigate={onNavigateToArticle} />
            )}
            <RunHeader.Save state={saveState ?? 'idle'} lastSavedAt={lastSavedAt} hidden={stage === 'finalized'} />
            {stage != null && <RunHeader.StageRail />}
          </RunHeader.Left>
```

In `RunHeader.Right`, **remove** the ⌘K `<button>` chip and the old
`RunHeader.Save`, and add `RunHeader.Help` before the Menu; keep AIActions,
PrimaryAction, PanelToggle (rightmost), Menu. Final order:

```tsx
          <RunHeader.Right>
            <RunHeader.AIActions
              pendingCount={aiPendingCount}
              canExtract={!!(canRunAI && onExtractWithAI)}
              extracting={extractingAI}
              onExtract={onExtractWithAI ?? (() => {})}
              onOpenSuggestions={props.onAISuggestionsClick}
            />
            <RunHeader.PrimaryAction />
            <span className="mx-1 h-5 w-px bg-border/60" aria-hidden="true" />
            <RunHeader.Help />
            <RunHeader.Menu>
              {hasComparison && (
                <RunHeader.MenuItem onSelect={() => onViewModeChange(viewMode === 'compare' ? 'extract' : 'compare')}>
                  {t('extraction', 'runHeaderCompareToggle')}
                </RunHeader.MenuItem>
              )}
              {canReopen && (
                <RunHeader.MenuItem onSelect={() => onReopen?.()}>
                  {reopening ? t('extraction', 'runHeaderReopening') : t('extraction', 'runHeaderReopenForRevision')}
                </RunHeader.MenuItem>
              )}
            </RunHeader.Menu>
            <RunHeader.PanelToggle pressed={showPDF} onToggle={onTogglePDF} />
          </RunHeader.Right>
```

- [ ] **Step 10: Typecheck + run the affected unit tests**

Run: `npm run typecheck`
Expected: clean (Task 5's caller error resolved).
Run: `npm run test:run -- frontend/test/extractionNextArticle.test.ts frontend/test/stageTransition.test.ts`
Expected: PASS.

- [ ] **Step 11: Run the compiler bailout check**

Run: `node scripts/enumerate_compiler_bailouts.mjs`
Expected: no new bailouts vs. baseline.

- [ ] **Step 12: Commit**

```bash
git add frontend/components/extraction/ExtractionHeader.tsx frontend/pages/ExtractionFullScreen.tsx frontend/lib/extraction/worklistNav.ts frontend/test/extractionNextArticle.test.ts
git commit -m "feat(extraction): Mark-ready advances + opens next article; sidebar/help/keys wired"
```

---

### Task 12: `QualityAssessmentFullScreen` — SidebarToggle + h-full

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`
- Modify: `frontend/components/assessment/AssessmentShell.tsx` (only if its root
  is `h-screen` — change to `h-full` to fit the shell main)
- Test: `frontend/test/QualityAssessmentFullScreen.test.tsx` (keep green; wrap
  renders in the shell's providers if needed)

**Interfaces:**
- Consumes: `useSidebar` (shell), `RunHeader.SidebarToggle`.

- [ ] **Step 1: Read `AssessmentShell.tsx`.** If the outermost element uses
`h-screen`, change it to `h-full` so it fills `RunWorkspaceShell`'s `main`. (If it
already uses `h-full`/flex-fill, no change.)

- [ ] **Step 2: Wire the SidebarToggle.** In `QualityAssessmentFullScreen.tsx`,
add `import { useSidebar } from "@/contexts/SidebarContext";` and, near the other
hooks, `const { sidebarCollapsed, toggleSidebar } = useSidebar();`. In the header
JSX, make `RunHeader.Left` start with:

```tsx
        <RunHeader.Left>
          <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={toggleSidebar} />
          <RunHeader.Breadcrumb
            onBack={() => navigate(`/projects/${projectId}`)}
            crumbs={[{ label: template?.name ?? "" }]}
          />
          {/* ...existing QA badge / version / StageRail... */}
```

In `RunHeader.Right`, add `<RunHeader.Help />` before `RunHeader.Menu` and make
`RunHeader.PanelToggle` the **last** child (rightmost). Move
`RunHeader.Save` out of Right into Left (after the StageRail) to match the shared
layout (decision E):

```tsx
          {runStage != null && <RunHeader.StageRail />}
          <RunHeader.Save state={saveState ?? "idle"} lastSavedAt={lastSavedAt ?? null} hidden={!session || finalized} />
        </RunHeader.Left>
```

and Right becomes:

```tsx
        <RunHeader.Right>
          <RunHeader.AIActions
            pendingCount={Object.keys(aiSuggestions).length}
            canExtract={!!(session && !finalized)}
            extracting={extractingAI}
            onExtract={onExtractWithAI}
          />
          <RunHeader.PrimaryAction />
          <span className="mx-1 h-5 w-px bg-border/60" aria-hidden="true" />
          <RunHeader.Help />
          <RunHeader.Menu>
            {/* ...existing compare/reopen items... */}
          </RunHeader.Menu>
          <RunHeader.PanelToggle pressed={pdfPanelState.isOpen} onToggle={pdfPanelState.toggle} />
        </RunHeader.Right>
```

Wire `\` to toggle the PDF panel via a small effect in the page (no J/K — QA has
no worklist):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '\\') { e.preventDefault(); pdfPanelState.toggle(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pdfPanelState]);
```

- [ ] **Step 3: Keep the QA page test green.** `frontend/test/QualityAssessmentFullScreen.test.tsx`
renders the page inside a `MemoryRouter`. Because the page now calls `useSidebar`,
wrap the rendered route in `<SidebarProvider>` (import from
`@/contexts/SidebarContext`) in that test's render helper. Run:

Run: `npm run test:run -- frontend/test/QualityAssessmentFullScreen.test.tsx`
Expected: PASS (after wrapping in `SidebarProvider`).

- [ ] **Step 4: Typecheck + bailouts**

Run: `npm run typecheck && node scripts/enumerate_compiler_bailouts.mjs`
Expected: clean; no new bailouts.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/QualityAssessmentFullScreen.tsx frontend/components/assessment/AssessmentShell.tsx frontend/test/QualityAssessmentFullScreen.test.tsx
git commit -m "feat(qa): adopt SidebarToggle + help + h-full inside the focus shell"
```

---

### Task 13: Remove dead copy + retire misleading strings

**Files:**
- Modify: `frontend/lib/copy/runs.ts`
- Modify: `frontend/lib/copy/extraction.ts`

**Interfaces:** none (cleanup). Only run once Tasks 5/11/12 removed all callers.

- [ ] **Step 1: Confirm no references remain.**

Run: `grep -rn "runHeaderSubmitForReview\|runHeaderReconcile\|submitForReview\|'reconcile'\|\"reconcile\"" frontend`
Expected: only copy-definition lines (no consumers). If a consumer remains, stop
and fix it first.

- [ ] **Step 2: Remove the keys.** Delete `runHeaderSubmitForReview` and
`runHeaderReconcile` from `extraction.ts`. In `runs.ts`, remove `submitForReview`
and `reconcile` (keep `finalize` — QA uses it). Remove the now-unused
`gateRemaining` key only if `grep -rn "gateRemaining" frontend` shows no
consumers.

- [ ] **Step 3: Guard against the banned string** — confirm the copy-vocabulary
guard still passes and nothing reintroduces "Submit for review":

Run: `npm run test:run -- frontend/test/copyRuns.test.ts frontend/test/copy-run-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean (no dangling key references).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/copy/runs.ts frontend/lib/copy/extraction.ts
git commit -m "chore(copy): retire Submit-for-review / Reconcile strings"
```

---

### Task 14: Docs — DB-stage vs user-phase glossary

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md`
- Modify: `docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md`

**Interfaces:** none. **Do NOT** edit
`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` (frozen).

- [ ] **Step 1: Add a glossary block** to `extraction-hitl-architecture.md`
after §2.1 (the "do not leak Run" section), e.g. a new subsection:

```markdown
### 2.2 Stage (DB) vs user-facing phase

The `extraction_run_stage` values (`pending` / `proposal` / `review` /
`consensus` / `finalized` / `cancelled`) are the **internal lifecycle**, not the
model end users see. The UI presents **three phases**:

| User-facing phase | DB stage(s) |
| --- | --- |
| **Extract** | `pending`, `proposal`, `review` |
| **Consensus** | `consensus` |
| **Finalized** | `finalized` |

`review` is **not peer review**: it means *reviewing the AI suggestions within
one's OWN extraction*, reached via an invisible `proposal → review` auto-advance
(`useAutoAdvanceToReview`) the instant the run has content. The header folds
`proposal`+`review` into a single **Extract** node (see
`docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md`).
```

- [ ] **Step 2: Update the 2026-06-19 spec notes.** In
`2026-06-19-extraction-view-ux-design.md`, where it surfaces raw DB stage names
in user-facing prose ("Reconcile (advance to consensus)", "Submit for review",
the four-node rail), add a short reconciliation note pointing at the
2026-06-20 design and the Extract → Consensus → Finalized vocabulary. Do **not**
rewrite the spec body; a dated note is enough, e.g.:

```markdown
> **Superseded 2026-06-20 (header):** the stage rail is now 3 user-facing nodes
> (Extract → Consensus → Finalized); "Submit for review"/"Reconcile" are replaced
> by a single role/phase-aware "Mark ready →" / "Finalize". See
> `docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md`.
```

- [ ] **Step 3: Verify docs build locally (markdown lint scoped).**

Run: `grep -n "Stage (DB) vs user-facing\|Superseded 2026-06-20" docs/reference/extraction-hitl-architecture.md docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md`
Expected: both edits present.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/extraction-hitl-architecture.md docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md
git commit -m "docs(extraction): distinguish DB stage from user-facing phase; reconcile UX notes"
```

---

### Task 15: Full verification gate + design review

**Files:** none (verification). Add the plan doc to `.markdownlintignore` if
docs-ci flags it.

- [ ] **Step 1: Add plan to `.markdownlintignore`.** Append under the in-flight
plans block:

```
docs/superpowers/plans/2026-06-20-extraction-header-refinement.md
```

Commit: `git add .markdownlintignore && git commit -m "chore(docs): ignore in-flight header-refinement plan"`

- [ ] **Step 2: Full frontend gate.**

Run: `npm run typecheck`
Run: `npm run lint`
Run: `npm run test:run`
Run: `node scripts/enumerate_compiler_bailouts.mjs`
Expected: all clean; no new compiler bailouts.

- [ ] **Step 3: Frontend E2E (local).** Ensure the local stack + CHARMS seed are
present, then:

Run: `npm run test:e2e:local`
Expected: green — especially the extraction route inside the new shell (sidebar
collapsed, `run-stage-current` / "Finalized" / "Run stage" selectors intact). If
a selector broke, fix the consumer (not the test) and re-run.

- [ ] **Step 4: Design review.** With the local stack running, review the route:

Run: `/design-review /projects/:projectId/extraction/:articleId`
Confirm: one-line bar at all widths (labels collapse to icons), mirrored ⌘B/`\`
toggles bracketing the bar, transient Saved by the title, "?" panel opens, ⋮ menu
intact, sidebar collapsed-by-default and ⌘B expands it. Fix any visual diffs and
re-screenshot.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(extraction): green CI + design review for header refinement"
```

---

## Self-Review

**Spec coverage:** A→Tasks 2,3; B→Tasks 4,5,11; C→Tasks 5,11 (+ Reviewers/RoleChip
already gate on stage/blind); D→Tasks 3,6,11,12 + shell Task 10; E→Task 7,11,12;
F→Tasks 8,11,12; G→Tasks 8,9; ⌘B real sidebar→Tasks 6,10,11,12; copy→Tasks 1,13;
docs→Task 14; tests→every task + Task 15. ✅

**Type consistency:** `onMarkReady` (Tasks 5, 11); `StageKey` `extract|consensus|
finalized` (Tasks 2, 3); `tooltip?` on `StageTransition` (Tasks 4, 5); `SidebarToggle`
props `{ pressed?, onToggle? }` (Tasks 6, 11, 12); `nextArticleTarget` (Tasks 11).
✅

**Deferred (no silent cap):** status-aware "next not-yet-ready" article ships as
next-in-order (§10 of the spec; commented in `worklistNav.ts`/handler).
