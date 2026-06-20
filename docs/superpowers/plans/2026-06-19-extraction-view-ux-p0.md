---
status: approved
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Extraction View UX — P0 Navigation + Density Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the long extraction form a persistent left section-navigation rail (status dots + counts + scrollspy + click-to-jump + global progress) and raise the form's density (dense rows with a capped, container-query-reflowing label column; flat sections instead of big cards).

**Architecture:** A single typed *section registry* (`buildSectionRegistry`) derives one `SectionNavItem[]` from the entity types + instances + values already flowing into `ExtractionFormView`, reusing the existing `computeRequiredFieldProgress` math. A `useActiveSection` scrollspy hook (IntersectionObserver, no `try/finally`) tracks the section owning the viewport. A presentational `SectionNavRail` renders the registry. `ExtractionFormView` mounts the rail as a sticky sibling of the scrolling section list and registers a ref per section. Density is a CSS-only change to `FieldInput` (capped label column + `@container`/`@md` reflow) and `SectionAccordion` (flat header, no card border — the completion color moves to the rail dot).

**Tech Stack:** React 19 + TypeScript strict, Vite, Tailwind + shadcn/Radix, TanStack Query, Vitest + Testing Library. New dev dep: `@tailwindcss/container-queries`.

**Source spec:** `docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md` (§3.0, §3.1 base layer, §3.2 dense row + flat sections; reconciled against `origin/dev` tip `024285f`).

**Scope note:** This is P0 part 1. Out of this plan (next plan): command palette + keyboard nav, top-tab responsive fallback, three-level progress copy, calmer validation timing, AI-strip consolidation, header eye/badge/gated-button fixes, panel-scoped PDF error. This plan ships a working, testable rail + denser form on its own.

## Global Constraints

Every task implicitly includes these (verbatim from the spec / project rules):

- **English only** for code, comments, and copy keys.
- **All user-facing strings via `frontend/lib/copy/`** — `t('extraction', 'key')`; never hardcode strings in components.
- **No schema / API / run-state changes.** The form's data arrives via the server RunView (`runViewAdapters`); do not add `supabase.from(...)` reads or new endpoints. Backend calls (none needed here) go through `frontend/integrations/api/client.ts`.
- **React Compiler runs at `panicThreshold: 'all_errors'`** (`vite.shared-plugins.ts`): no `try/finally` (or `throw` inside `try`) in component/hook bodies. Put any IO in a `frontend/services/*` function returning `ErrorResult<T>` (`frontend/lib/error-utils.ts:toResult`). Preserve existing `// kept:` memo comments.
- **Visible focus on every interactive element:** `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- **Tests run from the repo ROOT:** `npm run test:run` (vitest; plain `npm test` is watch mode — never use it). Tests live in `frontend/test/`. Mock copy with `vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }))`. Use `render`/`renderHook` from `@testing-library/react`. `frontend/test/setup.ts` already mocks `IntersectionObserver`, `ResizeObserver`, `matchMedia`, and PDF.js globally.
- **Tokens (reuse, do not invent):** rail surface `bg-muted/30`; hairlines `border-border/40`; text `text-foreground` / `text-muted-foreground`; section state → rail dot color `text-success` (complete) / `text-info` (in progress) / `text-muted-foreground` (empty); active rail row `bg-info/10`; control height `h-8`; row padding `py-2.5`; radii `rounded-md`/`rounded-lg`.

## File Structure

**Create:**
- `frontend/lib/extraction/sectionRegistry.ts` — pure builder: `SectionNavItem[]` + `GlobalProgress` from entity types/instances/values.
- `frontend/hooks/extraction/useActiveSection.ts` — scrollspy hook + pure `pickMostVisible` helper.
- `frontend/components/extraction/SectionNavRail.tsx` — presentational rail.
- Tests: `frontend/test/sectionRegistry.test.ts`, `frontend/test/useActiveSection.test.tsx`, `frontend/test/SectionNavRail.test.tsx`.

**Modify:**
- `frontend/components/extraction/ExtractionFormView.tsx` — build registry, mount rail, register section refs, wire scrollspy; new `showPDF` prop drives rail collapse.
- `frontend/components/extraction/ExtractionFormPanel.tsx` — pass `showPDF` into `ExtractionFormView`.
- `frontend/components/extraction/FieldInput.tsx` — dense capped-left row with `@container`/`@md` reflow.
- `frontend/components/extraction/SectionAccordion.tsx` — flat sticky header, drop the `bg-card border-l-4` card.
- `frontend/lib/copy/extraction.ts` — rail copy keys.
- `tailwind.config.ts` + `package.json` — add `@tailwindcss/container-queries`.
- `.markdownlintignore` — add this plan file.

**Locked interfaces (use these EXACT names/signatures across tasks):**

```ts
// sectionRegistry.ts
export type SectionNavState = 'complete' | 'in_progress' | 'empty';
export interface SectionNavItem {
  id: string; label: string;
  requiredTotal: number; requiredFilled: number;
  state: SectionNavState; level: 0 | 1;
}
export interface BuildSectionRegistryArgs {
  studyLevelSections: ExtractionEntityTypeWithFields[];
  modelParentEntityType?: ExtractionEntityTypeWithFields;
  modelChildSections: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  activeModelId: string | null;
}
export function buildSectionRegistry(args: BuildSectionRegistryArgs): SectionNavItem[];
export interface GlobalProgress { requiredFilled: number; requiredTotal: number; requiredLeft: number; percentage: number; }
export function globalProgressFromRegistry(items: SectionNavItem[]): GlobalProgress;

