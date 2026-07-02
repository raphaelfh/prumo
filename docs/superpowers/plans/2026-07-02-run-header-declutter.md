---
status: draft
last_reviewed: 2026-07-02
owner: '@raphaelfh'
---

# Run-Header Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded run-header (StageRail + Reviewers + RoleChip +
inline helper + two-state AI button) with a unified `RunHeader.RunStatus`
cluster (stage chip + reviewer avatars + one status popover), a single AI
actions menu, a clean primary action, and an article-title-only breadcrumb —
on both run screens, one atomic PR.

**Architecture:** New `RunStatus` leaf reads everything from the existing
`RunHeaderContext` (zero new context fields). `StageRail`/`Reviewers`/
`RoleChip` are deleted in the same PR (atomic swap). Terminology renames ride
through `lib/copy` + `stageTransition`/`qaTransition` label keys. Spec:
`docs/superpowers/specs/2026-07-02-run-header-declutter-design.md`.

**Tech Stack:** React 19 + TS strict, Radix (Popover/DropdownMenu/Tooltip)
via shadcn, Tailwind container queries (`@container/headerbar`), vitest + RTL,
Playwright e2e, in-house copy lib (`t('ns','key')`).

## Global Constraints

- English-only copy; ALL user-facing strings via `frontend/lib/copy/` (never
  hardcoded in components).
- React Compiler `panicThreshold: all_errors`: no `try/finally` or `throw`
  inside component/hook bodies.
- Icon-only buttons: shadcn `Tooltip` (`TooltipTrigger asChild`) + `aria-label`
  (worktree frontend rule).
- Frontend tooling runs from the **repo root** (`npm run test:run`, vitest);
  never `cd frontend`.
