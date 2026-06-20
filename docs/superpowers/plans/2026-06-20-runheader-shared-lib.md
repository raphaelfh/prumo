---
status: ready
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Shared RunHeader Lib — Calm Bar (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a composable `<RunHeader>` compound-component lib in `frontend/components/runs/header/` and re-skin the extraction header onto it as one calm single bar — a 4-node stage spine, a self-explaining gated primary action, the two eye-icons resolved, status economy, ambient reviewer presence, and honest blind/reveal — with the orphaned HITL banner row folded in.

**Architecture:** A `RunHeaderProvider` context holds a typed `RunHeaderValue`; slot subcomponents (`RunHeader.StageRail`, `.PrimaryAction`, `.Reviewers`, `.RoleChip`, `.PanelToggle`, `.AIActions`, `.Save`, `.Breadcrumb`, `.Menu`) read from it (shadcn/Breadcrumb-style compound API). `ExtractionHeader` is re-implemented as a thin `<RunHeader>` composition keeping its **exact external props**, so `ExtractionFullScreen` changes minimally (it stops computing a `finalizeLabel` string and instead passes a typed `StageTransition`). The primary button never disables: when gated it shows the remaining count and its `onAdvance` runs guide-me.

**Tech Stack:** React 19 + TS strict, Vite, shadcn/Radix, Tailwind, Vitest + Testing Library + user-event, lucide-react.

**Source spec:** `docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md` §3.3a.

**Scope note:** Plan 1 (this) = the lib + extraction calm bar (P0 + the P1 slot behaviors that the calm bar needs: reviewer presence, blind/reveal, AI weight). **Plan 2 (later, same branch)** = `RunHeader.Worklist` peek, Cmd-K long-tail + container-query collapse, and migrating the QA header (`QualityAssessmentFullScreen.tsx:477-580`) onto `<RunHeader>`. Both ship working software on their own.

## Global Constraints

- **English only**; all user-facing strings via `frontend/lib/copy/` — `t('extraction', 'key')` for extraction/shared header strings, `t('common', …)` where already shared. Never hardcode strings.
- **No schema / API / run-state changes.** Data arrives via existing hooks (`useReviewerSummary`, `useComparisonPermissions`, `useExtractionProgress`, `useAutoSaveProposals`). Page keeps owning mutations (`useAdvanceRun`/`useReopenRun`/handlers).
- **React Compiler `panicThreshold: 'all_errors'`**: no `try/finally` / `throw` inside component/hook bodies; IO via `frontend/services/*` returning `ErrorResult` (`frontend/lib/error-utils.ts:toResult`). Read API errors as `error.message` (not `detail`). Preserve `// kept:` memo comments.
- **Visible focus** on every interactive element: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- **Tests** run from repo ROOT: `npm run test:run` (never `npm test`). Header tests live in `frontend/components/runs/header/__tests__/`; mock copy with `vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }))`; wrap renders needing it in `<TooltipProvider>` / `<MemoryRouter>`. Use `render`/`screen`/`userEvent`.
- **Tokens (reuse):** bar `h-12 bg-background/80 backdrop-blur-md border-b border-border/40`; `--info` (current stage), `--success` (done), `--warning` (gate/divergence), `--ai` (sparkle/AI chip), `--reviewer-1..5` (avatars), `--primary`/`--primary-hover` (primary action), `text-muted-foreground` (everything ambient). Radii `rounded-md`/`-lg`/`-full`. lucide icons: `PanelRight`, `GitFork`, `Lock`, `Sparkles`, `Circle`, `CircleCheck`, `ChevronDown`, `ChevronLeft`.

## File Structure

**Create (`frontend/components/runs/header/`):**
- `RunHeaderContext.tsx` — `RunHeaderProvider`, `useRunHeader()`, the `RunHeaderValue` / `StageTransition` / `RunKind` types.
- `RunHeader.tsx` — the shell (`<RunHeader>` + `.Left`/`.Center`/`.Right` layout zones) + re-exports the slots; default compound export.
- `StageRail.tsx`, `PrimaryAction.tsx`, `Reviewers.tsx`, `RoleChip.tsx`, `PanelToggle.tsx`, `AIActions.tsx`, `SaveSlot.tsx`, `Breadcrumb.tsx`, `Menu.tsx` — slot components.
- `stage.ts` — pure `STAGE_NODES` + `stageNodeStates(stage)` helper (testable).
- `index.ts` — barrel: `export { RunHeader } from './RunHeader'` + types.
- Tests in `frontend/components/runs/header/__tests__/`.

**Modify:**
- `frontend/components/extraction/ExtractionHeader.tsx` — re-implement as a thin `<RunHeader>` composition (same external `ExtractionHeaderProps`).
- `frontend/pages/ExtractionFullScreen.tsx` — pass a `StageTransition` descriptor instead of `finalizeLabel`; remove the orphaned banner row block (`:1108-1139`); wire `onJumpToGap` (guide-me) + reveal.
- `frontend/lib/copy/extraction.ts` — new header copy keys.
- `.markdownlintignore` — add this plan file.

**Locked interfaces (use these EXACT names across tasks):**

```ts
// RunHeaderContext.tsx
export type RunKind = 'extraction' | 'qa';
export type StageTransition =
  | { to: ExtractionRunStage; label: string; gate: { ok: true }; onAdvance: () => void | Promise<void> }
  | { to: ExtractionRunStage; label: string; gate: { ok: false; reason: string; remaining: number }; onAdvance: () => void | Promise<void> };

export interface RunHeaderValue {
  kind: RunKind;
  stage: ExtractionRunStage | null;                 // from '@/types/ai-extraction'
  isRevision: boolean;                              // parent_run_id present
  role?: UserRole;                                  // '@/lib/comparison/permissions'
  isBlind: boolean;
  canReveal: boolean;                              // manager + reveal available
  onReveal?: () => void;
  progress: { completed: number; total: number; pct: number };
  reviewers: { count: number; required: number; divergent: number };  // from useReviewerSummary
  transition: StageTransition | null;             // null => no primary action (e.g. viewer)
  submitting?: boolean;
  onJumpToDivergence?: () => void;
}
export function RunHeaderProvider(props: { value: RunHeaderValue; children: ReactNode }): JSX.Element;
export function useRunHeader(): RunHeaderValue;     // throws if used outside provider

// stage.ts
export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export interface StageNode { key: 'proposal' | 'review' | 'consensus' | 'finalized'; label: string; state: StageNodeState }
export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[];
```

---

### Task 1: Stage-node state helper (pure)

**Files:**
- Create: `frontend/components/runs/header/stage.ts`
- Test: `frontend/components/runs/header/__tests__/stage.test.ts`

**Interfaces:**
- Consumes: `ExtractionRunStage` (`@/types/ai-extraction`).
- Produces: `StageNodeState`, `StageNode`, `stageNodeStates`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/components/runs/header/__tests__/stage.test.ts
import { describe, expect, it } from 'vitest';
import { stageNodeStates } from '@/components/runs/header/stage';

describe('stageNodeStates', () => {
  it('marks earlier nodes done, the current node current, and later nodes future', () => {
    const nodes = stageNodeStates('consensus');
    expect(nodes.map((n) => [n.key, n.state])).toEqual([
      ['proposal', 'done'],
      ['review', 'done'],
      ['consensus', 'current'],
      ['finalized', 'future'],
    ]);
  });
  it('treats pending/null as before proposal (all future, proposal current-ish)', () => {
    expect(stageNodeStates('pending').map((n) => n.state)).toEqual(['current', 'future', 'future', 'future']);
    expect(stageNodeStates(null).map((n) => n.state)).toEqual(['current', 'future', 'future', 'future']);
  });
  it('marks every node cancelled when the run is cancelled', () => {
    expect(stageNodeStates('cancelled').every((n) => n.state === 'cancelled')).toBe(true);
  });
  it('marks all four done when finalized', () => {
    expect(stageNodeStates('finalized').map((n) => n.state)).toEqual(['done', 'done', 'done', 'current']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- runs/header/__tests__/stage`
Expected: FAIL — cannot resolve `@/components/runs/header/stage`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/components/runs/header/stage.ts
import type { ExtractionRunStage } from '@/types/ai-extraction';

export type StageNodeState = 'done' | 'current' | 'future' | 'cancelled';
export interface StageNode {
  key: 'proposal' | 'review' | 'consensus' | 'finalized';
  label: string;
  state: StageNodeState;
}

const ORDER: StageNode['key'][] = ['proposal', 'review', 'consensus', 'finalized'];
const LABEL: Record<StageNode['key'], string> = {
  proposal: 'Proposal',
  review: 'Review',
  consensus: 'Consensus',
  finalized: 'Finalized',
};

export function stageNodeStates(stage: ExtractionRunStage | null): StageNode[] {
  if (stage === 'cancelled') {
    return ORDER.map((key) => ({ key, label: LABEL[key], state: 'cancelled' as const }));
  }
  // pending / null behave as "at proposal, nothing done yet".
  const currentIndex = stage === 'pending' || stage == null ? 0 : ORDER.indexOf(stage);
  return ORDER.map((key, i) => ({
    key,
    label: LABEL[key],
    state: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- runs/header/__tests__/stage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/stage.ts frontend/components/runs/header/__tests__/stage.test.ts
git commit -m "feat(runs): stage-node state helper for RunHeader spine"
```

---

### Task 2: RunHeader context + shell

**Files:**
- Create: `frontend/components/runs/header/RunHeaderContext.tsx`, `frontend/components/runs/header/RunHeader.tsx`, `frontend/components/runs/header/index.ts`
- Test: `frontend/components/runs/header/__tests__/RunHeader.test.tsx`

**Interfaces:**
- Produces: `RunHeaderProvider`, `useRunHeader`, `RunHeaderValue`, `StageTransition`, `RunKind`; `RunHeader` compound shell with `.Left/.Center/.Right`.
- Consumed by: every slot task + the re-skin (Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/runs/header/__tests__/RunHeader.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
import { useRunHeader } from '@/components/runs/header/RunHeaderContext';

function Probe() {
  const ctx = useRunHeader();
  return <span data-testid="probe">{ctx.kind}:{ctx.stage}</span>;
}

const baseValue = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 1 }, transition: null,
};

describe('RunHeader shell', () => {
  it('renders the bar and provides context to slots', () => {
    render(
      <RunHeader value={baseValue}>
        <RunHeader.Left><Probe /></RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('extraction:review');
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- runs/header/__tests__/RunHeader`
Expected: FAIL — cannot resolve `@/components/runs/header`.

- [ ] **Step 3: Write the context**

```tsx
// frontend/components/runs/header/RunHeaderContext.tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { UserRole } from '@/lib/comparison/permissions';

export type RunKind = 'extraction' | 'qa';

export type StageTransition =
  | { to: ExtractionRunStage; label: string; gate: { ok: true }; onAdvance: () => void | Promise<void> }
  | {
      to: ExtractionRunStage;
      label: string;
      gate: { ok: false; reason: string; remaining: number };
      onAdvance: () => void | Promise<void>;
    };

export interface RunHeaderValue {
  kind: RunKind;
  stage: ExtractionRunStage | null;
  isRevision: boolean;
  role?: UserRole;
  isBlind: boolean;
  canReveal: boolean;
  onReveal?: () => void;
  progress: { completed: number; total: number; pct: number };
  reviewers: { count: number; required: number; divergent: number };
  transition: StageTransition | null;
  submitting?: boolean;
  onJumpToDivergence?: () => void;
}

const RunHeaderCtx = createContext<RunHeaderValue | null>(null);

export function RunHeaderProvider({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return <RunHeaderCtx.Provider value={value}>{children}</RunHeaderCtx.Provider>;
}

export function useRunHeader(): RunHeaderValue {
  const ctx = useContext(RunHeaderCtx);
  if (!ctx) throw new Error('useRunHeader must be used within <RunHeader>');
  return ctx;
}
```

(`throw` here is in a hook body but NOT inside `try/finally`; the React Compiler allows a bare guard throw — this matches the existing `useExtraction*` context hooks. If the compiler flags it, move the guard to a `// kept:`-commented `'use no memo'` per the rules.)

- [ ] **Step 4: Write the shell**

```tsx
// frontend/components/runs/header/RunHeader.tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RunHeaderProvider, type RunHeaderValue } from './RunHeaderContext';

function Left({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2">{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2">{children}</div>;
}

function RunHeaderRoot({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return (
    <RunHeaderProvider value={value}>
      <header className="relative z-10 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="flex h-12 items-center gap-4 px-6">{children}</div>
      </header>
    </RunHeaderProvider>
  );
}

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right });
```

```ts
// frontend/components/runs/header/index.ts
export { RunHeader } from './RunHeader';
export { useRunHeader, RunHeaderProvider } from './RunHeaderContext';
export type { RunHeaderValue, StageTransition, RunKind } from './RunHeaderContext';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- runs/header/__tests__/RunHeader`
Expected: PASS. Then `node scripts/enumerate_compiler_bailouts.mjs` — confirm the new files are not listed (if `useRunHeader`'s guard throw bails, add `'use no memo'` + `// kept:` to that file only and re-run).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/header/RunHeaderContext.tsx frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/index.ts frontend/components/runs/header/__tests__/RunHeader.test.tsx
git commit -m "feat(runs): RunHeader context + compound shell"
```

---

### Task 3: StageRail slot

**Files:**
- Create: `frontend/components/runs/header/StageRail.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx` (attach `.StageRail`), `frontend/lib/copy/extraction.ts`
- Test: `frontend/components/runs/header/__tests__/StageRail.test.tsx`

**Interfaces:**
- Consumes: `useRunHeader`, `stageNodeStates` (Task 1).
- Produces: `RunHeader.StageRail`.

- [ ] **Step 1: Add copy keys** to `frontend/lib/copy/extraction.ts` (near the section-nav keys):

```ts
    // RunHeader
    runHeaderRevision: 'Revision',
    extractWithAI: 'Extract with AI',
    runHeaderGateRemaining: '{{count}} left',
    runHeaderRequiredOfTotal: '{{done}} of {{total}} required',
    runHeaderReviewersDiffer: '{{count}} differ',
    runHeaderBlindSuffix: 'blind',
    runHeaderRevealedSuffix: 'revealed',
    runHeaderReveal: 'Reveal reviewers',
    runHeaderBlindExplainer: "You're blind to reviewers' values for this kind.",
    runHeaderTogglePanel: 'Toggle source panel',
    runHeaderSaved: 'Saved',
    runHeaderSaving: 'Saving…',
    runHeaderSaveFailed: 'Save failed',
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/components/runs/header/__tests__/StageRail.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
import { vi } from 'vitest';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const value = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: true,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 0 }, transition: null,
};

describe('RunHeader.StageRail', () => {
  it('renders four nodes, marks the current stage, and shows the revision tag + gate count', () => {
    render(<RunHeader value={{ ...value, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: false, reason: 'x', remaining: 27 }, onAdvance: () => {} } }}>
      <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
    </RunHeader>);
    ['Proposal', 'Review', 'Consensus', 'Finalized'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('Review').closest('[data-state]')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('runHeaderRevision')).toBeInTheDocument();
    expect(screen.getByText('runHeaderGateRemaining')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- StageRail`
Expected: FAIL — `RunHeader.StageRail` is undefined.

- [ ] **Step 4: Write the slot + attach it**

```tsx
// frontend/components/runs/header/StageRail.tsx
import { Circle, CircleCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';
import { stageNodeStates, type StageNode } from './stage';

const DOT: Record<StageNode['state'], string> = {
  done: 'text-success',
  current: 'text-info',
  future: 'text-muted-foreground/50',
  cancelled: 'text-destructive',
};

export function StageRail() {
  const { stage, isRevision, progress, transition } = useRunHeader();
  const nodes = stageNodeStates(stage);
  const gateRemaining = transition && transition.gate.ok === false ? transition.gate.remaining : null;
  return (
    <nav className="flex items-center gap-1.5" aria-label="Run stage">
      {isRevision && (
        <span className="mr-1 rounded-md bg-ai/10 px-2 py-0.5 text-[11px] font-medium text-ai">
          {t('extraction', 'runHeaderRevision')}
        </span>
      )}
      {nodes.map((node, i) => (
        <div key={node.key} className="flex items-center gap-1.5" data-state={node.state}>
          {i > 0 && <span className={cn('h-px w-3.5', nodes[i - 1].state === 'done' ? 'bg-success/40' : 'bg-border')} aria-hidden="true" />}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px]',
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
            <span className="relative">
              {node.label}
              {node.state === 'current' && progress.total > 0 && (
                <span
                  className="absolute -bottom-1 left-0 h-0.5 rounded bg-info"
                  style={{ width: `${Math.min(100, progress.pct)}%` }}
                  aria-hidden="true"
                />
              )}
            </span>
            {node.state === 'current' && gateRemaining != null && gateRemaining > 0 && (
              <span className="ml-1 rounded bg-warning/15 px-1.5 text-[11px] text-warning">
                {t('extraction', 'runHeaderGateRemaining').replace('{{count}}', String(gateRemaining))}
              </span>
            )}
          </span>
        </div>
      ))}
    </nav>
  );
}
```

Attach in `RunHeader.tsx`: import `{ StageRail }` and change the export to `Object.assign(RunHeaderRoot, { Left, Center, Right, StageRail })`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- StageRail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/header/StageRail.tsx frontend/components/runs/header/RunHeader.tsx frontend/lib/copy/extraction.ts frontend/components/runs/header/__tests__/StageRail.test.tsx
git commit -m "feat(runs): StageRail spine slot with completion underline + gate chip"
```

---

### Task 4: PrimaryAction slot (self-explaining gated transition)

**Files:**
- Create: `frontend/components/runs/header/PrimaryAction.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Test: `frontend/components/runs/header/__tests__/PrimaryAction.test.tsx`

**Interfaces:**
- Consumes: `useRunHeader` (uses `transition`, `submitting`).
- Produces: `RunHeader.PrimaryAction`. The button label is `transition.label`; it never sets `disabled`; when `gate.ok === false` it renders `aria-disabled`, an inline "N of M required" helper, and `onClick` still calls `transition.onAdvance` (the page wires that to guide-me when gated).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/runs/header/__tests__/PrimaryAction.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  role: 'manager' as const, isBlind: false, canReveal: false,
  progress: { completed: 3, total: 30, pct: 10 }, reviewers: { count: 0, required: 0, divergent: 0 },
};

describe('RunHeader.PrimaryAction', () => {
  it('labels only the verb and advances when the gate is open', async () => {
    const onAdvance = vi.fn();
    render(<RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: true }, onAdvance } }}>
      <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
    </RunHeader>);
    const btn = screen.getByRole('button', { name: 'Reconcile' });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
  it('when gated, shows the remaining helper, is aria-disabled, and still runs onAdvance (guide-me) on click', async () => {
    const onAdvance = vi.fn();
    render(<RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: false, reason: 'r', remaining: 27 }, onAdvance } }}>
      <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
    </RunHeader>);
    const btn = screen.getByRole('button', { name: /Reconcile/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('runHeaderRequiredOfTotal')).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
  it('renders nothing when there is no transition', () => {
    const { container } = render(<RunHeader value={{ ...base, transition: null }}><RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right></RunHeader>);
    expect(container.querySelector('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- PrimaryAction`
Expected: FAIL — `RunHeader.PrimaryAction` undefined.

- [ ] **Step 3: Write the slot + attach**

```tsx
// frontend/components/runs/header/PrimaryAction.tsx
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

export function PrimaryAction() {
  const { transition, submitting, progress } = useRunHeader();
  if (!transition) return null;
  const gated = transition.gate.ok === false;
  const helper = gated
    ? t('extraction', 'runHeaderRequiredOfTotal')
        .replace('{{done}}', String(progress.completed))
        .replace('{{total}}', String(progress.total))
    : null;
  return (
    <div className="flex items-center gap-2">
      {helper && <span id="run-primary-helper" className="text-[11px] text-muted-foreground">{helper}</span>}
      <Button
        size="sm"
        onClick={() => void transition.onAdvance()}
        disabled={submitting}
        aria-disabled={gated || undefined}
        aria-describedby={gated ? 'run-primary-helper' : undefined}
        className={cn('shrink-0 font-medium hover:bg-primary-hover', gated && 'opacity-70')}
      >
        {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {transition.label}
      </Button>
    </div>
  );
}
```

Attach `PrimaryAction` to the compound export in `RunHeader.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- PrimaryAction`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/PrimaryAction.tsx frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/__tests__/PrimaryAction.test.tsx
git commit -m "feat(runs): self-explaining gated PrimaryAction slot"
```

---

### Task 5: PanelToggle + RoleChip slots (resolve the two eyes)

**Files:**
- Create: `frontend/components/runs/header/PanelToggle.tsx`, `frontend/components/runs/header/RoleChip.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Test: `frontend/components/runs/header/__tests__/RoleChip.test.tsx`

**Interfaces:**
- `RunHeader.PanelToggle` props: `{ pressed: boolean; onToggle: () => void }` (layout control — `PanelRight`, `aria-pressed`).
- `RunHeader.RoleChip` reads `role`/`isBlind`/`canReveal`/`onReveal`; renders "Manager · blind"; when `canReveal`, the chip is a Popover whose action calls `onReveal`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/runs/header/__tests__/RoleChip.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.RoleChip', () => {
  it('shows the role with a blind suffix and reveals via the popover action', async () => {
    const onReveal = vi.fn();
    render(<RunHeader value={{ ...base, role: 'manager', isBlind: true, canReveal: true, onReveal }}>
      <RunHeader.Center><RunHeader.RoleChip /></RunHeader.Center>
    </RunHeader>);
    expect(screen.getByText(/manager/i)).toBeInTheDocument();
    expect(screen.getByText('runHeaderBlindSuffix')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /manager/i }));
    await userEvent.click(screen.getByRole('button', { name: 'runHeaderReveal' }));
    expect(onReveal).toHaveBeenCalledOnce();
  });
  it('renders a plain non-interactive chip for a reviewer', () => {
    render(<RunHeader value={{ ...base, role: 'reviewer', isBlind: true, canReveal: false }}>
      <RunHeader.Center><RunHeader.RoleChip /></RunHeader.Center>
    </RunHeader>);
    expect(screen.queryByRole('button', { name: /reviewer/i })).toBeNull();
    expect(screen.getByText(/reviewer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- RoleChip`
Expected: FAIL — `RunHeader.RoleChip` undefined.

- [ ] **Step 3: Write the slots + attach**

```tsx
// frontend/components/runs/header/PanelToggle.tsx
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      size="sm" variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-label={t('extraction', 'runHeaderTogglePanel')}
      className={cn('h-8 w-8 p-0 text-muted-foreground', pressed && 'bg-muted text-foreground')}
    >
      <PanelRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
```

```tsx
// frontend/components/runs/header/RoleChip.tsx
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

function roleLabel(role?: string) {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function RoleChip() {
  const { role, isBlind, canReveal, onReveal } = useRunHeader();
  if (!role) return null;
  const suffix = isBlind
    ? ` · ${t('extraction', 'runHeaderBlindSuffix')}`
    : canReveal
      ? ` · ${t('extraction', 'runHeaderRevealedSuffix')}`
      : '';
  const text = (
    <>
      {roleLabel(role)}
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </>
  );
  if (!canReveal) {
    return <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{text}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground">
          {text}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-[13px]">
        <p className="mb-2 text-muted-foreground">{t('extraction', 'runHeaderBlindExplainer')}</p>
        <Button size="sm" className="w-full" onClick={() => onReveal?.()}>{t('extraction', 'runHeaderReveal')}</Button>
      </PopoverContent>
    </Popover>
  );
}
```

Attach both to the compound export.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- RoleChip`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/PanelToggle.tsx frontend/components/runs/header/RoleChip.tsx frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/__tests__/RoleChip.test.tsx
git commit -m "feat(runs): PanelToggle + honest blind RoleChip slots"
```

---

### Task 6: Reviewers + Save + AIActions slots

**Files:**
- Create: `frontend/components/runs/header/Reviewers.tsx`, `frontend/components/runs/header/SaveSlot.tsx`, `frontend/components/runs/header/AIActions.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Test: `frontend/components/runs/header/__tests__/Reviewers.test.tsx`

**Interfaces:**
- `RunHeader.Reviewers` reads `reviewers`/`stage`/`onJumpToDivergence`; renders avatars (`bg-reviewer-1..5`) only when `stage !== 'proposal'`; a `text-warning` "N differ" chip when `divergent > 0`.
- `RunHeader.Save` props: `{ state: SaveState; lastSavedAt: Date | null; hidden?: boolean }` (dot + word, ambient).
- `RunHeader.AIActions` props: `{ pendingCount: number; canExtract: boolean; extracting?: boolean; onExtract: () => void; onOpenSuggestions?: () => void }` — secondary "Extract with AI" when `canExtract`, else a `bg-ai/10` "AI · N" chip when `pendingCount > 0`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/runs/header/__tests__/Reviewers.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, isRevision: false, role: 'manager' as const, isBlind: false,
  canReveal: false, progress: { completed: 0, total: 0, pct: 0 }, transition: null,
};

describe('RunHeader.Reviewers', () => {
  it('renders nothing during proposal', () => {
    const { container } = render(<RunHeader value={{ ...base, stage: 'proposal', reviewers: { count: 2, required: 3, divergent: 1 } }}><RunHeader.Center><RunHeader.Reviewers /></RunHeader.Center></RunHeader>);
    expect(container.querySelector('[data-testid="run-reviewers"]')).toBeNull();
  });
  it('renders avatars + a divergence chip after proposal', () => {
    render(<RunHeader value={{ ...base, stage: 'review', reviewers: { count: 2, required: 3, divergent: 3 } }}><RunHeader.Center><RunHeader.Reviewers /></RunHeader.Center></RunHeader>);
    expect(screen.getByTestId('run-reviewers')).toBeInTheDocument();
    expect(screen.getByText('runHeaderReviewersDiffer')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- runs/header/__tests__/Reviewers`
Expected: FAIL — `RunHeader.Reviewers` undefined.

- [ ] **Step 3: Write the slots + attach**

```tsx
// frontend/components/runs/header/Reviewers.tsx
import { GitFork } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useRunHeader } from './RunHeaderContext';

const AVATAR = ['bg-reviewer-1', 'bg-reviewer-2', 'bg-reviewer-3', 'bg-reviewer-4', 'bg-reviewer-5'];

export function Reviewers() {
  const { stage, reviewers, onJumpToDivergence } = useRunHeader();
  if (stage === 'proposal' || stage == null || reviewers.count === 0) return null;
  const shown = Math.min(reviewers.count, 3);
  return (
    <div className="flex items-center gap-2" data-testid="run-reviewers">
      <div className="flex -space-x-2" title={`${reviewers.count}/${reviewers.required}`}>
        {Array.from({ length: shown }).map((_, i) => (
          <span key={i} className={cn('h-[18px] w-[18px] rounded-full border-2 border-background', AVATAR[i % AVATAR.length])} aria-hidden="true" />
        ))}
        {reviewers.count > shown && (
          <span className="flex h-[18px] items-center rounded-full border-2 border-background bg-muted px-1 text-[10px] text-muted-foreground">+{reviewers.count - shown}</span>
        )}
      </div>
      {reviewers.divergent > 0 && (
        <button
          type="button"
          onClick={() => onJumpToDivergence?.()}
          className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <GitFork className="h-3 w-3" aria-hidden="true" />
          {t('extraction', 'runHeaderReviewersDiffer').replace('{{count}}', String(reviewers.divergent))}
        </button>
      )}
    </div>
  );
}
```

```tsx
// frontend/components/runs/header/SaveSlot.tsx
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/extraction/useAutoSaveProposals';

export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  if (hidden) return null;
  const failed = state === 'error';
  const label = state === 'saving' ? t('extraction', 'runHeaderSaving') : failed ? t('extraction', 'runHeaderSaveFailed') : t('extraction', 'runHeaderSaved');
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')} title={lastSavedAt ? lastSavedAt.toLocaleTimeString() : undefined}>
      <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-destructive' : 'bg-success')} aria-hidden="true" />
      {label}
    </span>
  );
}
```

(Confirm the exact `SaveState` union/import path against `useAutoSaveProposals` while implementing; the gathered report shows save state flows from `useAutoSaveProposals`. Match the real type name/path.)

```tsx
// frontend/components/runs/header/AIActions.tsx
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';

interface AIActionsProps {
  pendingCount: number;
  canExtract: boolean;
  extracting?: boolean;
  onExtract: () => void;
  onOpenSuggestions?: () => void;
}

export function AIActions({ pendingCount, canExtract, extracting, onExtract, onOpenSuggestions }: AIActionsProps) {
  if (canExtract) {
    return (
      <Button size="sm" variant="secondary" onClick={onExtract} disabled={extracting} className="gap-1.5">
        <Sparkles className="h-4 w-4 text-ai" aria-hidden="true" />
        {extracting ? t('extraction', 'extractingWithAI') : t('extraction', 'extractWithAI')}
      </Button>
    );
  }
  if (pendingCount <= 0) return null;
  return (
    <button type="button" onClick={() => onOpenSuggestions?.()} className="flex items-center gap-1.5 rounded-md border border-ai/40 bg-ai/10 px-2.5 py-0.5 text-[11px] text-ai focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />AI · {pendingCount}
    </button>
  );
}
```

The `extractWithAI` key was added in Task 3's copy block. Attach `Reviewers`, `SaveSlot` (as `Save`), `AIActions` to the compound export.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- runs/header/__tests__/Reviewers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/header/Reviewers.tsx frontend/components/runs/header/SaveSlot.tsx frontend/components/runs/header/AIActions.tsx frontend/components/runs/header/RunHeader.tsx frontend/lib/copy/extraction.ts frontend/components/runs/header/__tests__/Reviewers.test.tsx
git commit -m "feat(runs): Reviewers presence + ambient Save + AIActions slots"
```

---

### Task 7: Breadcrumb + Menu slots

**Files:**
- Create: `frontend/components/runs/header/Breadcrumb.tsx`, `frontend/components/runs/header/Menu.tsx`
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Test: `frontend/components/runs/header/__tests__/Breadcrumb.test.tsx`

**Interfaces:**
- `RunHeader.Breadcrumb` props: `{ onBack: () => void; crumbs: { label: string; onClick?: () => void }[] }` — back chevron + truncating crumbs.
- `RunHeader.Menu` props: `{ children: ReactNode }` — wraps a `DropdownMenu` (trigger = `MoreHorizontal`); `RunHeader.MenuItem` props `{ onSelect: () => void; children: ReactNode }`. (Reopen/Compare/Export live here; wired per page in Task 9.)

- [ ] **Step 1–5:** mirror Task 5's structure. Breadcrumb test: renders the back button (calls `onBack`) and the crumb labels, truncating the last. Menu test: clicking the trigger opens and a `MenuItem`'s `onSelect` fires. Implementation: Breadcrumb = `ChevronLeft` ghost button + `crumbs.map` with `truncate max-w-[…]` on the last; Menu = `DropdownMenu`/`DropdownMenuTrigger`(`MoreHorizontal`, `h-8 w-8 p-0`)/`DropdownMenuContent` + `DropdownMenuItem`. Attach both to the compound export. Commit `feat(runs): Breadcrumb + Menu slots`.

(Full code omitted here only because it is a direct, smaller application of the Task 5 pattern using `components/ui/dropdown-menu`; the implementer writes the test first, then the two components, exactly as above.)

- [ ] **Step 6: After this task, run the whole new lib suite + compiler check**

Run: `npm run test:run -- runs/header` and `npm run typecheck` and `node scripts/enumerate_compiler_bailouts.mjs | grep -i runs/header` (expect none).

---

### Task 8: Build the extraction `StageTransition` + guide-me in the page

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Test: extend an `ExtractionFullScreen`-level test or add `frontend/test/extractionStageTransition.test.ts` for the pure descriptor builder.

**Interfaces:**
- Produces: a `buildExtractionTransition(args)` pure helper returning a `StageTransition | null`, consumed by Task 9's `<RunHeader>` wiring. Extract the stage→action mapping (today's `:1032-1045` `finalizeLabel` logic) into this helper.

- [ ] **Step 1: Write the failing test** for `buildExtractionTransition` — given `{ stage:'review', canResolveConflicts:true, isComplete:false, completed:3, total:30, onReconcile, onGuide }` it returns `{ to:'consensus', label:'Reconcile', gate:{ok:false, remaining:27}, onAdvance:onGuide }`; given `isComplete:true` → `gate.ok:true, onAdvance:onReconcile`; `stage:'proposal'` → label `'Submit for review'`; viewer/no-action → `null`.
- [ ] **Step 2:** run, see it fail.
- [ ] **Step 3:** implement `buildExtractionTransition` (pure; no try/finally) in a new `frontend/lib/extraction/stageTransition.ts`, mapping stage+permissions+gate to the descriptor; `onAdvance = gate.ok ? realHandler : onGuide`.
- [ ] **Step 4:** run, pass.
- [ ] **Step 5: Commit** `feat(extraction): typed stage transition descriptor builder`.

(The guide-me `onGuide` itself — scroll+focus the first required-empty field — reuses the section registry/`useActiveSection` from the nav work: `onGuide` calls `scrollToSection(firstIncompleteSectionId)`. Wire the concrete `onGuide` in Task 9 where the registry is in scope.)

---

### Task 9: Re-skin ExtractionHeader onto RunHeader + fold the banner row

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx` (re-implement body as `<RunHeader>`; keep `ExtractionHeaderProps` identical)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (pass a `StageTransition` via `buildExtractionTransition`; remove the orphaned banner block `:1108-1139`; pass `reviewers`/`isRevision`/reveal/`onJumpToDivergence`/`onGuide`)
- Test: update `frontend/components/extraction/header/__tests__/` + the `ExtractionFullScreen` test to assert one bar (no `extraction-hitl-banner` testid) and the stage spine present.

**Interfaces:**
- Consumes: all `RunHeader.*` slots + `buildExtractionTransition` (Task 8).

- [ ] **Step 1: Write the failing test** — render `ExtractionHeader` with the existing fixture props; assert (a) `screen.getByRole('navigation', { name: 'Run stage' })` exists, (b) the primary button text is the verb only (no "(advance to consensus)"), (c) no element with `data-testid="extraction-hitl-banner"`.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3: Re-implement `ExtractionHeader`** as a `<RunHeader value={…}>` composition. Map the existing `ExtractionHeaderProps` into a `RunHeaderValue` (kind `'extraction'`, stage from a new optional `stage` prop or derived, progress from `completed/total/percentage`, reviewers from new optional props, `isBlind` from `isBlindMode`, `canReveal`/`onReveal` from new optional props, `transition` from a new `transition?: StageTransition` prop). Compose slots: `Left`(Breadcrumb + StageRail), `Center`(Reviewers + RoleChip), `Right`(AIActions + PanelToggle + Save + PrimaryAction + Menu[Compare/Reopen]). Keep the mobile layout working (stack zones under a container-query/`sm:` as today).
- [ ] **Step 4: Update `ExtractionFullScreen`** — build `transition = buildExtractionTransition({ stage, permissions, isComplete, completed, total, onReconcile: handleReconcile, onSubmit: handleSubmitForReview, onFinalize: handleFinalize, onGuide })`; pass `transition`, `isRevision={!!parentRunId}`, reviewers summary, `canReveal`/`onReveal` (from `permissions` + the existing reveal mutation), `onJumpToDivergence` (switch to compare view), and delete the banner block (`:1108-1139`) — Reopen moves into `RunHeader.Menu`.
- [ ] **Step 5:** run the header + page tests, `npm run test:run`, `npm run typecheck`, `npm run lint`, compiler-bailout check → all green.
- [ ] **Step 6: Commit** `feat(extraction): re-skin header onto shared RunHeader; fold HITL banner`.

- [ ] **Step 7: Visual verification (controller does this).** Run the app; confirm: one calm bar; the stage spine with Review current + completion underline + "N left"; primary button reads "Reconcile" (no parenthetical) and shows "N of M required" when gated; clicking it when gated scrolls to the first gap; PDF toggle is a panel button (not an eye); role chip reads "Manager · blind" with a working reveal popover; reviewer avatars + divergence chip appear once `stage !== 'proposal'`; no second banner row. Capture a screenshot.

---

## Final verification

- [ ] `npm run test:run` (full) · `npm run typecheck` · `npm run lint` · `node scripts/enumerate_compiler_bailouts.mjs` (none of the new files).
- [ ] `design-review` visual pass on the extraction route (one bar, full-width + PDF-open).

## Self-review notes (author)

- **Spec coverage (spec §3.3a):** StageRail → Task 3; gated PrimaryAction → Task 4 + builder Task 8; two eyes (PanelToggle + RoleChip) → Task 5; status economy (Save ambient, % into spine, fold banner) → Tasks 3/6/9; lib `<RunHeader>` → Tasks 1-2 + slots 3-7; reviewer presence → Task 6; honest blind/reveal → Task 5; AI weight → Task 6; extraction re-skin → Task 9. **Deferred to Plan 2 (stated in Scope note):** Worklist peek, Cmd-K long-tail + container-query collapse, QA migration.
- **Type consistency:** `RunHeaderValue`/`StageTransition` (Task 2) consumed unchanged by every slot and by Task 9; `stageNodeStates` (Task 1) → StageRail (Task 3); `buildExtractionTransition` (Task 8) returns the `StageTransition` PrimaryAction (Task 4) reads.
- **Constraints:** no `try/finally` (context guard throw is a bare guard; add `'use no memo'`+`// kept:` only if the compiler flags it); all strings via `lib/copy` (Task 3 adds the `runHeader*` + `extractWithAI` keys); no API/schema changes; reveal reuses the existing per-kind mutation.
- **Placeholder note:** Task 7 references Task 5's pattern rather than repeating ~40 lines of dropdown boilerplate — the implementer writes test-first using `components/ui/dropdown-menu`; this is the one spot that leans on a sibling pattern. Everything else carries full code.