// useActiveSection.ts
export function pickMostVisible(entries: IntersectionObserverEntry[], current: string | null): string | null;
export interface UseActiveSectionResult {
  activeId: string | null;
  registerSection: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
}
export function useActiveSection(sectionIds: string[]): UseActiveSectionResult;

// SectionNavRail.tsx
export interface SectionNavRailProps {
  items: SectionNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
}
```

These rely on existing types/helpers (do not redefine): `ExtractionEntityTypeWithFields`, `ExtractionInstance`, `ExtractionValue`, `ExtractionField` (`frontend/types/extraction.ts`); `computeRequiredFieldProgress(values, entityTypes: ProgressEntityProjection[], instanceIdsByEntityType?: Map<string, Set<string>>): RequiredFieldProgress` and `RequiredFieldProgress { completedFields; totalFields; completionPercentage; isComplete }` (`frontend/lib/extraction/progress.ts`).

---

### Task 1: Section registry (pure builder)

**Files:**
- Create: `frontend/lib/extraction/sectionRegistry.ts`
- Test: `frontend/test/sectionRegistry.test.ts`

**Interfaces:**
- Consumes: `computeRequiredFieldProgress` (`@/lib/extraction/progress`); types from `@/types/extraction`.
- Produces: `SectionNavItem`, `SectionNavState`, `BuildSectionRegistryArgs`, `buildSectionRegistry`, `GlobalProgress`, `globalProgressFromRegistry` (signatures above).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/sectionRegistry.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildSectionRegistry,
  globalProgressFromRegistry,
  type BuildSectionRegistryArgs,
} from '@/lib/extraction/sectionRegistry';
import type { ExtractionEntityTypeWithFields, ExtractionInstance } from '@/types/extraction';

function field(id: string, required: boolean) {
  return {
    id, entity_type_id: 'et', name: id, label: id, description: null,
    field_type: 'text' as const, is_required: required, validation_schema: null,
    allowed_values: null, unit: null, allowed_units: null, llm_description: null,
    sort_order: 0, created_at: '',
  };
}
function entity(id: string, role: ExtractionEntityTypeWithFields['role'], cardinality: 'one' | 'many', fields: ReturnType<typeof field>[]): ExtractionEntityTypeWithFields {
  return {
    id, template_id: 't', name: id, label: `Label ${id}`, description: null,
    parent_entity_type_id: null, cardinality, role, sort_order: 0,
    is_required: true, created_at: '', fields: fields.map(f => ({ ...f, entity_type_id: id })),
  };
}
function instance(id: string, entity_type_id: string, parent_instance_id: string | null = null): ExtractionInstance {
  return {
    id, project_id: 'p', article_id: 'a', template_id: 't', entity_type_id,
    parent_instance_id, label: id, sort_order: 0, status: 'pending',
    metadata: null, created_by: 'u', created_at: '', updated_at: '',
  };
}

describe('buildSectionRegistry', () => {
  it('marks a study section complete when all required fields are filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const args: BuildSectionRegistryArgs = {
      studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')],
      values: { i1_f1: 'x', i1_f2: 'y' }, activeModelId: null,
    };
    const [item] = buildSectionRegistry(args);
    expect(item).toMatchObject({ id: 's1', label: 'Label s1', requiredTotal: 2, requiredFilled: 2, state: 'complete', level: 0 });
  });

  it('marks in_progress when partially filled and empty when none filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const partial = buildSectionRegistry({ studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')], values: { i1_f1: 'x' }, activeModelId: null })[0];
    const empty = buildSectionRegistry({ studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')], values: {}, activeModelId: null })[0];
    expect(partial.state).toBe('in_progress');
    expect(empty.state).toBe('empty');
  });

  it('emits model container at level 0 and model children at level 1, scoped to the active model', () => {
    const study = entity('s1', 'study_section', 'one', [field('f1', true)]);
    const container = entity('mc', 'model_container', 'many', []);
    const child = entity('cs', 'model_section', 'many', [field('cf', true)]);
    const items = buildSectionRegistry({
      studyLevelSections: [study], modelParentEntityType: container, modelChildSections: [child],
      instances: [instance('i1', 's1'), instance('m1', 'mc'), instance('ci', 'cs', 'm1')],
      values: { ci_cf: 'done' }, activeModelId: 'm1',
    });
    expect(items.map(i => [i.id, i.level])).toEqual([['s1', 0], ['mc', 0], ['cs', 1]]);
    expect(items.find(i => i.id === 'cs')).toMatchObject({ requiredTotal: 1, requiredFilled: 1, state: 'complete' });
  });

  it('globalProgressFromRegistry sums required and computes left + percentage', () => {
    const items = [
      { id: 'a', label: 'A', requiredTotal: 2, requiredFilled: 2, state: 'complete' as const, level: 0 as const },
      { id: 'b', label: 'B', requiredTotal: 6, requiredFilled: 0, state: 'empty' as const, level: 0 as const },
    ];
    expect(globalProgressFromRegistry(items)).toEqual({ requiredFilled: 2, requiredTotal: 8, requiredLeft: 6, percentage: 25 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- sectionRegistry`