- ADR-0015 transition *semantics* unchanged — labels only.
- Always-mounted header DOM must NOT match `/read-only/i` or `/required left/i`
  on a finalized run (#472 single-match test queries). Popover/tooltip content
  is unmounted while closed — safe there.
- File-size fitness baselines: `ExtractionFullScreen.tsx` ≤ 1307 lines,
  `QualityAssessmentFullScreen.tsx` ≤ 824 lines (ratchet consciously if
  exceeded, in `scripts/fitness/check_file_size.baseline`).
- `data-testid="run-stage-current"` must survive on the chip with the current
  stage label as visible text (e2e continuity: `qa-flow`, `extraction-reopen`).
- Conventional commits; commit after every task.

---

### Task 1: Copy foundation — relabels, new keys, transition key renames

**Files:**
- Modify: `frontend/lib/copy/runs.ts`
- Modify: `frontend/lib/copy/extraction.ts` (RunHeader block, lines ~546-560)
- Modify: `frontend/lib/extraction/stageTransition.ts`
- Modify: `frontend/test/copyRuns.test.ts`
- Modify: `frontend/test/stageTransition.test.ts`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces (later tasks rely on these EXACT key names in the `runs`
  namespace): `stagePending`, `stageCancelled`, `stageAssessment`,
  `stageExplainExtract`, `stageExplainExtractArbiter`,
  `stageExplainConsensus`, `stageExplainConsensusArbiter`,
  `stageExplainFinalized`, `runStatusLabel`, `runStatusChipLabel`,
  `statusRequiredFields`, `statusViewDivergence`, `statusYouReviewAs`,
  `statusRevisionNote`, `aiActionsLabel`, `reviewPendingSuggestions`,
  `viewRunStatus`, `glossaryAssessment`; and in `extraction`:
  `runHeaderFinishExtraction`, `runHeaderFinishExtractionTooltip`,
  `runHeaderExtractionFinished`, `runHeaderStartConsensus`,
  `runHeaderStartConsensusTooltip`.

- [ ] **Step 1: Update the copy tests first (failing)**

In `frontend/test/copyRuns.test.ts` replace the two stage/primary-action
assertions:

```ts
  it('resolves the new 3-node + help + sidebar keys', () => {
    expect(t('runs', 'stageExtract')).toBe('Extraction');
    expect(t('runs', 'stageAssessment')).toBe('Assessment');
    expect(t('runs', 'stagePending')).toBe('Pending');
    expect(t('runs', 'stageCancelled')).toBe('Cancelled');
    expect(t('runs', 'stageExplainExtract')).not.toBe('');
    expect(t('runs', 'stageExplainExtractArbiter')).not.toBe('');
    expect(t('runs', 'stageExplainConsensus')).not.toBe('');
    expect(t('runs', 'stageExplainConsensusArbiter')).not.toBe('');
    expect(t('runs', 'stageExplainFinalized')).not.toBe('');
    expect(t('runs', 'sidebarToggle')).not.toBe('');
    expect(t('runs', 'helpTitle')).not.toBe('');
    expect(t('runs', 'shortcutPalette')).not.toBe('');
    expect(t('runs', 'glossaryExtract')).toContain('Extraction');
    expect(t('runs', 'glossaryAssessment')).toContain('Assessment');
  });

  it('resolves the new extraction primary-action keys', () => {
    expect(t('extraction', 'runHeaderFinishExtraction')).toBe('Finish extraction');
    expect(t('extraction', 'runHeaderExtractionFinished')).toBe('Extraction finished');
    expect(t('extraction', 'runHeaderStartConsensus')).toBe('Start consensus');
    expect(t('extraction', 'runHeaderFinishExtractionTooltip')).not.toBe('');
    expect(t('extraction', 'runHeaderFinalizeTooltip')).not.toBe('');
  });
```

In `frontend/test/stageTransition.test.ts` update the key-id assertions
(lines 32, 33, 42, 52, 53) to the renamed keys:

```ts
    expect(r!.label).toBe('runHeaderFinishExtraction');      // was runHeaderMarkReady
    expect(r!.tooltip).toBe('runHeaderFinishExtractionTooltip');
    // isReady flip:
    expect(r!.label).toBe('runHeaderExtractionFinished');    // was runHeaderMarkedReady
    // manager extract:
    expect(r!.label).toBe('runHeaderStartConsensus');        // was runHeaderOpenConsensus
    expect(r!.tooltip).toBe('runHeaderStartConsensusTooltip');
```

(`runHeaderApproveFinalize` assertions at lines 74-75 stay unchanged.)

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run frontend/test/copyRuns.test.ts frontend/test/stageTransition.test.ts`
Expected: FAIL — unknown keys / value mismatches.

- [ ] **Step 3: Update `frontend/lib/copy/runs.ts`**

Replace the StageRail block (lines 8-22) and the glossary lines, add the new
RunStatus/AI keys. Final shape of the touched regions:

```ts
  // Stage vocabulary (RunStatus chip + status-popover timeline).
  revision: 'Revision',
  stageExtract: 'Extraction',
  stageAssessment: 'Assessment',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
  stagePending: 'Pending',
  stageCancelled: 'Cancelled',
  // Timeline per-node STATE, appended to each node's accessible name so the
  // state a sighted user reads from the icon is also announced to assistive tech.
  stageStateDone: 'completed',
  stageStateCurrent: 'current step',
  stageStateUpcoming: 'upcoming',
  stageStateLocked: 'locked',
  stageStateCancelled: 'cancelled',
  // Status-popover timeline explainers — two voices (reviewer vs arbitrator).
  stageExplainExtract: 'Fill in your answers independently; other reviewers stay hidden.',
  stageExplainExtractArbiter: 'Reviewers work independently; start consensus when they are ready.',
  stageExplainConsensus: 'The manager reconciles differences and approves.',
  stageExplainConsensusArbiter: 'Resolve divergences, then approve and publish.',
  stageExplainFinalized: 'Published values, read-only — reopen to edit.',
  // RunStatus chip + popover chrome
  runStatusLabel: 'Run status',
  runStatusChipLabel: 'Run status: {{stage}}',
  statusRequiredFields: '{{done}} of {{total}} required fields',
  statusViewDivergence: 'View',
  statusYouReviewAs: 'You review as {{role}}',
  statusRevisionNote: 'This run is a revision of a published version.',
  // PrimaryAction
  requiredOfTotal: '{{done}} of {{total}} required',
```

(keep `finalize`, `gateBlocked`, `reviewersDiffer`, `reviewersReadyHint`,
`reviewersOfExpected`, `blindSuffix`, `revealedSuffix`, `reveal`,
`blindExplainer` unchanged — the popover reuses them; delete the now-dead
`stageExtractTooltip`/`stageConsensusTooltip`/`stageFinalizedTooltip` keys —
the explainers replace them).

In the AIActions block add:

```ts
  // AIActions (single menu button)
  extractWithAI: 'Extract with AI',
  extractingWithAI: 'Extracting with AI…',
  aiActionsLabel: 'AI actions',
  reviewPendingSuggestions: 'Review {{n}} pending suggestions',
```

In the CommandPalette block add:

```ts
  viewRunStatus: 'View run status',
```

Update the glossary:

```ts
  glossaryExtract: 'Extraction — fill the form and review AI suggestions.',
  glossaryAssessment: 'Assessment — answer the signaling questions and review AI suggestions.',
  glossaryConsensus: 'Consensus — reconcile diverging reviewer values.',
  glossaryFinalize: 'Finalize — lock and publish the agreed values.',
```

- [ ] **Step 4: Update `frontend/lib/copy/extraction.ts` RunHeader block**

Replace the five renamed keys (keep the others):

```ts
    // RunHeader (extraction-specific keys — shared header keys now live in the runs namespace)
    runHeaderFinishExtraction: 'Finish extraction',
    runHeaderFinishExtractionTooltip: 'Signal that you are done extracting this article and open the next one.',
    runHeaderExtractionFinished: 'Extraction finished',
    runHeaderStartConsensus: 'Start consensus',
    runHeaderStartConsensusTooltip: 'Move this article into consensus for review and publishing.',
```

(delete `runHeaderMarkReady`, `runHeaderMarkReadyTooltip`,
`runHeaderMarkedReady`, `runHeaderOpenConsensus`,
`runHeaderOpenConsensusTooltip`; keep `runHeaderApproveFinalize*`,
`runHeaderFinalize*`, `runHeaderGateBlocked`, `runHeaderCompareToggle`,
`runHeaderReopenForRevision`, `runHeaderReopening`.)

- [ ] **Step 4b: Make the Help glossary kind-aware**

`frontend/components/runs/header/Help.tsx` renders a static `GLOSSARY` array
(lines 16-22) that includes `'glossaryExtract'`. The Help body mounts inside
the RunHeader compound, so `useRunHeader()` is available. In the component
that maps the GLOSSARY keys, pick the extract entry by kind:

```tsx
  const { kind } = useRunHeader();
  const glossaryKeys = GLOSSARY.map((k) =>
    k === 'glossaryExtract' && kind === 'qa' ? ('glossaryAssessment' as const) : k,
  );
```

and map over `glossaryKeys` instead of `GLOSSARY`. Extend the union type on
the GLOSSARY constant with `'glossaryAssessment'`. Update
`__tests__/Help.test.tsx` if it snapshots the glossary text (mechanical).

- [ ] **Step 5: Update `frontend/lib/extraction/stageTransition.ts` key references**

Lines 71-72 and 81-82 — swap the `t()` key names only (logic untouched):

```ts
        label: t('extraction', 'runHeaderStartConsensus'),
        tooltip: t('extraction', 'runHeaderStartConsensusTooltip'),
```

```ts
      isReady ? t('extraction', 'runHeaderExtractionFinished') : t('extraction', 'runHeaderFinishExtraction'),
      t('extraction', 'runHeaderFinishExtractionTooltip'),
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run frontend/test/copyRuns.test.ts frontend/test/stageTransition.test.ts`
Expected: PASS. (Other suites still reference old keys — they are updated in
their own tasks; do NOT run the full suite yet.)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/copy/runs.ts frontend/lib/copy/extraction.ts frontend/lib/extraction/stageTransition.ts frontend/test/copyRuns.test.ts frontend/test/stageTransition.test.ts
git commit -m "feat(runs): stage/action terminology — Finish extraction, Start consensus, Extraction/Assessment + status-popover copy"
```

---

### Task 2: `stage.ts` — chipState + pending-truthful timeline

**Files:**
- Modify: `frontend/components/runs/header/stage.ts`
- Test: `frontend/components/runs/header/__tests__/stage.test.ts`

**Interfaces:**
- Produces: `chipState(stage: ExtractionRunStage | null): ChipState` where
  `type ChipState = 'pending' | 'extract' | 'consensus' | 'finalized' | 'cancelled'`;
  `stageNodeStates(stage)` now returns all-`future` nodes for
  `pending`/`null` (no `current` node). Task 3 consumes both.

- [ ] **Step 1: Extend the failing tests**

Append to `frontend/components/runs/header/__tests__/stage.test.ts`:

```ts
import { chipState, stageNodeStates } from '../stage';

describe('chipState', () => {
  it('maps stages to chip states, pending-truthful', () => {
    expect(chipState(null)).toBe('pending');
    expect(chipState('pending')).toBe('pending');
    expect(chipState('extract')).toBe('extract');
    expect(chipState('consensus')).toBe('consensus');
    expect(chipState('finalized')).toBe('finalized');
    expect(chipState('cancelled')).toBe('cancelled');
  });
});

describe('stageNodeStates pending', () => {
  it('renders no current node for pending/null (run not editable yet)', () => {
    for (const s of ['pending', null] as const) {
      const nodes = stageNodeStates(s as never);
      expect(nodes.every((n) => n.state === 'future')).toBe(true);
    }
  });
  it('extract is current only for the extract stage', () => {
    expect(stageNodeStates('extract')[0].state).toBe('current');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run frontend/components/runs/header/__tests__/stage.test.ts`
Expected: FAIL — `chipState` not exported; pending maps to current today.

- [ ] **Step 3: Implement in `stage.ts`**

```ts
export type ChipState = 'pending' | 'extract' | 'consensus' | 'finalized' | 'cancelled';

/**
 * Stage-truthful chip state: pending/null is its OWN state (the run is not
 * editable yet — #472 renders it read-only), never disguised as Extract.
 */
export function chipState(stage: ExtractionRunStage | null): ChipState {
  switch (stage) {
    case 'extract':
    case 'consensus':
    case 'finalized':
    case 'cancelled':
      return stage;
    default:
      return 'pending';
  }
}
```

And make `stageNodeStates` pending-aware — replace `uiIndex` usage:

```ts
function uiIndex(stage: ExtractionRunStage | null): number | null {
  switch (stage) {
    case 'extract':
      return 0;
    case 'consensus':
      return 1;
    case 'finalized':
      return 2;
    default:
      // pending / null — the run has not entered an editable stage yet.
      return null;
  }
}

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, state: 'cancelled' as const }));
  }
  const currentIndex = uiIndex(stage);
  return ORDER.map((key, i) => ({
    key,
    state:
      currentIndex == null
        ? 'future'
        : i < currentIndex
          ? 'done'
          : i === currentIndex
            ? 'current'
            : 'future',
  }));
}
```

- [ ] **Step 4: Run to verify pass** — same command, expected PASS. Existing
  `stage.test.ts` cases asserting pending→current must be updated to the new
  truth in the same edit if present.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/stage.ts frontend/components/runs/header/__tests__/stage.test.ts
git commit -m "feat(runs): stage-truthful chipState + pending-aware timeline"
```

---

### Task 3: `RunStatus` component (chip + avatars + status popover)

**Files:**
- Create: `frontend/components/runs/header/RunStatus.tsx`
- Test: `frontend/components/runs/header/__tests__/RunStatus.test.tsx`

**Interfaces:**
- Consumes: `useRunHeader()` (all fields), `chipState`/`stageNodeStates`
  (Task 2), copy keys (Task 1).
- Produces: `export function RunStatus(props: { open?: boolean; onOpenChange?: (o: boolean) => void })`
  — optionally controlled popover (Task 7 wires it as `RunHeader.RunStatus`;
  Task 9 controls it from the Cmd-K palette). Testids:
  `run-stage-current` (chip, with `data-stage`), `run-status-reviewers`
  (avatar button), `run-status-divergent` (amber dot),
  `run-status-popover` (content root).

- [ ] **Step 1: Write the failing test matrix**

`frontend/components/runs/header/__tests__/RunStatus.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
import type { RunHeaderValue } from '@/components/runs/header';

vi.mock('@/lib/copy', () => ({
  t: (_n: string, k: string) => k,
}));

const base: RunHeaderValue = {
  kind: 'extraction', stage: 'extract', isRevision: false,
  role: 'reviewer', isBlind: true, canReveal: false,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 2, divergent: 0 },
  transition: null,
};

function renderStatus(value: Partial<RunHeaderValue>) {
  return render(
    <RunHeader value={{ ...base, ...value }}>
      <RunHeader.Center><RunHeader.RunStatus /></RunHeader.Center>
    </RunHeader>,
  );
}

describe('RunStatus chip', () => {
  it('shows the kind-aware current stage with the e2e testid', () => {
    renderStatus({ stage: 'extract' });
    const chip = screen.getByTestId('run-stage-current');
    expect(chip).toHaveTextContent('stageExtract');
    expect(chip).toHaveAttribute('data-stage', 'extract');
  });
  it('QA runs label the extract stage as Assessment', () => {
    renderStatus({ kind: 'qa', stage: 'extract' });
    expect(screen.getByTestId('run-stage-current')).toHaveTextContent('stageAssessment');
  });
  it('pending is its own muted state, never Extraction', () => {
    renderStatus({ stage: null });
    const chip = screen.getByTestId('run-stage-current');
    expect(chip).toHaveTextContent('stagePending');
    expect(chip).toHaveAttribute('data-stage', 'pending');
  });
  it('finalized reads Finalized (e2e text contract)', () => {
    renderStatus({ stage: 'finalized' });
    expect(screen.getByTestId('run-stage-current')).toHaveTextContent('stageFinalized');
  });
});