Expected: FAIL — `Failed to resolve import "@/lib/extraction/sectionRegistry"`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/extraction/sectionRegistry.ts
import { computeRequiredFieldProgress } from '@/lib/extraction/progress';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';

export type SectionNavState = 'complete' | 'in_progress' | 'empty';

export interface SectionNavItem {
  id: string;
  label: string;
  requiredTotal: number;
  requiredFilled: number;
  state: SectionNavState;
  level: 0 | 1;
}

export interface BuildSectionRegistryArgs {
  studyLevelSections: ExtractionEntityTypeWithFields[];
  modelParentEntityType?: ExtractionEntityTypeWithFields;
  modelChildSections: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  activeModelId: string | null;
}

function instanceIdsFor(
  entityTypeId: string,
  instances: ExtractionInstance[],
  parentInstanceId?: string | null,
): Map<string, Set<string>> {
  const ids = new Set<string>();
  for (const inst of instances) {
    if (inst.entity_type_id !== entityTypeId) continue;
    if (parentInstanceId !== undefined && inst.parent_instance_id !== parentInstanceId) continue;
    ids.add(inst.id);
  }
  return new Map([[entityTypeId, ids]]);
}

function toState(filled: number, total: number): SectionNavState {
  if (total > 0 && filled === total) return 'complete';
  if (filled > 0) return 'in_progress';
  return 'empty';
}

function sectionItem(
  et: ExtractionEntityTypeWithFields,
  level: 0 | 1,
  values: Record<string, ExtractionValue>,
  instances: ExtractionInstance[],
  parentInstanceId?: string | null,
): SectionNavItem {
  const idMap = instanceIdsFor(et.id, instances, parentInstanceId);
  const progress = computeRequiredFieldProgress(
    values,
    [{ id: et.id, fields: et.fields, is_required: et.is_required }],
    idMap,
  );
  return {
    id: et.id,
    label: et.label,
    requiredTotal: progress.totalFields,
    requiredFilled: progress.completedFields,
    state: toState(progress.completedFields, progress.totalFields),
    level,
  };
}

export function buildSectionRegistry(args: BuildSectionRegistryArgs): SectionNavItem[] {
  const items: SectionNavItem[] = [];
  for (const et of args.studyLevelSections) {
    items.push(sectionItem(et, 0, args.values, args.instances));
  }
  if (args.modelParentEntityType) {
    items.push(sectionItem(args.modelParentEntityType, 0, args.values, args.instances));
    for (const child of args.modelChildSections) {
      items.push(sectionItem(child, 1, args.values, args.instances, args.activeModelId));
    }
  }
  return items;
}

export interface GlobalProgress {
  requiredFilled: number;
  requiredTotal: number;
  requiredLeft: number;
  percentage: number;
}