describe('RunStatus popover', () => {
  it('opens from the chip: timeline + progress + reviewers', async () => {
    renderStatus({ stage: 'extract' });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).toHaveTextContent('stageExplainExtract');       // reviewer voice
    expect(pop).toHaveTextContent('statusRequiredFields');
    expect(pop).toHaveTextContent('reviewersOfExpected');
    expect(pop).toHaveTextContent('statusYouReviewAs');
  });
  it('arbitrator voice + divergence View for managers', async () => {
    const onJump = vi.fn();
    renderStatus({ role: 'manager', reviewers: { count: 2, required: 2, divergent: 3 }, onJumpToDivergence: onJump });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).toHaveTextContent('stageExplainExtractArbiter');
    await userEvent.click(screen.getByRole('button', { name: 'statusViewDivergence' }));
    expect(onJump).toHaveBeenCalledOnce();
  });
  it('reviewers never see divergence rows or the amber dot', async () => {
    renderStatus({ role: 'reviewer', reviewers: { count: 2, required: 2, divergent: 3 } });
    expect(screen.queryByTestId('run-status-divergent')).toBeNull();
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).not.toHaveTextContent('reviewersDiffer');
  });
  it('avatar button opens the same popover; amber dot for arbitrators', async () => {
    renderStatus({ role: 'consensus', reviewers: { count: 3, required: 2, divergent: 1 } });
    expect(screen.getByTestId('run-status-divergent')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('run-status-reviewers'));
    expect(await screen.findByTestId('run-status-popover')).toBeInTheDocument();
  });
  it('no avatars when there are no reviewers', () => {
    renderStatus({ reviewers: { count: 0, required: 0, divergent: 0 } });
    expect(screen.queryByTestId('run-status-reviewers')).toBeNull();
  });
  it('blind reveal lives in the popover when canReveal', async () => {
    const onReveal = vi.fn();
    renderStatus({ role: 'manager', isBlind: true, canReveal: true, onReveal });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    await userEvent.click(await screen.findByRole('button', { name: 'reveal' }));
    expect(onReveal).toHaveBeenCalledOnce();
  });
  it('revision note renders when isRevision', async () => {
    renderStatus({ isRevision: true });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('statusRevisionNote');
  });
  it('finalized explainer bridges to the published banner vocabulary', async () => {
    renderStatus({ stage: 'finalized' });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('stageExplainFinalized');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run frontend/components/runs/header/__tests__/RunStatus.test.tsx`
Expected: FAIL — `RunHeader.RunStatus` is not defined (Task 7 attaches it;
for THIS task import `{ RunStatus }` from `../RunStatus` directly in the test
and render it inside `<RunHeader …>` children — adjust the test to
`<RunStatus />` until Task 7 flips it to the compound form).

- [ ] **Step 3: Implement `RunStatus.tsx`**

```tsx
import { useState } from 'react';
import { ChevronDown, Circle, CircleCheck, GitFork, ListChecks, Lock, UserRound } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';
import { chipState, stageNodeStates, type ChipState, type StageKey, type StageNode } from './stage';

const AVATAR = ['bg-reviewer-1', 'bg-reviewer-2', 'bg-reviewer-3', 'bg-reviewer-4', 'bg-reviewer-5'];

const DOT_BG: Record<ChipState, string> = {
  pending: 'bg-muted-foreground/50',
  extract: 'bg-info',
  consensus: 'bg-info',
  finalized: 'bg-success',
  cancelled: 'bg-destructive',
};

const CHIP_COPY: Record<ChipState, 'stagePending' | 'stageExtract' | 'stageAssessment' | 'stageConsensus' | 'stageFinalized' | 'stageCancelled'> = {
  pending: 'stagePending',
  extract: 'stageExtract', // extraction; QA overridden to stageAssessment below
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
  cancelled: 'stageCancelled',
};

const NODE_COPY: Record<StageKey, 'stageExtract' | 'stageConsensus' | 'stageFinalized'> = {
  extract: 'stageExtract',
  consensus: 'stageConsensus',
  finalized: 'stageFinalized',
};

const STATE_COPY: Record<StageNode['state'], 'stageStateDone' | 'stageStateCurrent' | 'stageStateUpcoming' | 'stageStateCancelled'> = {
  done: 'stageStateDone',
  current: 'stageStateCurrent',
  future: 'stageStateUpcoming',
  cancelled: 'stageStateCancelled',
};

function NodeIcon({ node }: { node: StageNode }) {
  if (node.state === 'done') return <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  if (node.state === 'current') return <span className="mx-[3.5px] h-[7px] w-[7px] rounded-full bg-info" aria-hidden="true" />;
  if (node.key === 'finalized') return <Lock className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />;
  return <Circle className={cn('h-3.5 w-3.5', node.state === 'cancelled' ? 'text-destructive' : 'text-muted-foreground/50')} aria-hidden="true" />;
}

export function RunStatus({ open, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const { kind, stage, isRevision, role, isBlind, canReveal, onReveal, progress, reviewers, onJumpToDivergence } = useRunHeader();
  const [uncontrolled, setUncontrolled] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : uncontrolled;
  const setOpen = (o: boolean) => {
    onOpenChange?.(o);
    if (!isControlled) setUncontrolled(o);
  };

  const cs = chipState(stage);
  const chipKey = cs === 'extract' && kind === 'qa' ? 'stageAssessment' : CHIP_COPY[cs];
  const chipLabel = t('runs', chipKey);
  const isArbiter = role === 'manager' || role === 'consensus';
  const nodes = stageNodeStates(stage);
  const showAvatars = reviewers.count > 0;
  const shown = Math.min(reviewers.count, 3);
  const showDivergent = isArbiter && reviewers.divergent > 0;
  const explainFor = (key: StageKey): string => {
    if (key === 'finalized') return t('runs', 'stageExplainFinalized');
    if (key === 'consensus') return t('runs', isArbiter ? 'stageExplainConsensusArbiter' : 'stageExplainConsensus');
    return t('runs', isArbiter ? 'stageExplainExtractArbiter' : 'stageExplainExtract');
  };
  const reviewersLabel = t('runs', 'reviewersOfExpected')
    .replace('{{count}}', String(reviewers.count))
    .replace('{{required}}', String(reviewers.required));

  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('runs', 'runStatusChipLabel').replace('{{stage}}', chipLabel)}
            data-testid="run-stage-current"
            data-stage={cs}
            className="h-7 shrink-0 gap-1.5 rounded-full border border-border/60 px-2.5 text-[13px] font-medium"
          >
            <span className={cn('h-[7px] w-[7px] rounded-full', DOT_BG[cs])} aria-hidden="true" />
            <span className="hidden @[36rem]/headerbar:inline">{chipLabel}</span>
            <ChevronDown className="hidden h-3 w-3 text-muted-foreground @[36rem]/headerbar:block" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        {showAvatars && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`${reviewersLabel} — ${t('runs', 'runStatusLabel')}`}
            data-testid="run-status-reviewers"
            className="relative hidden shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring @[48rem]/headerbar:flex"
          >
            <span className="flex -space-x-2">
              {Array.from({ length: shown }).map((_, i) => (
                <span key={i} className={cn('h-[18px] w-[18px] rounded-full border-2 border-background', AVATAR[i % AVATAR.length])} aria-hidden="true" />
              ))}
              {reviewers.count > shown && (
                <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{reviewers.count - shown}</span>
              )}
            </span>
            {showDivergent && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning" data-testid="run-status-divergent" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-72 p-0 text-[13px]" aria-label={t('runs', 'runStatusLabel')} data-testid="run-status-popover">
        <ol className="flex flex-col gap-2.5 border-b px-4 py-3">
          {nodes.map((node) => (
            <li key={node.key} className="flex items-start gap-2.5" data-state={node.state}>
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <NodeIcon node={node} />
              </span>
              <span className="min-w-0">
                <span className={cn('font-medium', node.state === 'current' ? 'text-foreground' : 'text-muted-foreground')}>
                  {t('runs', node.key === 'extract' && kind === 'qa' ? 'stageAssessment' : NODE_COPY[node.key])}
                </span>
                <span className="sr-only">
                  {', '}
                  {t('runs', node.key === 'finalized' && node.state === 'future' ? 'stageStateLocked' : STATE_COPY[node.state])}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{explainFor(node.key)}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 px-4 py-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {t('runs', 'statusRequiredFields')
              .replace('{{done}}', String(progress.completed))
              .replace('{{total}}', String(progress.total))}
          </div>
          {showAvatars && (
            <div className="flex items-center gap-2">
              <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                {Array.from({ length: shown }).map((_, i) => (
                  <span key={i} className={cn('h-3.5 w-3.5 rounded-full border border-popover', AVATAR[i % AVATAR.length])} />
                ))}
              </span>
              <span>
                {reviewersLabel}
                {reviewers.ready != null && reviewers.readyTotal != null && (
                  <>
                    {' · '}
                    {t('runs', 'reviewersReadyHint')
                      .replace('{{ready}}', String(reviewers.ready))
                      .replace('{{total}}', String(reviewers.readyTotal))}
                  </>
                )}
              </span>
            </div>
          )}
          {showDivergent && (
            <div className="flex items-center gap-2">
              <GitFork className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.5} aria-hidden="true" />
              {t('runs', 'reviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
              {onJumpToDivergence && (
                <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => { setOpen(false); onJumpToDivergence(); }}>
                  {t('runs', 'statusViewDivergence')}
                </Button>
              )}
            </div>
          )}
          {role && (
            <div className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>
                {t('runs', 'statusYouReviewAs').replace('{{role}}', t('common', ROLE_COPY[role]))}
                {(isBlind || canReveal) && (
                  <>
                    {' · '}
                    {t('runs', isBlind ? 'blindSuffix' : 'revealedSuffix')}
                  </>
                )}
              </span>
              {canReveal && onReveal && (
                <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => { setOpen(false); onReveal(); }}>
                  {t('runs', 'reveal')}
                </Button>
              )}
            </div>
          )}
          {isRevision && (
            <div className="text-xs">{t('runs', 'statusRevisionNote')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ROLE_COPY = {
  manager: 'roleManager',
  reviewer: 'roleReviewer',
  consensus: 'roleConsensus',
  viewer: 'roleViewer',
} as const;
```

(`roleManager`/`roleReviewer`/`roleConsensus`/`roleViewer` already exist in
the `common` namespace — RoleChip uses them today.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run frontend/components/runs/header/__tests__/RunStatus.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/RunStatus.tsx frontend/components/runs/header/__tests__/RunStatus.test.tsx
git commit -m "feat(runs): RunStatus cluster — stage chip + reviewer avatars + unified status popover"
```

---

### Task 4: Rebuild `AIActions` as a single menu button

**Files:**
- Modify: `frontend/components/runs/header/AIActions.tsx` (full rewrite)
- Test: `frontend/components/runs/header/__tests__/AIActions.test.tsx` (create;
  no unit test exists today)

**Interfaces:**
- Consumes: copy keys from Task 1 (`aiActionsLabel`,
  `reviewPendingSuggestions`, `extractWithAI`, `extractingWithAI`,
  `aiPendingSuggestions`).
- Produces: same props interface as today —
  `{ pendingCount: number; canExtract: boolean; extracting?: boolean; onExtract: () => void; onOpenSuggestions?: () => void }`
  (screens keep their call sites; only behavior changes). Testid:
  `run-ai-actions` on the trigger.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AIActions } from '../AIActions';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

function renderAI(props: Partial<Parameters<typeof AIActions>[0]>) {
  return render(
    <TooltipProvider>
      <AIActions pendingCount={0} canExtract={false} onExtract={() => {}} {...props} />
    </TooltipProvider>,
  );
}

describe('AIActions menu', () => {
  it('renders nothing with no available action', () => {
    const { container } = renderAI({});
    expect(container.querySelector('button')).toBeNull();
  });
  it('extract action runs from the menu', async () => {
    const onExtract = vi.fn();
    renderAI({ canExtract: true, onExtract });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'extractWithAI' }));
    expect(onExtract).toHaveBeenCalledOnce();
  });
  it('review item shows the count and calls onOpenSuggestions', async () => {
    const onOpenSuggestions = vi.fn();
    renderAI({ pendingCount: 12, onOpenSuggestions });
    const trigger = screen.getByTestId('run-ai-actions');
    expect(trigger).toHaveTextContent('12');
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /reviewPendingSuggestions/ }));
    expect(onOpenSuggestions).toHaveBeenCalledOnce();
  });
  it('pending count without a real handler renders no review item', async () => {
    renderAI({ canExtract: true, pendingCount: 5, onOpenSuggestions: undefined });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    expect(screen.queryByRole('menuitem', { name: /reviewPendingSuggestions/ })).toBeNull();
  });
  it('extracting state disables the extract item', async () => {
    renderAI({ canExtract: true, extracting: true });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    const item = await screen.findByRole('menuitem', { name: 'extractingWithAI' });
    expect(item).toHaveAttribute('data-disabled');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run frontend/components/runs/header/__tests__/AIActions.test.tsx`

- [ ] **Step 3: Rewrite `AIActions.tsx`**

```tsx
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/copy';

interface AIActionsProps {
  pendingCount: number;
  canExtract: boolean;
  extracting?: boolean;
  onExtract: () => void;
  onOpenSuggestions?: () => void;
}

/**
 * Single home for header AI: one Sparkles trigger (count badge when
 * suggestions are pending) opening a named-action menu. Renders nothing when
 * no action is available — on finalized runs both screens force
 * pendingCount=0 and canExtract=false, so the #472 read-only tests hold.
 * The review item requires a REAL onOpenSuggestions handler.
 */
export function AIActions({ pendingCount, canExtract, extracting, onExtract, onOpenSuggestions }: AIActionsProps) {
  const hasReview = pendingCount > 0 && onOpenSuggestions != null;
  if (!canExtract && !hasReview) return null;
  const ariaLabel = hasReview
    ? t('runs', 'aiPendingSuggestions').replace('{{n}}', String(pendingCount))
    : t('runs', 'aiActionsLabel');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={ariaLabel}
              data-testid="run-ai-actions"
              className="relative h-7 w-7 shrink-0 p-0"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin text-ai" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4 text-ai" strokeWidth={1.5} aria-hidden="true" />
              )}
              {pendingCount > 0 && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 rounded-full bg-ai/10 px-1 text-[10px] font-medium leading-4 text-ai">
                  {pendingCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{ariaLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {canExtract && (
          <DropdownMenuItem disabled={extracting} onSelect={() => onExtract()}>
            <Sparkles className="mr-2 h-3.5 w-3.5 text-ai" strokeWidth={1.5} aria-hidden="true" />
            {extracting ? t('runs', 'extractingWithAI') : t('runs', 'extractWithAI')}
          </DropdownMenuItem>
        )}
        {hasReview && (
          <DropdownMenuItem onSelect={() => onOpenSuggestions()}>
            {t('runs', 'reviewPendingSuggestions').replace('{{n}}', String(pendingCount))}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit**

```bash
git add frontend/components/runs/header/AIActions.tsx frontend/components/runs/header/__tests__/AIActions.test.tsx
git commit -m "feat(runs): single AI actions menu — Sparkles trigger + named items"
```

---

### Task 5: Simplify `PrimaryAction` (helper → sr-only + gated tooltip)

**Files:**
- Modify: `frontend/components/runs/header/PrimaryAction.tsx`
- Modify: `frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`

**Interfaces:** unchanged (reads `useRunHeader().transition/submitting/progress`).

- [ ] **Step 1: Extend the test** — in `PrimaryAction.test.tsx`, update the
  gated case: the helper stays queryable (sr-only) but the gated tooltip
  carries the count; the fixture label 'Mark ready →' becomes
  'Finish extraction' (vocabulary hygiene only — the mock passes labels
  through):

```tsx
  it('when gated, keeps an sr-only helper and surfaces the count in the tooltip', async () => {
    const onAdvance = vi.fn();
    render(<RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: false, reason: 'r', remaining: 27 }, onAdvance } }}>
      <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
    </RunHeader>);
    const btn = screen.getByRole('button', { name: /Reconcile/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    const helper = screen.getByText('requiredOfTotal');
    expect(helper).toHaveClass('sr-only');
    btn.focus();
    const tip = await screen.findAllByText('requiredOfTotal');
    expect(tip.length).toBeGreaterThan(1); // helper + tooltip copy
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run to verify fail** — helper today is visible ≥52rem
  (`@[52rem]/headerbar:not-sr-only`) and no gated tooltip exists.

- [ ] **Step 3: Implement** — in `PrimaryAction.tsx`:
  - helper span className becomes exactly `"sr-only"` (drop the
    `@[52rem]` reveal classes).
  - tooltip selection: `const tooltipText = gated ? helper : transition.tooltip;`
    and render the `Tooltip` wrapper whenever `tooltipText` is non-null:

```tsx
  const tooltipText = gated ? helper : (transition.tooltip ?? null);
  return (
    <div className="flex items-center gap-2">
      {helper && <span id={helperId} className="sr-only">{helper}</span>}
      {tooltipText ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{tooltipText}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
```

- [ ] **Step 4: Run to verify pass**
  `npx vitest run frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/PrimaryAction.tsx frontend/components/runs/header/__tests__/PrimaryAction.test.tsx
git commit -m "feat(runs): clean primary action — count moves to gated tooltip, helper sr-only"
```

---

### Task 6: Simplify `Breadcrumb` to a single title

**Files:**
- Modify: `frontend/components/runs/header/Breadcrumb.tsx`
- Modify: `frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`

**Interfaces:**
- Produces: `Breadcrumb({ onBack, title }: { onBack: () => void; title: string })`
  — Tasks 9/10 update both call sites (`crumbs=` prop dies).

- [ ] **Step 1: Update the test** to the new API (single title, no project
  crumb, back button preserved with its `@[42rem]` fold class):

```tsx
  it('renders only the title and back affordance', () => {
    render(<Breadcrumb onBack={() => {}} title="Effects of X" />);
    expect(screen.getByText('Effects of X')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'back' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull(); // no crumb list anymore
  });
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: Implement**:

```tsx
interface BreadcrumbProps {
  onBack: () => void;
  title: string;
}

export function Breadcrumb({ onBack, title }: BreadcrumbProps) {
  return (
    // The article/template title is the single identity text: pure
    // flex-shrink, truncates last (the drop cascade lives in RunHeader.tsx).
    <nav className="flex min-w-0 shrink items-center gap-1" aria-label="breadcrumb">
      <HeaderIconButton
        aria-label={t('common', 'back')}
        onClick={onBack}
        className="hidden @[42rem]/headerbar:inline-flex"
      >
        <ArrowLeft strokeWidth={1.5} aria-hidden="true" />
      </HeaderIconButton>
      <TruncatedText text={title} className="min-w-0 text-sm font-medium text-foreground" />
    </nav>
  );
}
```

(delete the `Crumb` interface, the `<ol>` loop, and the `ChevronRight`
import.)

- [ ] **Step 4: Run to verify pass**
  `npx vitest run frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/Breadcrumb.tsx frontend/components/runs/header/__tests__/Breadcrumb.test.tsx
git commit -m "feat(runs): breadcrumb = article title only (project crumb removed)"
```

---

### Task 7: Compound rewire — delete StageRail/Reviewers/RoleChip, attach RunStatus

**Files:**
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Delete: `frontend/components/runs/header/StageRail.tsx`,
  `Reviewers.tsx`, `RoleChip.tsx`
- Delete: `__tests__/StageRail.test.tsx`, `__tests__/Reviewers.test.tsx`,
  `__tests__/RoleChip.test.tsx`
- Modify: `__tests__/RunHeader.test.tsx`, `__tests__/RunHeader.shell.test.tsx`,
  `__tests__/_headerTestUtils.tsx` (if they mount the deleted leaves)
- Modify: `frontend/components/runs/header/__tests__/RunStatus.test.tsx`
  (flip imports to the compound `RunHeader.RunStatus` form)

**Interfaces:**
- Produces: `RunHeader.RunStatus` compound slot (replaces
  `RunHeader.StageRail`, `RunHeader.Reviewers`, `RunHeader.RoleChip`).

- [ ] **Step 1: Make the compound swap** in `RunHeader.tsx`:
  - remove the three imports, add `import { RunStatus } from './RunStatus';`
  - `Object.assign(...)`: drop `StageRail, RoleChip, Reviewers`, add `RunStatus`.
  - Replace the 27-line RESPONSIVE DROP CASCADE comment with:

```tsx
/**
 * RESPONSIVE CASCADE (3 rules — the RunStatus popover absorbed the old
 * StageRail/Reviewers/RoleChip fold ladder):
 *
 *   1. The article title truncates (pure flex-shrink) — never drops.
 *   2. Reviewer avatars drop <48rem (RunStatus.tsx).
 *   3. Back arrow drops <42rem (Breadcrumb.tsx); the stage chip folds to its
 *      dot <36rem but NEVER drops — it is the status anchor.
 *
 * The ‹N/M› pager keeps its own protected shrink-0 slot; Left/Center keep
 * overflow-hidden purely as an anti-overlap backstop for whitespace-nowrap
 * leaves.
 */
```

- [ ] **Step 2: Delete the three leaves + their tests**

```bash
git rm frontend/components/runs/header/StageRail.tsx frontend/components/runs/header/Reviewers.tsx frontend/components/runs/header/RoleChip.tsx
git rm frontend/components/runs/header/__tests__/StageRail.test.tsx frontend/components/runs/header/__tests__/Reviewers.test.tsx frontend/components/runs/header/__tests__/RoleChip.test.tsx
```

- [ ] **Step 3: Repair compound-level tests** — grep and update:

Run: `rg -n "StageRail|Reviewers|RoleChip" frontend/components/runs/header frontend/test`
Every hit inside `__tests__/RunHeader*.test.tsx` / `_headerTestUtils.tsx`
switches to `<RunHeader.RunStatus />` (or is dropped when it asserted deleted
behavior). Flip `RunStatus.test.tsx` to compound imports.

- [ ] **Step 4: Run the header suite**

Run: `npx vitest run frontend/components/runs/header`
Expected: PASS, zero references to deleted files.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/components/runs/header
git commit -m "feat(runs): RunStatus replaces StageRail/Reviewers/RoleChip in the compound (atomic swap)"
```

---

### Task 8: Suggestion-locate helper + section anchors

**Files:**
- Create: `frontend/lib/runs/suggestionLocate.ts`
- Test: `frontend/test/lib/suggestionLocate.test.ts`
- Modify: `frontend/components/extraction/ExtractionFormView.tsx` (add
  `data-section-id` on the registered section wrappers, lines ~108 and ~138)
- Modify: `frontend/components/assessment/QASectionAccordion.tsx` (add
  `data-section-id={domain.entityType.id}` on the root that carries
  `data-testid={\`qa-domain-...\`}`, line ~177)

**Interfaces:**
- Produces:
  `firstPendingInstanceId(suggestions: Record<string, AISuggestion>): string | null`
  (key format `${instanceId}_${fieldId}` — documented at
  `frontend/types/ai-extraction.ts:301`) and
  `scrollToSectionById(entityTypeId: string): boolean` (DOM query on
  `[data-section-id]`, smooth scroll). Tasks 9/10 consume both.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { firstPendingInstanceId, scrollToSectionById } from '@/lib/runs/suggestionLocate';
import type { AISuggestion } from '@/types/ai-extraction';

const sug = (status: AISuggestion['status']): AISuggestion => ({ status } as AISuggestion);

describe('firstPendingInstanceId', () => {
  it('returns the instance id of the first pending suggestion', () => {
    expect(firstPendingInstanceId({ 'inst-1_field-9': sug('accepted'), 'inst-2_field-3': sug('pending') })).toBe('inst-2');
  });
  it('returns null when nothing is pending', () => {
    expect(firstPendingInstanceId({ 'a_b': sug('rejected') })).toBeNull();
  });
});

describe('scrollToSectionById', () => {
  it('scrolls the matching section and reports success', () => {
    const el = document.createElement('div');
    el.setAttribute('data-section-id', 'et-1');
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    expect(scrollToSectionById('et-1')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
    el.remove();
  });
  it('returns false when the section is not mounted', () => {
    expect(scrollToSectionById('missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: Implement**

```ts
import type { AISuggestion } from '@/types/ai-extraction';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';

/**
 * Header "Review N pending suggestions" locate helpers. The suggestion map is
 * keyed `${instanceId}_${fieldId}` (frontend/types/ai-extraction.ts:301) —
 * both ids are UUIDs, so the FIRST underscore splits reliably.
 */
export function firstPendingInstanceId(suggestions: Record<string, AISuggestion>): string | null {
  const entry = Object.entries(suggestions).find(([, s]) => isSuggestionPending(s));
  if (!entry) return null;
  const key = entry[0];
  const sep = key.indexOf('_');
  return sep > 0 ? key.slice(0, sep) : null;
}

/** Scrolls the form panel to a section wrapper carrying data-section-id. */
export function scrollToSectionById(entityTypeId: string): boolean {
  const el = document.querySelector(`[data-section-id="${CSS.escape(entityTypeId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
```

Add the anchors: in `ExtractionFormView.tsx`, on each wrapper that already
does `ref={(el) => registerSection(entityType.id, el)}` add
`data-section-id={entityType.id}` (both occurrences); in
`QASectionAccordion.tsx` add `data-section-id={domain.entityType.id}`
alongside the existing `data-testid`.

- [ ] **Step 4: Run to verify pass**
  `npx vitest run frontend/test/lib/suggestionLocate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/runs/suggestionLocate.ts frontend/test/lib/suggestionLocate.test.ts frontend/components/extraction/ExtractionFormView.tsx frontend/components/assessment/QASectionAccordion.tsx
git commit -m "feat(runs): suggestion-locate helper + section anchors for the header review action"
```

---

### Task 9: ExtractionHeader + ExtractionFullScreen rewire

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Modify: `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`

**Interfaces:**
- Consumes: `RunHeader.RunStatus` (Task 7), `Breadcrumb {title}` (Task 6),
  locate helpers (Task 8).
- Produces: `ExtractionHeaderProps` WITHOUT `projectName`/`projectId`
  (breadcrumb navigation dies with the crumb; `onBack` already returns to the
  project).

- [ ] **Step 1: Update `ExtractionHeader.exports.test.tsx` first** — the
  landmark test (line 59 `renders a StageRail navigation landmark`) becomes:

```tsx
  it('renders the RunStatus chip when a stage is provided', () => {
    render(<ExtractionHeader {...baseProps} stage="extract" />);
    expect(screen.getByTestId('run-stage-current')).toBeInTheDocument();
  });
```

Remove `projectName: 'P'` / `projectId: 'p'` from the fixture; the 'Mark
ready' transition fixture label (line 75) becomes `'Finish extraction'`.

- [ ] **Step 2: Run to verify fail**
  `npx vitest run frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`

- [ ] **Step 3: Rewire `ExtractionHeader.tsx`**
  - Interface: delete `projectId: string;` and `projectName: string;`; delete
    the `useNavigate` import and call (its only use was the project crumb).
  - Update the deprecated-props docstring (line 71) to name the new labels
    (`Finish extraction / Start consensus / Approve & finalize`).
  - Left slot: `<RunHeader.Breadcrumb onBack={onBack} title={articleTitle} />`;
    remove `{stage != null && <RunHeader.StageRail />}` from Left.
  - Center slot becomes:

```tsx
          <RunHeader.Center>
            {stage != null && <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />}
          </RunHeader.Center>
```

  with `const [statusOpen, setStatusOpen] = useState(false);` next to
  `paletteOpen`.
  - Palette actions: append

```tsx
  if (stage != null) {
    paletteActions.push({
      id: 'status',
      label: t('runs', 'viewRunStatus'),
      run: () => setStatusOpen(true),
    });
  }
```

  (the existing `reopen` palette action and Menu item stay wired to
  `onReopen` — the screen's #472-hardened handler.)

- [ ] **Step 4: Rewire `ExtractionFullScreen.tsx`**
  - Remove the `projectName={...} projectId={...}` props from the
    `<ExtractionHeader …>` call (keep `onBack`).
  - Replace the placeholder handler (lines ~1272-1275):

```tsx
        onAISuggestionsClick={() => {
          const instanceId = firstPendingInstanceId(aiSuggestions);
          const entityTypeId = instanceId
            ? instances.find((i) => i.id === instanceId)?.entityTypeId
            : undefined;
          if (entityTypeId) scrollToSectionById(entityTypeId);
        }}
```

  with imports `import { firstPendingInstanceId, scrollToSectionById } from '@/lib/runs/suggestionLocate';`.
  - Text-only comment touch-ups at lines 390, 414, 1066: "Mark ready" →
    "Finish extraction", "Open consensus" → "Start consensus" (behavior
    untouched).

- [ ] **Step 5: Run the touched suites**

Run: `npx vitest run frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx frontend/test/ExtractionFullScreen.readonly.test.tsx`
Expected: PASS (readonly tests still green — header adds no `/read-only/i` /
`/required left/i` text; AI trigger absent on finalized because
`pendingCount=0` and `canRunAI=false`).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/ExtractionHeader.tsx frontend/pages/ExtractionFullScreen.tsx frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx
git commit -m "feat(extraction): header slots — RunStatus swap, title-only breadcrumb, real suggestion locate, View-run-status palette"
```

---

### Task 10: QA screen rewire + QA screen tests

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`
- Modify: `frontend/test/QualityAssessmentFullScreen.test.tsx`

**Interfaces:**
- Consumes: `RunHeader.RunStatus` (uncontrolled — QA has no palette),
  `Breadcrumb {title}`, locate helpers.

- [ ] **Step 1: Update the QA screen tests first**
  - Landmark test (lines ~312-325): the canonical RunHeader-mounted marker
    becomes the chip:

```tsx
    await waitFor(() =>
      expect(screen.getByTestId('run-stage-current')).toBeInTheDocument(),
    );
```

  - 'Extract with AI' tests (~327-360): open the menu first:

```tsx
    const trigger = await screen.findByTestId('run-ai-actions');
    await userEvent.click(trigger);
    const item = await screen.findByRole('menuitem', { name: /extract with ai/i });
```

  (the click-posts test clicks the menuitem instead of the old button; the
  finalized block's `queryByRole('button', { name: /extract with ai/i })`
  absence assertion stays valid — the whole trigger is absent.)

- [ ] **Step 2: Run to verify fail**
  `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx`

- [ ] **Step 3: Rewire the screen**
  - Breadcrumb: `crumbs={[{ label: template?.name ?? "" }]}` →
    `title={template?.name ?? ""}`.
  - Remove `{runStage != null && <RunHeader.StageRail />}` from Left; Center
    becomes `{runStage != null && <RunHeader.RunStatus />}` (replacing
    `<RunHeader.Reviewers />` + `<RunHeader.RoleChip />`).
  - AIActions call gains the real handler:

```tsx
            onOpenSuggestions={() => {
              const instanceId = firstPendingInstanceId(aiSuggestions);
              const domain = instanceId
                ? sortedDomains.find(
                    (d) => session?.instancesByEntityType[d.entityType.id] === instanceId,
                  )
                : undefined;
              if (domain) scrollToSectionById(domain.entityType.id);
            }}
```

- [ ] **Step 4: Run to verify pass**
  `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx`
  Expected: PASS incl. the untouched finalized (#472) block.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/QualityAssessmentFullScreen.tsx frontend/test/QualityAssessmentFullScreen.test.tsx
git commit -m "feat(qa): header slots — RunStatus swap, title-only breadcrumb, real suggestion locate"
```

---

### Task 11: E2E selector updates

**Files:**
- Modify: `frontend/e2e/flows/extraction-reopen.ui.e2e.ts` (lines ~184-189)

**Interfaces:** none (assertion-only).

- [ ] **Step 1: Re-target the Revision assertion** — the StageRail
  `nav[aria-label="Run stage"]` is gone; the #472 banner badge is the primary
  revision surface:

```ts
    // After reopen the sub-header banner shows the Revision badge
    // (HITLPublishedBanner) once the new run loads.
    await expect(page.getByTestId("extraction-revision-badge")).toBeVisible({
      timeout: 20000,
    });
```

- [ ] **Step 2: Verify the untouched flows still match by inspection**
  - `qa-flow.ui.e2e.ts:166-174`: `getByTestId("run-stage-current").filter({ hasText: /finalized/i })`
    — the chip keeps the testid and renders "Finalized" text at desktop
    widths. No edit.
  - `extraction-navigation.ui.e2e.ts`, `qa-reopen.ui.e2e.ts`,
    `pdf-collapsed-default.ui.e2e.ts`: no header testids. No edit.

Run: `npx tsc --noEmit -p tsconfig.json` (e2e files are type-checked; full
Playwright runs happen at the gate/P7).

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/flows/extraction-reopen.ui.e2e.ts
git commit -m "test(e2e): revision assertion re-targets the published banner badge"
```

---

### Task 12: Docs — spec banners, arch doc, ADR-0015 note, backend comments

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md`
- Modify: `docs/superpowers/specs/2026-06-21-header-system-responsive-frosted-design.md`
- Modify: `docs/reference/extraction-hitl-architecture.md` (lines ~92-100, ~505-506)
- Modify: `docs/adr/0015-finalize-via-approve-publish.md` (More Information)
- Modify: `backend/app/services/section_extraction_service.py` (lines 322, 909, 1048 — comments only)
- Modify: `backend/tests/unit/test_section_extraction_service.py` (line 280 — comment only)
- Modify: `.markdownlintignore` (this plan's entry — added when the plan file
  is committed, keep it)

- [ ] **Step 1: Superseded banners** — insert directly under each June spec's
  H1:

```markdown
> **Superseded (visual sections) 2026-07-02** by
> [`2026-07-02-run-header-declutter-design.md`](2026-07-02-run-header-declutter-design.md):
> the StageRail/Reviewers/RoleChip leaves and the multi-threshold drop
> cascade described here were replaced by the unified `RunHeader.RunStatus`
> cluster + status popover. The HeaderShell frosted chrome and h-12 language
> remain authoritative here.
```

- [ ] **Step 2: Arch doc** — update the "shared RunHeader maps `extract`…"
  passage (~92) to name the chip: extraction runs label it **Extraction**, QA
  runs **Assessment**, presented as a single current-stage chip whose popover
  holds the 3-node timeline; update the action names at ~95-100 and ~505-506:
  "Mark ready" → **"Finish extraction"**, "Open consensus" →
  **"Start consensus"** (semantics unchanged, ADR-0015).

- [ ] **Step 3: ADR-0015 More Information** — append one line:

```markdown
- Header labels renamed 2026-07-02 — "Finish extraction" (was Mark ready) /
  "Start consensus" (was Open consensus); presentation only, semantics
  unchanged. See `docs/superpowers/specs/2026-07-02-run-header-declutter-design.md`.
```

- [ ] **Step 4: Backend comment touch-ups** — in the three service comments
  and one test comment, replace the quoted `"Open consensus"` with
  `"Start consensus"` (text-only; no behavior).

- [ ] **Step 5: Verify docs-ci locally**

Run: `npx markdownlint-cli2 "docs/superpowers/specs/2026-06-2*-design.md" "docs/reference/extraction-hitl-architecture.md" || true`
(specs are lint-ignored by the `2026-*-design.md` glob; the reference doc must
stay clean). Also `npx cspell --no-progress docs/adr/0015-finalize-via-approve-publish.md docs/reference/extraction-hitl-architecture.md`.

- [ ] **Step 6: Commit**

```bash
git add docs backend/app/services/section_extraction_service.py backend/tests/unit/test_section_extraction_service.py
git commit -m "docs: run-header declutter — supersede June header specs, arch-doc + ADR-0015 label notes"
```

---

### Task 13: Full gate (the Iron Law step for the diff)

- [ ] **Step 1: Full frontend suite** — `npm run test:run` → expect PASS.
- [ ] **Step 2: Lint + types** — `npm run lint && npx tsc --noEmit` → PASS.
- [ ] **Step 3: Dead-reference sweep** —
  `rg -n "StageRail|RoleChip|runHeaderMarkReady|runHeaderOpenConsensus|stageExtractTooltip" frontend/ docs/reference/ --glob '!docs/superpowers/**'`
  → expect ZERO hits outside archived specs/plans. `RunHeader.Reviewers`
  compound references likewise gone (`rg -n "RunHeader.Reviewers|<Reviewers"`).
- [ ] **Step 4: Backend unchanged check** — `git diff --stat origin/dev -- backend/`
  shows ONLY the two comment files.
- [ ] **Step 4b: File-size baselines** —
  `wc -l frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx`
  → ≤ 1307 / ≤ 824 (else consciously ratchet
  `scripts/fitness/check_file_size.baseline` in the same commit and say so in
  the PR body).
- [ ] **Step 5: Visual verification** — `/design-review` on the extraction run
  route and the QA run route (chip, popover, AI menu, gated tooltip, narrow
  widths 1280/900/700/560).
- [ ] **Step 6: Commit any fixes; do NOT push yet** (ship phase owns push/PR).