export function globalProgressFromRegistry(items: SectionNavItem[]): GlobalProgress {
  const requiredTotal = items.reduce((n, i) => n + i.requiredTotal, 0);
  const requiredFilled = items.reduce((n, i) => n + i.requiredFilled, 0);
  const requiredLeft = Math.max(0, requiredTotal - requiredFilled);
  const percentage = requiredTotal > 0 ? Math.round((requiredFilled / requiredTotal) * 100) : 0;
  return { requiredFilled, requiredTotal, requiredLeft, percentage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- sectionRegistry`
Expected: PASS (4 tests). If `computeRequiredFieldProgress`'s value-key format differs, fix the test fixtures to match `${instanceId}_${fieldId}` (already used above) — do not change the helper.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/sectionRegistry.ts frontend/test/sectionRegistry.test.ts
git commit -m "feat(extraction): section registry builder for nav rail"
```

---

### Task 2: Active-section scrollspy hook

**Files:**
- Create: `frontend/hooks/extraction/useActiveSection.ts`
- Test: `frontend/test/useActiveSection.test.tsx`

**Interfaces:**
- Produces: `pickMostVisible(entries, current)`, `useActiveSection(sectionIds): UseActiveSectionResult { activeId, registerSection, scrollToSection }`.
- Consumed by: Task 4 (`ExtractionFormView`).

Rationale: the global `IntersectionObserver` mock in `setup.ts` does not fire callbacks, so the *selection logic* is extracted into the pure `pickMostVisible` (unit-tested directly), and the hook test covers `scrollToSection` (calls `scrollIntoView` + focus). No `try/finally` anywhere.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/useActiveSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pickMostVisible, useActiveSection } from '@/hooks/extraction/useActiveSection';

function entry(id: string, ratio: number, isIntersecting: boolean): IntersectionObserverEntry {
  return {
    target: Object.assign(document.createElement('div'), { dataset: { sectionId: id } }),
    intersectionRatio: ratio,
    isIntersecting,
  } as unknown as IntersectionObserverEntry;
}

describe('pickMostVisible', () => {
  it('returns the id of the most-visible intersecting section', () => {
    expect(pickMostVisible([entry('a', 0.2, true), entry('b', 0.7, true)], null)).toBe('b');
  });
  it('keeps the current id when nothing is intersecting', () => {
    expect(pickMostVisible([entry('a', 0, false)], 'a')).toBe('a');
  });
});

describe('useActiveSection', () => {
  it('scrollToSection scrolls and focuses the registered element', () => {
    const { result } = renderHook(() => useActiveSection(['s1']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(focus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- useActiveSection`
Expected: FAIL — cannot resolve `@/hooks/extraction/useActiveSection`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/hooks/extraction/useActiveSection.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function pickMostVisible(
  entries: IntersectionObserverEntry[],
  current: string | null,
): string | null {
  let bestId = current;
  let bestRatio = -1;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = (e.target as HTMLElement).dataset.sectionId ?? null;
    if (id && e.intersectionRatio > bestRatio) {
      bestRatio = e.intersectionRatio;
      bestId = id;
    }
  }
  return bestId;
}

export interface UseActiveSectionResult {
  activeId: string | null;
  registerSection: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
}

export function useActiveSection(sectionIds: string[]): UseActiveSectionResult {
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);
  const refs = useRef(new Map<string, HTMLElement>());
  const activeRef = useRef<string | null>(activeId);
  activeRef.current = activeId;

  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      el.dataset.sectionId = id;
      refs.current.set(id, el);
    } else {
      refs.current.delete(id);
    }
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = refs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, []);

  const key = sectionIds.join('|');
  useEffect(() => {
    const observed = [...refs.current.values()];
    if (observed.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => setActiveId(pickMostVisible(entries, activeRef.current)),
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return { activeId, registerSection, scrollToSection };
}
```

Note: `el.focus({ preventScroll: true })` plus `scrollIntoView` keeps smooth scroll while moving keyboard focus into the section (the section wrapper gets `tabIndex={-1}` in Task 4). The cleanup `return () => observer.disconnect()` is an effect cleanup, not a `try/finally` — compiler-safe.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- useActiveSection`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useActiveSection.ts frontend/test/useActiveSection.test.tsx
git commit -m "feat(extraction): scrollspy hook for active section"
```

---

### Task 3: Section nav rail component + copy

**Files:**
- Create: `frontend/components/extraction/SectionNavRail.tsx`
- Modify: `frontend/lib/copy/extraction.ts` (add rail keys)
- Test: `frontend/test/SectionNavRail.test.tsx`

**Interfaces:**
- Consumes: `SectionNavItem` (Task 1), `globalProgressFromRegistry` (Task 1).
- Produces: `SectionNavRail` (default export) + `SectionNavRailProps`.

- [ ] **Step 1: Add copy keys**

In `frontend/lib/copy/extraction.ts`, add near the other section keys (e.g. after `noModelsAddedDesc`):

```ts
    // Section navigation rail
    sectionNavRequiredLeft: '{{count}} required left',
    sectionNavComplete: 'All required fields complete',
    sectionNavAria: 'Section navigation',
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/test/SectionNavRail.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SectionNavRail from '@/components/extraction/SectionNavRail';
import type { SectionNavItem } from '@/lib/extraction/sectionRegistry';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const items: SectionNavItem[] = [
  { id: 's1', label: 'Source of data', requiredTotal: 1, requiredFilled: 1, state: 'complete', level: 0 },
  { id: 's2', label: 'Participants', requiredTotal: 12, requiredFilled: 3, state: 'in_progress', level: 0 },
  { id: 'cs', label: 'Predictors', requiredTotal: 6, requiredFilled: 0, state: 'empty', level: 1 },
];

describe('SectionNavRail', () => {
  it('renders one row per section with its count and marks the active row', () => {
    render(<SectionNavRail items={items} activeId="s2" onSelect={() => {}} />);
    expect(screen.getByText('Source of data')).toBeInTheDocument();
    expect(screen.getByText('3/12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Participants/ })).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect with the section id when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<SectionNavRail items={items} activeId="s1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Predictors/ }));
    expect(onSelect).toHaveBeenCalledWith('cs');
  });

  it('shows global required-left in the footer', () => {
    render(<SectionNavRail items={items} activeId="s1" onSelect={() => {}} />);
    expect(screen.getByText('sectionNavRequiredLeft')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- SectionNavRail`
Expected: FAIL — cannot resolve `@/components/extraction/SectionNavRail`.

- [ ] **Step 4: Write the implementation**

```tsx
// frontend/components/extraction/SectionNavRail.tsx
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { Progress } from '@/components/ui/progress';
import {
  globalProgressFromRegistry,
  type SectionNavItem,
  type SectionNavState,
} from '@/lib/extraction/sectionRegistry';

export interface SectionNavRailProps {
  items: SectionNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
}

const DOT_COLOR: Record<SectionNavState, string> = {
  complete: 'bg-success',
  in_progress: 'bg-info',
  empty: 'bg-muted-foreground/40',
};

export default function SectionNavRail({ items, activeId, onSelect, collapsed }: SectionNavRailProps) {
  const global = globalProgressFromRegistry(items);
  return (
    <nav
      aria-label={t('extraction', 'sectionNavAria')}
      className={cn(
        'sticky top-0 self-start flex flex-col bg-muted/30 border-r border-border/40 py-2',
        collapsed ? 'w-11 items-center' : 'w-[184px]',
      )}
    >
      <ul className="flex-1 space-y-px">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
                title={collapsed ? `${item.label} — ${item.requiredFilled}/${item.requiredTotal}` : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground',
                  'hover:bg-muted/40 duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  item.level === 1 && !collapsed && 'pl-6',
                  isActive && 'bg-info/10 text-foreground',
                )}
              >
                <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', DOT_COLOR[item.state])} aria-hidden="true" />
                {!collapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                      {item.requiredFilled}/{item.requiredTotal}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!collapsed && (
        <div className="mt-2 border-t border-border/40 px-2.5 pt-2">
          <Progress value={global.percentage} className="h-1" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {global.requiredLeft > 0
              ? t('extraction', 'sectionNavRequiredLeft').replace('{{count}}', String(global.requiredLeft))
              : t('extraction', 'sectionNavComplete')}
          </p>
        </div>
      )}
    </nav>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- SectionNavRail`
Expected: PASS (3 tests). If `Progress` import path differs, confirm `frontend/components/ui/progress.tsx` exists (it does) and exports `Progress`.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/SectionNavRail.tsx frontend/lib/copy/extraction.ts frontend/test/SectionNavRail.test.tsx
git commit -m "feat(extraction): SectionNavRail component"
```

---

### Task 4: Wire the rail into ExtractionFormView

**Files:**
- Modify: `frontend/components/extraction/ExtractionFormView.tsx`
- Modify: `frontend/components/extraction/ExtractionFormPanel.tsx`
- Test: extend `frontend/test/ExtractionFormView.test.tsx`

**Interfaces:**
- Consumes: `buildSectionRegistry` (Task 1), `useActiveSection` (Task 2), `SectionNavRail` (Task 3).
- `ExtractionFormViewProps` gains: `showPDF?: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/test/ExtractionFormView.test.tsx` (the existing mock of `SectionAccordion` and the copy/hook mocks at the top stay):

```tsx
import { fireEvent } from '@testing-library/react';

it('renders a section nav rail with a row per study section', () => {
  // renderFormView is the existing helper in this file that mounts
  // ExtractionFormView with the standard fixture props; reuse it.
  renderFormView();
  const nav = screen.getByRole('navigation', { name: 'sectionNavAria' });
  // one rail button per study-level section fixture (adjust count to the fixture)
  expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);
});
```

If the file has no shared `renderFormView`/`within` import, add `import { within } from '@testing-library/react';` and mount `ExtractionFormView` with the same prop object the other tests use. Mock the new hook so the test is deterministic:

```tsx
vi.mock('@/hooks/extraction/useActiveSection', () => ({
  useActiveSection: () => ({ activeId: null, registerSection: vi.fn(), scrollToSection: vi.fn() }),
  pickMostVisible: vi.fn(),
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- ExtractionFormView`
Expected: FAIL — no element with role `navigation` / name `sectionNavAria`.

- [ ] **Step 3: Add `showPDF` to the props interface**

In `ExtractionFormView.tsx`, add to `ExtractionFormViewProps` (after `onExtractionComplete?`):

```ts
  /** When true (PDF panel open / narrow), the section rail collapses to a dot strip. */
  showPDF?: boolean;
```

- [ ] **Step 4: Build the registry + scrollspy and mount the rail**

Near the top of the `ExtractionFormView` component body, after props are in scope:

```tsx
const sectionRegistry = buildSectionRegistry({
  studyLevelSections: props.studyLevelSections,
  modelParentEntityType: props.modelParentEntityType,
  modelChildSections: props.modelChildSections,
  instances: props.instances,
  values: props.values,
  activeModelId: props.activeModelId,
});
const sectionIds = sectionRegistry.map((s) => s.id);
const { activeId, registerSection, scrollToSection } = useActiveSection(sectionIds);
```

Imports at top of file:

```tsx
import SectionNavRail from '@/components/extraction/SectionNavRail';
import { buildSectionRegistry } from '@/lib/extraction/sectionRegistry';
import { useActiveSection } from '@/hooks/extraction/useActiveSection';
```

Wrap the existing returned content in a flex row with the rail as the sticky first child. The existing top-level wrapper (the element that contains the `studyLevelSections.map(...)` and the `ModelSection`) becomes the second column. Each study section gets a ref-registering wrapper with `tabIndex={-1}` and `scroll-mt`:

```tsx
return (
  <div className="flex gap-4">
    <SectionNavRail
      items={sectionRegistry}
      activeId={activeId}
      onSelect={scrollToSection}
      collapsed={props.showPDF}
    />
    <div className="min-w-0 flex-1 space-y-4">
      {props.studyLevelSections.map((entityType) => {
        const typeInstances = props.instances.filter((i) => i.entity_type_id === entityType.id);
        return (
          <div
            key={entityType.id}
            ref={(el) => registerSection(entityType.id, el)}
            tabIndex={-1}
            className="scroll-mt-4 outline-none"
          >
            <SectionAccordion
              entityType={entityType}
              instances={typeInstances}
              fields={entityType.fields}
              values={props.values}
              onValueChange={props.updateValue}
              projectId={props.projectId}
              articleId={props.articleId}
              templateId={props.templateId}
              runId={props.runId}
              aiSuggestions={props.aiSuggestions}
              onAcceptAI={props.acceptSuggestion}
              onRejectAI={props.rejectSuggestion}
              getSuggestionsHistory={props.getSuggestionsHistory}
              isActionLoading={props.isActionLoading}
              onAddInstance={() => props.handleAddInstance(entityType.id)}
              onRemoveInstance={props.handleRemoveInstance}
              onExtractionComplete={props.onExtractionComplete}
            />
          </div>
        );
      })}
      {props.modelParentEntityType && (
        <div
          ref={(el) => registerSection(props.modelParentEntityType!.id, el)}
          tabIndex={-1}
          className="scroll-mt-4 outline-none"
        >
          {/* existing <ModelSection .../> JSX, unchanged */}
        </div>
      )}
    </div>
  </div>
);
```

Preserve the exact `ModelSection` props/JSX already present (lines ~105-140) inside the new ref wrapper — do not change them. If `SectionAccordion` was previously mapped with a different prop set, keep that exact set; only the wrapping `<div ref=…>` is new.

- [ ] **Step 5: Pass `showPDF` from the panel**

In `ExtractionFormPanel.tsx`, the render of `ExtractionFormView` (line ~52) becomes:

```tsx
<ExtractionFormView {...formViewProps} showPDF={showPDF} />
```

(`showPDF` is already a prop of `ExtractionFormPanelProps`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- ExtractionFormView`
Expected: PASS, including the existing `data-testid="section-…"` assertions (the section wrappers are additive — existing queries still match the mocked `SectionAccordion` inside them).

- [ ] **Step 7: Verify the React Compiler is happy + typecheck**

Run: `npm run typecheck`
Run: `node scripts/enumerate_compiler_bailouts.mjs` — confirm `ExtractionFormView.tsx`, `useActiveSection.ts`, `SectionNavRail.tsx` are NOT listed as new bailouts.
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/extraction/ExtractionFormView.tsx frontend/components/extraction/ExtractionFormPanel.tsx frontend/test/ExtractionFormView.test.tsx
git commit -m "feat(extraction): mount section nav rail in form view"
```

---

### Task 5: Dense field row + container-query reflow

**Files:**
- Modify: `package.json`, `tailwind.config.ts` (add container-queries plugin)
- Modify: `frontend/components/extraction/FieldInput.tsx`
- Modify: `frontend/components/extraction/ExtractionFormPanel.tsx` (mark the scroll wrapper a `@container`)
- Test: `frontend/test/FieldInput.density.test.tsx`

**Interfaces:** none new. CSS-only behavior change.

- [ ] **Step 1: Install the container-queries plugin**

Run (from repo ROOT): `npm install -D @tailwindcss/container-queries`
Then in `tailwind.config.ts`, import it and add to `plugins`:

```ts
import containerQueries from '@tailwindcss/container-queries';
// ...
plugins: [tailwindcssAnimate, containerQueries],
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/test/FieldInput.density.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FieldInput } from '@/components/extraction/FieldInput';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const field = {
  id: 'f1', entity_type_id: 'et', name: 'f1', label: 'Recruitment method', description: 'desc',
  field_type: 'text' as const, is_required: true, validation_schema: null, allowed_values: null,
  unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '',
};

describe('FieldInput density', () => {
  it('uses the capped-left container-query grid, not the viewport breakpoint', () => {
    const { container } = render(
      <FieldInput field={field} instanceId="i1" value="" onChange={() => {}} />,
    );
    const row = container.querySelector('[data-field-row]') as HTMLElement;
    expect(row.className).toContain('@md:grid-cols-[minmax(0,232px)_1fr]');
    expect(row.className).not.toContain('sm:grid-cols-[30%_1fr]');
  });
});
```

(If `FieldInput`'s required props differ, match the call to the existing usage — the key assertion is the className. Add `data-field-row` to the grid element in Step 4.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- FieldInput.density`
Expected: FAIL — className still contains `sm:grid-cols-[30%_1fr]`.

- [ ] **Step 4: Apply the dense grid in `FieldInput.tsx`**

Change the density variables (lines ~68-71):

```ts
const containerPadding = 'py-2.5';
const inputHeight = 'h-8';
const gap = 'gap-x-3.5 gap-y-1';
```

Change the grid wrapper (line ~384) and add the `data-field-row` hook:

```tsx
<div
  data-field-row
  className={cn(
    'grid grid-cols-1 @md:grid-cols-[minmax(0,232px)_1fr] items-start',
    'border-b border-border/40 last:border-b-0 transition-colors',
    containerPadding, gap,
  )}
>
```

(Keep the existing label/description/input children unchanged; only the wrapper classes and the three density vars change. Drop any stray `pt-2` on the label block so it aligns with the shorter row.)

- [ ] **Step 5: Mark the form scroll wrapper a container**

In `ExtractionFormPanel.tsx`, add the `@container` class to the inner content `div` (line ~50) so `@md` resolves against the form panel width, not the viewport:

```tsx
<div className="@container p-8 space-y-4">
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:run -- FieldInput.density`
Expected: PASS.

- [ ] **Step 7: Visual check**

Verify in the running app (preview server on :8080, route `/projects/:projectId/extraction/:articleId`): rows are visibly denser; with the PDF panel open the field labels stack above inputs (no wrapping). Capture a screenshot.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts frontend/components/extraction/FieldInput.tsx frontend/components/extraction/ExtractionFormPanel.tsx frontend/test/FieldInput.density.test.tsx
git commit -m "feat(extraction): dense field rows with container-query reflow"
```

---

### Task 6: Flatten section cards to flat sticky headers

**Files:**
- Modify: `frontend/components/extraction/SectionAccordion.tsx`
- Test: `frontend/test/SectionAccordion.flat.test.tsx`

**Interfaces:** none new. The per-section count+percent stays for now (three-level progress copy is a later plan); this task only removes the heavy card chrome — completion color already lives on the rail dot (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/SectionAccordion.flat.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SectionAccordion } from '@/components/extraction/SectionAccordion';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const entityType = {
  id: 'et1', template_id: 't', name: 'participants', label: 'Participants', description: null,
  parent_entity_type_id: null, cardinality: 'one' as const, role: 'study_section' as const,
  sort_order: 0, is_required: true, created_at: '',
};

describe('SectionAccordion flat header', () => {
  it('does not wrap the section in the heavy bg-card border-l-4 card', () => {
    const { container } = render(
      <SectionAccordion
        entityType={entityType} instances={[]} fields={[]} values={{}}
        onValueChange={() => {}} projectId="p" articleId="a" templateId="t"
      />,
    );
    expect(container.querySelector('.border-l-4')).toBeNull();
    expect(container.querySelector('.bg-card')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- SectionAccordion.flat`
Expected: FAIL — `.border-l-4` / `.bg-card` still present.

- [ ] **Step 3: Flatten the wrapper**

In `SectionAccordion.tsx`:

- Delete the `borderColor` computation (lines ~138-143) — the rail dot carries that signal now.
- Change the `Accordion` wrapper (line ~155-160) from:

```tsx
<Accordion type="single" collapsible defaultValue={entityType.id}
  className={cn("bg-card border-l-4", borderColor)}>
```

to:

```tsx
<Accordion type="single" collapsible defaultValue={entityType.id}
  className="border-b border-border/40 last:border-b-0">
```

- Make the header row a flat sticky bar — change the header wrapper (line ~162) from `px-6 py-4 hover:bg-muted/40 …` to:

```tsx
<div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm px-3 py-2 hover:bg-muted/40 transition-colors duration-75">
```

- Reduce the section title from `text-base` to `text-[14px]` (line ~173): `<h3 className="font-medium text-[14px]">{entityType.label}</h3>`.
- Change `AccordionContent` padding (line ~236) from `px-8 pb-8` to `px-3 pb-4`.

Leave the ✨ extract button, chevron, and the `{completedRequired}/{totalRequired} {progressPercentage}%` render unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- SectionAccordion.flat`
Expected: PASS.

- [ ] **Step 5: Run the full extraction test file group + typecheck**

Run: `npm run test:run -- extraction`
Run: `npm run typecheck`
Expected: PASS (no regressions in SectionAccordion / ExtractionFormView).

- [ ] **Step 6: Visual check + commit**

Verify the form in the preview: sections are flat with hairline dividers and a sticky header; the rail dots carry the complete/partial color. Screenshot, then:

```bash
git add frontend/components/extraction/SectionAccordion.tsx frontend/test/SectionAccordion.flat.test.tsx
git commit -m "feat(extraction): flatten section cards to flat sticky headers"
```

---

## Final verification

- [ ] Run the whole frontend suite: `npm run test:run`
- [ ] Typecheck: `npm run typecheck`
- [ ] Lint: `npm run lint`
- [ ] Compiler bailouts unchanged: `node scripts/enumerate_compiler_bailouts.mjs`
- [ ] Visual pass with `design-review` on the extraction route (rail, density, PDF-open reflow), full-width and PDF-open.

## Self-review notes (author)

- **Spec coverage (this plan = spec §3.0, §3.1 base layer, §3.2 dense row + flat sections):** registry §3.0 → Task 1; scrollspy/rail/global progress §3.1 base → Tasks 2-4; dense row + container-query §3.2 → Task 5; flat sections §3.2 → Task 6. Deferred to P0 part 2 (stated in Scope note): palette/keyboard (§3.1 layer), tab fallback (§3.1), three-level progress copy, calmer validation, AI-strip consolidation, header §3.3. No spec item in this plan's scope is unassigned.
- **Type consistency:** `SectionNavItem`/`buildSectionRegistry`/`globalProgressFromRegistry` (Task 1) are consumed unchanged in Tasks 3-4; `useActiveSection`/`registerSection`/`scrollToSection` (Task 2) consumed in Task 4 with matching signatures; `SectionNavRailProps` (Task 3) matches the call site in Task 4 (`items`, `activeId`, `onSelect`, `collapsed`).
- **No placeholders:** every code step shows real code; every run step shows the command + expected result.
- **Constraint checks:** no `try/finally` in the hook (effect cleanup only); container-queries plugin install is a real prerequisite (Task 5 Step 1); copy keys routed through `lib/copy` (Task 3 Step 1); no API/schema changes.
