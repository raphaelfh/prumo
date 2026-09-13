---
status: in_progress
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Borderless Density Pass — Settings (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cards, callouts and nested frames on Project → Configuration, user Profile/Security and Settings → Integrations with a flat label/value grid of quiet controls, and retire `SettingsCard` and `SettingsField` behind a fitness gate.

**Architecture:** New settings primitives (`SettingsPage`, `SettingsGroup`, `SettingsRow`, `SettingsActions`, `FieldHint`) and a `quiet` cva variant on `Input`/`Textarea`/`SelectTrigger` land first, with `FormControl` merging `aria-describedby`; each surface then migrates in its own task with its copy keys and tests; the last code task deletes the retired components and extends the fitness scripts. No behaviour, data or endpoint changes.

**Tech Stack:** React 19 + Vite, TypeScript strict, Tailwind v4.3.3, shadcn/Radix, react-hook-form + Zod, Vitest + Testing Library, Python fitness scripts with pytest.

**Spec:** `docs/superpowers/specs/2026-09-13-borderless-density-pass-design.md` (PR 1 rows of §4.3, §4.1, §4.2, §4.4, §5, §6, §7, and §10). PR 2 (article panel) is a separate plan.

## Global Constraints

Every task's requirements implicitly include this section. Implementers: this file is also at `.superpowers/sdd/2026-09-13-borderless-density-pass-settings/global-constraints.md` — read it before starting.

**Working rules**

- Work only in `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/compassionate-gauss-c094d0`. Frontend tooling runs from that repo root (no `frontend/package.json`; never `cd frontend`).
- Do not spawn agents or background tasks. Write your report file first and append as you go.
- One git command per shell call (the worktree guard refuses chained git). Never `git stash`. Never `make db-fresh` / `make reset-db`; never touch `alembic_version`.
- English only for code, comments, commits and copy keys. Conventional commits ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Test-first: write the failing test, run it red, implement, run it green, commit.

**Gates (run on your task head before reporting done; report the tail of each output)**

- `npm run test:run -- <touched test files>` during the task, then the full `npm run test:run`
- `npm run typecheck`
- `npm run lint`
- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` — zero findings
- `bash scripts/fitness/run_all.sh` — copy keys, UI primitives, retired symbols, button scale, file size

**Scope and behaviour**

- No behaviour or data changes: the batched project-settings save, the review question's section-owned save, save-on-change for the AI engine and the visibility and parsing switches stay as they are; so do endpoints, permissions and non-manager capabilities.
- Out-of-scope screens keep their look: the `default` variant of every `ui/*` control keeps today's classes byte-for-byte.
- Copy meaning is kept. The only copy text edits: `consensus.tabConsensusDesc` → "Consensus rule and arbitrator"; `parsing.highQualityHint` gains "Applies to newly ingested PDFs.".
- A copy key whose element is removed is deleted in the same task, after `grep -rn "<key>" frontend/` (tests and e2e included) finds no other reference. The copy-key ratchet fails on any orphaned key in `frontend/lib/copy/*.ts`. A new key is added in the task that first uses it.
- `t()` does no interpolation: substitute with `.replace('{{label}}', label)` (idiom of `frontend/components/articles/ArticleKeywordsField.tsx:19`).
- Tests that asserted a removed title or description are updated to assert the same information via row labels, intro lines or hints — never deleted blind.
- These must pass unchanged: `frontend/test/SecuritySection.validation.test.tsx:88-90`, `frontend/test/components/ArticleFormChrome.test.tsx:57-69`, `frontend/e2e/flows/settings-connections.e2e.ts:15`, `frontend/test/components/ManagerReviewVisibilityToggle.test.tsx`, `frontend/components/ui/form.validation.test.tsx`, `frontend/test/AddProjectDialog.validation.test.tsx`, `frontend/test/CreateCustomTemplateDialog.validation.test.tsx`, `frontend/components/extraction/dialogs/AddSectionDialog.test.tsx`.
- `check_button_scale.baseline`: for every touched file whose count drops, edit that entry by hand. Never `--update-baseline` (it rewrites every entry).
- File-size cap is 800 lines per file.

**Tailwind / Radix mechanics**

- Tailwind is v4.3.3. jsdom sees no layout and no compiled CSS: pin grid, stacking and visual rules with class-contract tests (`toHaveClass`), and leave visuals to the browser pass.
- `cn()` lets a caller's class beat the variant: every migrated call site removes its `h-*`, `text-*`, `px-*`, `pl-*`, `pr-*` overrides on quiet controls (`h-9 text-[13px]`, `h-8 text-[13px]`, `h-7 text-[13px]`, `pl-8`, `pr-20`). Width classes stay.
- Radix `Slot` lets the child's props win (only `on*`, `style`, `className` merge). A hinted or errored row therefore uses the `SettingsRow` render-prop and passes `describedBy` to the control, or to `FormControl` in react-hook-form rows. Never `cloneElement`.
- Row actions revealed on hover use exactly `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100` on a row carrying `group`; a row in an edit state shows its controls without hover.
- Buttons: a group's primary action is filled `size="sm"`; secondary, row and chrome actions are `variant="ghost" size="sm"`; icon-only actions are `IconButton` (`frontend/components/patterns/IconButton.tsx`).
- Loading, empty and error states render inside their group: skeleton rows `h-8`; loading and empty lines are one muted line `text-[13px] text-muted-foreground`; an error line keeps its current colour (today `text-destructive`, spec §5 keeps behaviour); any Retry is `variant="ghost" size="sm"`.
- Page gutter: `p-2` owned by the view (`ProjectSettings.tsx`, `pages/UserSettings.tsx`); `SettingsPage` owns the `max-w-3xl` width.

## Shared interfaces (produced by Tasks 1–3, consumed by every later task)

```ts
// frontend/components/ui/input.tsx, textarea.tsx, select.tsx (Task 1)
// New optional prop on Input, Textarea and SelectTrigger:
variant?: 'default' | 'quiet'   // default: 'default'
// quiet adds (Input; Textarea omits h-8 and keeps its min-h; SelectTrigger keeps its chevron):
// 'border-transparent bg-transparent shadow-none px-2 h-8 text-[13px] md:text-[13px]
//  hover:bg-muted/60 disabled:hover:bg-transparent
//  focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background
//  aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2'

// frontend/components/ui/form.tsx (Task 1)
// FormControl joins formDescriptionId, formMessageId (only when error) and an incoming
// aria-describedby into one space-separated attribute. Output is unchanged with no incoming id.

// frontend/hooks/use-mobile.tsx (Task 2)
export function useIsCoarsePointer(): boolean; // '(pointer: coarse)'

// frontend/components/patterns/FieldHint.tsx (Task 2)
export function FieldHint(props: {label: string; hint: string}): JSX.Element;
// IconButton size="icon-xs", Info icon, aria name common.fieldHintAria ("About {{label}}");
// fine pointer: hint is the IconButton tooltip; coarse pointer: tooltip off, tap toggles a Popover.

// frontend/components/settings/SettingsPage.tsx (Task 2)
export function SettingsPage(props: {intro?: ReactNode; children: ReactNode}): JSX.Element;
// <div class="mx-0 w-full max-w-3xl"> [<p class="text-[13px] text-muted-foreground">intro</p>]
//   <div class="@container/settings">children (SettingsGroup only)</div></div>

// frontend/components/settings/SettingsGroup.tsx (Task 2)
export function SettingsGroup(props: {
  title?: string; hint?: string; tone?: 'default' | 'danger'; children: ReactNode;
}): JSX.Element;
// root classes: 'border-t border-border/40 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0'
// title: <h2 class="text-[13px] font-medium"> (+ text-destructive for danger) then FieldHint when hint
// body: <div class="space-y-1">

// frontend/components/settings/SettingsRow.tsx (Task 2)
export interface SettingsRowA11y { describedBy: string | undefined }
export function SettingsRow(props: {
  label: string; htmlFor?: string; hint?: string; required?: boolean; error?: string;
  align?: 'center' | 'start';
  children: ReactNode | ((a11y: SettingsRowA11y) => ReactNode);
}): JSX.Element;
// grid classes: 'grid gap-x-3 gap-y-1 py-1 @[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]'
// ids: base = htmlFor ?? useId(); `${base}-hint`, `${base}-error`; describedBy joins present ids.
// FieldHint is a sibling of <label>, never inside it.

// frontend/components/settings/SettingsActions.tsx (Task 2)
export function SettingsActions(props: {children: ReactNode}): JSX.Element;
// same container-query grid, empty label cell, value cell 'flex flex-wrap gap-2'

// frontend/components/settings/index.ts exports SettingsPage, SettingsGroup, SettingsRow,
// SettingsActions (Task 2), TagInput; SettingsSection stays (PR 2); SettingsCard and
// SettingsField stay exported until Task 14 deletes them.

// frontend/components/settings/TagInput.tsx (Task 3) — new props
id?: string; 'aria-describedby'?: string; addLabel: string; // addLabel names the add IconButton
// callers pass t('common','addToLabel').replace('{{label}}', rowLabel)
```

## Task map

| # | Task | Spec |
|---|---|---|
| 1 | Quiet variants + `FormControl` merge + ui-styling divergences | §4.2 |
| 2a | `useIsCoarsePointer` + `FieldHint` | §4.1 |
| 2b | `SettingsPage` / `SettingsGroup` / `SettingsRow` / `SettingsActions` | §4.1 |
| 3 | `TagInput` restyle | §4.1 |
| 4 | Basic info + Review details + Project settings gutter | §4.3 |
| 5 | Review question | §4.3 |
| 6 | AI engine | §4.3 |
| 7 | Team | §4.3, §10 |
| 8a | Review consensus: visibility hook + `ConsensusConfigForm` rows | §4.3 |
| 8b | Review consensus: intro + project default + visibility row | §4.3 |
| 9 | Review consensus: per-template overrides | §4.3 |
| 10 | Advanced | §4.3, §4.4 |
| 11a | Profile + User settings gutter | §4.3 |
| 11b | Security | §4.3 |
| 12 | Integrations: `IntegrationsSection` + AI connections | §4.3 |
| 13 | Zotero | §4.3 |
| 14 | Retire `SettingsCard`/`SettingsField` + `settings-frame` rule + retired symbols | §6, §10 |
| 15 | Browser verification against §7 | §7 |

---

### Task 1: Quiet variants + `FormControl` merge + ui-styling divergences

**Files:**
- Modify: `frontend/components/ui/input.tsx:1-22` (whole file)
- Modify: `frontend/components/ui/textarea.tsx:1-21` (whole file)
- Modify: `frontend/components/ui/select.tsx:1-30` (imports + `SelectTrigger` only)
- Modify: `frontend/components/ui/form.tsx:98-113` (`FormControl` only)
- Modify: `.claude/skills/ui-styling/SKILL.md:23`, `:99-105`, `:212-215`
- Create: `frontend/components/ui/quiet-controls.test.tsx`
- Create: `frontend/components/ui/form.describedby.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `variant?: 'default' | 'quiet'` on `Input`, `Textarea`, `SelectTrigger` (default `'default'`, output identical to today). `FormControl` accepts `aria-describedby` and renders `[formDescriptionId, formMessageId (error only), incoming].join(' ')`. The cva objects stay module-private (no new exports → knip unaffected).

- [ ] **Step 1: Write the failing quiet-variant test** — `frontend/components/ui/quiet-controls.test.tsx`

```tsx
/**
 * Guard for the `quiet` variant — a deliberate divergence from upstream shadcn
 * (ui-styling skill; spec 2026-09-13-borderless-density-pass-design.md §4.2).
 * jsdom compiles no CSS, so this pins the class contract. The default strings
 * are today's output byte-for-byte: out-of-scope screens must not move.
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Input} from './input';
import {Select, SelectTrigger, SelectValue} from './select';
import {Textarea} from './textarea';

const INPUT_DEFAULT =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm';
const TEXTAREA_DEFAULT =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 resize-y';
const TRIGGER_DEFAULT =
  'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 [&>span]:line-clamp-1';

const QUIET = [
  'border-transparent', 'bg-transparent', 'shadow-none', 'px-2', 'text-[13px]', 'md:text-[13px]',
  'hover:bg-muted/60', 'disabled:hover:bg-transparent',
  'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:bg-background',
  'aria-[invalid=true]:ring-1', 'aria-[invalid=true]:ring-destructive', 'aria-[invalid=true]:focus-visible:ring-2',
];
const GONE = ['border-input', 'bg-background', 'px-3'];
const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);
const renderTrigger = (variant?: 'default' | 'quiet') =>
  render(<Select><SelectTrigger variant={variant} aria-label="Mode"><SelectValue /></SelectTrigger></Select>);

describe('default variant keeps upstream classes', () => {
  it('Input', () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole('textbox').className).toBe(INPUT_DEFAULT);
  });
  it('Input with variant="default"', () => {
    render(<Input variant="default" aria-label="Name" />);
    expect(screen.getByRole('textbox').className).toBe(INPUT_DEFAULT);
  });
  it('Textarea', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox').className).toBe(TEXTAREA_DEFAULT);
  });
  it('SelectTrigger', () => {
    renderTrigger();
    expect(screen.getByRole('combobox').className).toBe(TRIGGER_DEFAULT);
  });
});

describe('quiet variant', () => {
  it('Input: borderless, hover fill, 13px at every width, focus-visible ring and fill, invalid ring', () => {
    render(<Input variant="quiet" aria-label="Name" />);
    const classes = classesOf(screen.getByRole('textbox'));
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'h-8']));
    for (const gone of [...GONE, 'h-10', 'text-base', 'md:text-sm']) expect(classes).not.toContain(gone);
  });

  it('Textarea: same contract, keeps its min-h and takes no fixed height', () => {
    render(<Textarea variant="quiet" aria-label="Notes" />);
    const classes = classesOf(screen.getByRole('textbox'));
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'min-h-[80px]']));
    for (const gone of [...GONE, 'h-8', 'text-sm']) expect(classes).not.toContain(gone);
  });

  it('SelectTrigger: rings on focus-visible only, never focus:, and keeps its chevron', () => {
    renderTrigger('quiet');
    const trigger = screen.getByRole('combobox');
    const classes = classesOf(trigger);
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'h-8']));
    for (const gone of [...GONE, 'h-10', 'text-sm']) expect(classes).not.toContain(gone);
    expect(classes.filter((c) => c.startsWith('focus:'))).toEqual([]);
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('a caller width class still merges', () => {
    render(<Input variant="quiet" className="w-40" aria-label="Name" />);
    expect(screen.getByRole('textbox')).toHaveClass('w-40');
    expect(screen.getByRole('textbox')).not.toHaveClass('w-full');
  });
});
```

- [ ] **Step 2: Write the failing `FormControl` test** — `frontend/components/ui/form.describedby.test.tsx`

```tsx
/**
 * Guard for FormControl's aria-describedby merge — a deliberate divergence
 * from upstream shadcn (ui-styling skill; spec 2026-09-13 §4.2). Upstream
 * spreads props after its own attribute and Radix Slot lets them win, so a
 * SettingsRow hint id used to overwrite the description and message ids.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';

import {Input} from '@/components/ui/input';

import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from './form';

const MESSAGE = 'Name must be at least 3 characters';
const schema = z.object({name: z.string().min(3, MESSAGE)});
type Values = z.infer<typeof schema>;

function TestForm({incoming}: {incoming?: string}) {
  const form = useForm<Values>({resolver: zodResolver(schema), defaultValues: {name: ''}});
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          render={({field}) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl aria-describedby={incoming}>
                <Input {...field} />
              </FormControl>
              <FormDescription>Shown to reviewers</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <span id="row-hint">A row hint</span>
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

const control = () => screen.getByLabelText('Name');
const descriptionId = () => screen.getByText('Shown to reviewers').id;
const submit = () => userEvent.click(screen.getByRole('button', {name: 'Submit'}));

describe('FormControl aria-describedby', () => {
  it('is unchanged with no incoming id, valid and errored', async () => {
    render(<TestForm />);
    expect(control()).toHaveAttribute('aria-describedby', descriptionId());
    await submit();
    const message = await screen.findByText(MESSAGE);
    await vi.waitFor(() => expect(control()).toHaveAttribute('aria-describedby', `${descriptionId()} ${message.id}`));
  });

  it('keeps the description id and appends an incoming id while valid', () => {
    render(<TestForm incoming="row-hint" />);
    expect(control().getAttribute('aria-describedby')?.split(' ')).toEqual([descriptionId(), 'row-hint']);
  });

  it('holds description, message and incoming ids after a failed submit', async () => {
    render(<TestForm incoming="row-hint" />);
    await submit();
    const message = await screen.findByText(MESSAGE);
    await vi.waitFor(() =>
      expect(control().getAttribute('aria-describedby')?.split(' ')).toEqual([descriptionId(), message.id, 'row-hint']),
    );
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm run test:run -- frontend/components/ui/quiet-controls.test.tsx frontend/components/ui/form.describedby.test.tsx`
Expected: the four "default variant" cases and "is unchanged with no incoming id" PASS (they pin today); every "quiet variant" case FAILS (missing `border-transparent`); both incoming-id cases FAIL (attribute is `row-hint` alone).

- [ ] **Step 4: Implement `Input`** — replace `frontend/components/ui/input.tsx`

```tsx
import * as React from "react";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";

// `quiet` is a deliberate divergence from upstream shadcn (ui-styling skill):
// the borderless settings control. `md:text-[13px]` is load-bearing — the
// base's `md:text-sm` would otherwise render it at 14px from 768px up.
// Guard: quiet-controls.test.tsx.
const inputVariants = cva(
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default: "",
        quiet:
          "h-8 border-transparent bg-transparent px-2 text-[13px] shadow-none md:text-[13px] hover:bg-muted/60 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

type InputProps = React.ComponentProps<"input"> & VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, variant, ...props }, ref) => {
  return <input type={type} className={cn(inputVariants({ variant }), className)} ref={ref} {...props} />;
});
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 5: Implement `Textarea`** — replace `frontend/components/ui/textarea.tsx`

```tsx
import * as React from "react";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";

// `quiet`: deliberate divergence from upstream shadcn (ui-styling skill). It
// keeps the base min-h and takes no fixed height. Guard: quiet-controls.test.tsx.
const textareaVariants = cva(
  "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 resize-y",
  {
    variants: {
      variant: {
        default: "",
        quiet:
          "border-transparent bg-transparent px-2 text-[13px] shadow-none md:text-[13px] hover:bg-muted/60 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textareaVariants>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, variant, ...props }, ref) => {
  return <textarea className={cn(textareaVariants({ variant }), className)} ref={ref} {...props} />;
});
Textarea.displayName = "Textarea";

export { Textarea };
```

- [ ] **Step 6: Implement `SelectTrigger`** — in `frontend/components/ui/select.tsx` add `import {cva, type VariantProps} from "class-variance-authority";` after the lucide import, and replace lines 12-30 with:

```tsx
// Two full strings, not base + override: quiet must drop the default's
// `focus:` ring and fill, and tailwind-merge cannot remove a `focus:` class
// with a `focus-visible:` one. Radix returns focus to the trigger after every
// mouse pick, so a `focus:` ring would look stuck. Deliberate divergence from
// upstream shadcn (ui-styling skill). Guard: quiet-controls.test.tsx.
const selectTriggerVariants = cva("", {
  variants: {
    variant: {
      default:
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 [&>span]:line-clamp-1",
      quiet:
        "flex h-8 w-full items-center justify-between rounded-md border border-transparent bg-transparent px-2 py-2 text-[13px] shadow-none ring-offset-background placeholder:text-muted-foreground md:text-[13px] hover:bg-muted/60 disabled:hover:bg-transparent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:bg-background aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2 disabled:opacity-50 [&>span]:line-clamp-1",
    },
  },
  defaultVariants: {variant: "default"},
});

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & VariantProps<typeof selectTriggerVariants>
>(({ className, children, variant, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn(selectTriggerVariants({ variant }), className)} {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;
```

- [ ] **Step 7: Implement the `FormControl` merge** — replace `frontend/components/ui/form.tsx:98-113` with:

```tsx
// Deliberate divergence from upstream shadcn (ui-styling skill): upstream
// spreads props after its own aria-describedby, and Slot lets them win, so a
// row's hint id overwrote the description and message ids. Joined here; with
// no incoming id the output is upstream's. Guard: form.describedby.test.tsx.
const FormControl = React.forwardRef<React.ElementRef<typeof Slot>, React.ComponentPropsWithoutRef<typeof Slot>>(
  ({ "aria-describedby": incomingDescribedBy, ...props }, ref) => {
    const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
    const describedBy = [formDescriptionId, error ? formMessageId : undefined, incomingDescribedBy]
      .filter(Boolean)
      .join(" ");

    return <Slot ref={ref} id={formItemId} aria-describedby={describedBy} aria-invalid={!!error} {...props} />;
  },
);
FormControl.displayName = "FormControl";
```

- [ ] **Step 8: Run the new tests and the shared-caller guards**

Run: `npm run test:run -- frontend/components/ui/quiet-controls.test.tsx frontend/components/ui/form.describedby.test.tsx frontend/components/ui/form.validation.test.tsx frontend/test/AddProjectDialog.validation.test.tsx frontend/test/CreateCustomTemplateDialog.validation.test.tsx frontend/components/extraction/dialogs/AddSectionDialog.test.tsx frontend/components/runs/SectionNavLayout.test.tsx`
Expected: all PASS, with no edit to the last five files.

- [ ] **Step 9: Record the divergences in `.claude/skills/ui-styling/SKILL.md`**

Line 23 — replace the row
`| Tailwind         | **v3.4.17**, classic `tailwind.config.ts` + `@tailwind base/...`       |`
with
`| Tailwind         | **v4.3.3**, CSS-first: `@import "tailwindcss"` + `@theme inline` in `frontend/index.css` |`

Lines 99-105 — replace from `` `shadcn add` diffs stay clean. **The one deliberate divergence** is `` through `` `shadcn add button`; `button.test.tsx` fails if you forget. `` with:

```markdown
   `shadcn add` diffs stay clean. **Three deliberate divergences**, each
   pinned by a guard test that fails if a `shadcn add` overwrites it:
   - `ui/button.tsx`'s `size` scale: upstream's heights do not fit this
     codebase's density (see `frontend-ux` § Buttons), so `sm`/`icon` are
     retuned and `xs`/`icon-xs` added. Guard: `button.test.tsx`.
   - The `quiet` cva variant on `ui/input.tsx`, `ui/textarea.tsx` and
     `ui/select.tsx`'s `SelectTrigger`, the borderless settings control
     (spec `2026-09-13-borderless-density-pass-design.md` §4.2). It carries
     `md:text-[13px]` (the Input base's `md:text-sm` would win from 768px),
     rings on `focus-visible:` only (Radix returns focus to the trigger after
     a mouse pick) and `aria-[invalid=true]:focus-visible:ring-2` (`aria-*`
     utilities compile after `focus-visible`). `default` keeps upstream's
     classes. Guard: `quiet-controls.test.tsx`.
   - `ui/form.tsx`'s `FormControl` joins its description id, its message id
     (on error) and an incoming `aria-describedby`; upstream spreads props
     last, so Radix `Slot` let a passed id overwrite both. Guard:
     `form.describedby.test.tsx`.
```

Lines 212-215 — replace the paragraph starting `Forward-looking note: **Tailwind v4** moves theme` with:

```markdown
Tailwind is **v4.3.3**, CSS-first: `frontend/index.css` imports `tailwindcss`
and declares the theme in `@theme inline`; there is no `tailwind.config.ts`.
Version-specific notes sit in `references/tailwind-v4.md`.
```

Verify: `grep -n "3.4.17" .claude/skills/ui-styling/SKILL.md` → no output.

- [ ] **Step 10: Gates**

Run, in order, reading each tail: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green; knip prints nothing in both modes. No button-scale baseline entry changes (no `<Button>` touched).

- [ ] **Step 11: Commit**

```bash
git add frontend/components/ui/input.tsx frontend/components/ui/textarea.tsx frontend/components/ui/select.tsx frontend/components/ui/form.tsx frontend/components/ui/quiet-controls.test.tsx frontend/components/ui/form.describedby.test.tsx .claude/skills/ui-styling/SKILL.md
```
```bash
git commit -m "feat(ui): quiet variant on Input/Textarea/SelectTrigger; FormControl merges aria-describedby

Both recorded as deliberate shadcn divergences in the ui-styling skill, with
guard tests; the skill's stale Tailwind v3.4.17 lines now say v4.3.3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2a: `useIsCoarsePointer` + `FieldHint`

**Files:**
- Modify: `frontend/hooks/use-mobile.tsx:39` (append after the last function)
- Modify: `frontend/lib/copy/common.ts:86` (add a key after `remove: 'Remove',`)
- Create: `frontend/components/patterns/FieldHint.tsx`, `frontend/components/patterns/FieldHint.test.tsx`
- Modify: `knip.jsonc` (temporary `ignoreIssues` block before `"ignoreDependencies"`; Task 2b deletes it)

**Interfaces:**
- Consumes: `IconButton` (`frontend/components/patterns/IconButton.tsx`), `Popover`/`PopoverTrigger`/`PopoverContent` (`frontend/components/ui/popover.tsx`), and the module-private `useMediaQuery` in `frontend/hooks/use-mobile.tsx`. Nothing from Task 1.
- Produces (exact, per the header): `useIsCoarsePointer(): boolean` (`'(pointer: coarse)'`); `FieldHint({label, hint})`, an `IconButton size="icon-xs"` with an `Info` icon, named by `common.fieldHintAria` with `{{label}}` replaced ("About Project name"); on a fine pointer the hint is the IconButton `tooltip`, on a coarse pointer a tap toggles a `Popover`. Copy key `common.fieldHintAria: 'About {{label}}'`. Task 2b's `SettingsRow` and `SettingsGroup` are its first production callers.

**Knip, measured.** On a scratch copy of the branch head with exactly this task's changes, `npx knip --production --no-tag-hints` reports `Unused files (1)` `frontend/components/patterns/FieldHint.tsx` and `Unused exports (1)` `useIsCoarsePointer` in `frontend/hooks/use-mobile.tsx`; default mode is clean, because the test imports `FieldHint`. With the Step 7 block, both modes print nothing (verified on the same copy). The block uses `ignoreIssues` with `["files"]` rather than `ignoreFiles`: with `ignoreFiles`, default mode prints a "Remove from ignoreFiles" configuration hint. Task 2b deletes this block once `SettingsRow` imports `FieldHint`.

- [ ] **Step 1: Write the failing `FieldHint` test** — `frontend/components/patterns/FieldHint.test.tsx`

```tsx
import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

import {FieldHint} from './FieldHint';

const HINT = 'Shown to every reviewer on the project.';
const renderNow = (ui: ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
const trigger = () => screen.getByRole('button', {name: 'About Project name'});

describe('FieldHint', () => {
  it('is an icon-xs IconButton named after the field it explains', () => {
    renderNow(<FieldHint label="Project name" hint={HINT} />);
    expect(trigger()).toHaveClass('h-6', 'w-6');
    expect(trigger().querySelector('svg')).not.toBeNull();
  });

  it('shows the hint as its tooltip on a fine pointer', async () => {
    renderNow(<FieldHint label="Project name" hint={HINT} />);
    await userEvent.hover(trigger());
    expect(screen.getByRole('tooltip')).toHaveTextContent(HINT);
  });

  describe('on a coarse pointer', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('opens a popover with the hint on tap, with no tooltip', async () => {
      renderNow(<FieldHint label="Project name" hint={HINT} />);
      expect(screen.queryByText(HINT)).toBeNull();
      await userEvent.click(trigger());
      expect(screen.getByRole('dialog')).toHaveTextContent(HINT);
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/components/patterns/FieldHint.test.tsx`
Expected: FAIL — `Failed to resolve import "./FieldHint"`.

- [ ] **Step 3: Add `useIsCoarsePointer`** — append to `frontend/hooks/use-mobile.tsx`:

```tsx

/** True on a coarse primary pointer (touch). Radix tooltips do not open on
 *  tap, so FieldHint swaps its tooltip for a popover there. */
export function useIsCoarsePointer() {
  return useMediaQuery("(pointer: coarse)");
}
```

- [ ] **Step 4: Add the copy key** — in `frontend/lib/copy/common.ts`, after `    remove: 'Remove',` (line 86):

```ts
    /** FieldHint's accessible name; `{{label}}` is replaced by the caller. */
    fieldHintAria: 'About {{label}}',
```

- [ ] **Step 5: Create `frontend/components/patterns/FieldHint.tsx`**

```tsx
import {Info} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useIsCoarsePointer} from '@/hooks/use-mobile';
import {t} from '@/lib/copy';

interface FieldHintProps {
  /** The field or group the hint explains; names the trigger "About {label}". */
  label: string;
  hint: string;
}

/**
 * The ⓘ beside a settings label (spec 2026-09-13-borderless-density-pass §4.1).
 * Fine pointer: the hint is the IconButton's tooltip (its `tooltip`, not its
 * `hint` second line). Coarse pointer: Radix tooltips do not open on tap, so a
 * tap toggles a popover with the same text. SettingsRow also wires the text to
 * the control through aria-describedby; this trigger is the visual path.
 */
export function FieldHint({label, hint}: FieldHintProps) {
  const coarse = useIsCoarsePointer();
  const name = t('common', 'fieldHintAria').replace('{{label}}', label);
  const icon = <Info strokeWidth={1.5} />;

  if (!coarse) return <IconButton label={name} tooltip={hint} size="icon-xs" icon={icon} />;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={name} tooltip={false} size="icon-xs" icon={icon} />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-2 text-[13px]">
        {hint}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:run -- frontend/components/patterns/FieldHint.test.tsx`
Expected: PASS.

- [ ] **Step 7: Knip — see the production findings, then scope the temporary entry**

Run: `npx knip --production --no-tag-hints`
Expected: exactly two findings — `Unused files (1)` `frontend/components/patterns/FieldHint.tsx` and `Unused exports (1)` `useIsCoarsePointer` in `frontend/hooks/use-mobile.tsx`. Anything else is a real finding: fix it, do not add it below.

In `knip.jsonc`, insert before `  // Invoked via npx inside scripts/generate_api_types.sh`:

```jsonc
  // TEMPORARY (borderless density pass PR 1, plan
  // docs/superpowers/plans/2026-09-13-borderless-density-pass-settings.md).
  // Task 2a lands FieldHint and useIsCoarsePointer before their first
  // production callers (SettingsRow and SettingsGroup, Task 2b), so
  // --production reports FieldHint.tsx as an unused file and useIsCoarsePointer
  // as an unused export. Task 2b deletes this block. ignoreIssues, not
  // ignoreFiles: ignoreFiles prints a configuration hint in default mode.
  "ignoreIssues": {
    "frontend/components/patterns/FieldHint.tsx": ["files"],
    "frontend/hooks/use-mobile.tsx": ["exports"]
  },
```

Run: `npx knip --production --no-tag-hints` then `npx knip --no-tag-hints`
Expected: no output from either.

- [ ] **Step 8: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green. `check_copy_keys` sees `fieldHintAria` referenced in `FieldHint.tsx`; `check_ui_primitives` finds no `<Button size="icon*">` and no `<TooltipProvider>` outside tests. No `<Button>` is touched, so the button-scale baseline is not edited.

- [ ] **Step 9: Commit**

```bash
git add frontend/hooks/use-mobile.tsx frontend/lib/copy/common.ts frontend/components/patterns/FieldHint.tsx frontend/components/patterns/FieldHint.test.tsx knip.jsonc
```
```bash
git commit -m "feat(patterns): FieldHint and useIsCoarsePointer

FieldHint explains a settings label: the IconButton tooltip on a fine
pointer, a tap-toggled popover on a coarse one. knip.jsonc carries a
scoped, temporary ignoreIssues entry until Task 2b gives it production
callers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2b: `SettingsPage`, `SettingsGroup`, `SettingsRow`, `SettingsActions`

**Files:**
- Create: `frontend/components/settings/SettingsRow.tsx`, `SettingsGroup.tsx`, `SettingsPage.tsx`, `SettingsActions.tsx`
- Create: `frontend/components/settings/SettingsRow.test.tsx`, `frontend/components/settings/SettingsLayout.test.tsx`
- Modify: `frontend/components/settings/index.ts` (whole file)
- Modify: `knip.jsonc` (replace Task 2a's temporary block with this task's)

**Interfaces:**
- Consumes (Task 2a): `FieldHint({label, hint})` from `@/components/patterns/FieldHint`, whose trigger is named "About {label}" (`common.fieldHintAria`). Nothing from Task 1 directly (callers pair these with `variant="quiet"` controls from Task 4 on).
- Produces (exact, per the header): `SettingsPage({intro?, children})`; `SettingsGroup({title?, hint?, tone?, children})`; `SettingsRow({label, htmlFor?, hint?, required?, error?, align?, children})` with `SettingsRowA11y {describedBy: string | undefined}`; `SettingsActions({children})`; all four exported from `@/components/settings`. Ids: `${htmlFor ?? useId()}-hint` / `-error`, joined hint-then-error. Also `SETTINGS_ROW_GRID` (string constant, exported from `SettingsRow.tsx` only for `SettingsActions`; not re-exported from `index.ts`).
- Markup later tests rely on: the `SettingsGroup` root element carries `border-t border-border/40 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0` (tests find a group with `.closest('.border-t')`), and its `<h2>` sits in a title row (`root > div > h2`). `SettingsRow`'s `<label>` is alone in its label cell with the required `*` and the `FieldHint` as `aria-hidden`/sibling elements after it, so a control's accessible name is the label alone. The hint text is an `sr-only` span with the `-hint` id, and the error is a `<p class="mt-1 text-xs text-destructive">` with the `-error` id.

**Knip, measured:** on a copy of the tree with these four components exported from `index.ts` and no production caller, `npx knip --production --no-tag-hints` reports 8 unused exports (each component in its own file plus its `index.ts` re-export). `FieldHint.tsx` and `useIsCoarsePointer` are not reported, because `SettingsRow` and `SettingsGroup` import `FieldHint`. Default mode is clean once the tests import them. The first production callers arrive in Tasks 4-13, so Step 5 swaps Task 2a's block for a scoped, reasoned `ignoreIssues` entry; with it both modes print nothing (verified on the same copy).

**Removing the block.** The block goes at the first later task whose change leaves both knip modes silent without it. At that task's knip gate, delete the block and run `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`. If both print nothing, keep the deletion and add `knip.jsonc` to that task's commit; otherwise restore the block unchanged. One ordering fact bounds this. The block also silences `index.ts`'s `SettingsCard`/`SettingsField` re-exports, whose last callers (`SecuritySection`) go in Task 11b while the re-exports stay until Task 14. A task before 11b that deletes the block therefore turns 11b red, so tasks before 11b keep it even when both modes are silent. **Task 14 deletes it if it is still present** and proves both modes stay at zero.

- [ ] **Step 1: Write the failing settings tests**

`frontend/components/settings/SettingsRow.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {SettingsRow} from '@/components/settings';

describe('SettingsRow', () => {
  it('associates its label with the control through htmlFor', () => {
    render(<SettingsRow label="Project name" htmlFor="project_name"><input id="project_name" /></SettingsRow>);
    expect(screen.getByRole('textbox', {name: 'Project name'})).toHaveAttribute('id', 'project_name');
  });

  it('keeps the hint trigger beside the label, so the control is named by the label alone', () => {
    render(
      <SettingsRow label="Project name" htmlFor="project_name" hint="Shown to reviewers">
        {({describedBy}) => <input id="project_name" aria-describedby={describedBy} />}
      </SettingsRow>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAccessibleName('Project name');
    expect(screen.getByRole('button', {name: 'About Project name'}).closest('label')).toBeNull();
    expect(input).toHaveAttribute('aria-describedby', 'project_name-hint');
    expect(input).toHaveAccessibleDescription('Shown to reviewers');
  });

  it('appends the error id after the hint id and renders the message', () => {
    render(
      <SettingsRow label="Arbitrator" htmlFor="arbitrator" hint="Breaks ties" error="Choose an arbitrator">
        {({describedBy}) => <input id="arbitrator" aria-describedby={describedBy} />}
      </SettingsRow>,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', 'arbitrator-hint arbitrator-error');
    const message = screen.getByText('Choose an arbitrator');
    expect(message).toHaveAttribute('id', 'arbitrator-error');
    expect(message).toHaveClass('text-xs', 'text-destructive');
  });

  it('hands the render-prop no describedBy when there is neither hint nor error', () => {
    render(<SettingsRow label="Label" htmlFor="l">{({describedBy}) => <input id="l" aria-describedby={describedBy} />}</SettingsRow>);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('marks required with an asterisk that stays out of the accessible name', () => {
    render(<SettingsRow label="Project name" htmlFor="n" required><input id="n" /></SettingsRow>);
    expect(screen.getByRole('textbox', {name: 'Project name'})).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveClass('text-destructive');
  });

  it('generates ids for a row with no control (no htmlFor)', () => {
    render(<SettingsRow label="Email" hint="Used to sign in"><span>me@example.com</span></SettingsRow>);
    expect(screen.getByText('Email').tagName).toBe('LABEL');
    expect(screen.getByText('Email')).not.toHaveAttribute('for');
    expect(document.querySelector('[id$="-hint"]')).toHaveTextContent('Used to sign in');
  });

  it('lays out on the settings container query, not a viewport breakpoint', () => {
    const {container} = render(<SettingsRow label="A" htmlFor="a"><input id="a" /></SettingsRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass('grid', 'gap-x-3', 'gap-y-1', 'py-1', '@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]', '@[36rem]/settings:items-center');
    expect(row.className).not.toMatch(/(^|\s)(sm|md|lg):/);
  });

  it('top-aligns with align="start"', () => {
    const {container} = render(<SettingsRow label="A" htmlFor="a" align="start"><textarea id="a" /></SettingsRow>);
    expect(container.firstElementChild).toHaveClass('@[36rem]/settings:items-start');
  });
});
```

`frontend/components/settings/SettingsLayout.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Button} from '@/components/ui/button';
import {SettingsActions, SettingsGroup, SettingsPage} from '@/components/settings';

describe('SettingsPage', () => {
  it('owns the readable column, the intro line and the settings container', () => {
    const {container} = render(
      <SettingsPage intro="Applies to every run."><SettingsGroup title="General">body</SettingsGroup></SettingsPage>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('mx-0', 'w-full', 'max-w-3xl');
    const intro = screen.getByText('Applies to every run.');
    expect(intro.tagName).toBe('P');
    expect(intro).toHaveClass('text-[13px]', 'text-muted-foreground');
    const body = root.lastElementChild as HTMLElement;
    expect(body).toHaveClass('@container/settings');
    expect(body).toContainElement(screen.getByRole('heading', {level: 2, name: 'General'}));
  });

  it('renders no intro paragraph without an intro', () => {
    const {container} = render(<SettingsPage><SettingsGroup>body</SettingsGroup></SettingsPage>);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('SettingsGroup', () => {
  it('titles itself with an h2 and a hint trigger', () => {
    render(<SettingsGroup title="Shared keys" hint="Used by every member">body</SettingsGroup>);
    const heading = screen.getByRole('heading', {level: 2, name: 'Shared keys'});
    expect(heading).toHaveClass('text-[13px]', 'font-medium');
    expect(heading).not.toHaveClass('text-destructive');
    expect(screen.getByRole('button', {name: 'About Shared keys'})).toBeInTheDocument();
  });

  it('draws one hairline that the first group resets', () => {
    const {container} = render(<SettingsGroup>body</SettingsGroup>);
    expect(container.firstElementChild).toHaveClass(
      'border-t', 'border-border/40', 'pt-4', 'mt-4', 'first:border-t-0', 'first:pt-0', 'first:mt-0',
    );
  });

  it('colours a danger title', () => {
    render(<SettingsGroup title="Danger zone" tone="danger">body</SettingsGroup>);
    expect(screen.getByRole('heading', {level: 2})).toHaveClass('text-destructive');
  });

  it('stacks its body with space-y-1 and renders no heading when untitled', () => {
    render(<SettingsGroup><span>row</span></SettingsGroup>);
    expect(screen.getByText('row').parentElement).toHaveClass('space-y-1');
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('SettingsActions', () => {
  it('sits under the value column: same grid, empty label cell, wrapping buttons', () => {
    const {container} = render(
      <SettingsActions><Button>Save</Button><Button variant="ghost">Cancel</Button></SettingsActions>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('grid', 'gap-x-3', '@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
    const [labelCell, valueCell] = Array.from(root.children) as HTMLElement[];
    expect(labelCell).toBeEmptyDOMElement();
    expect(valueCell).toHaveClass('flex', 'flex-wrap', 'gap-2');
    expect(valueCell).toContainElement(screen.getByRole('button', {name: 'Save'}));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- frontend/components/settings/SettingsRow.test.tsx frontend/components/settings/SettingsLayout.test.tsx`
Expected: FAIL — `SettingsRow`/`SettingsPage`/`SettingsGroup`/`SettingsActions` are not exported from `@/components/settings` (element type is undefined).

- [ ] **Step 3: Create the settings components**

`frontend/components/settings/SettingsRow.tsx`:

```tsx
import {useId, type ReactNode} from 'react';

import {FieldHint} from '@/components/patterns/FieldHint';
import {cn} from '@/lib/utils';

/** A container query on SettingsPage's body, not a viewport breakpoint: the
 *  body sits beside a 224px rail. Shared with SettingsActions. */
export const SETTINGS_ROW_GRID = 'grid gap-x-3 gap-y-1 py-1 @[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]';

export interface SettingsRowA11y {
  describedBy: string | undefined;
}

interface SettingsRowProps {
  label: string;
  /** The control's id. Omit for a row with no control (read-only text). */
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  /** Plain validation text. react-hook-form rows put FormMessage in the value cell instead. */
  error?: string;
  /** `start` for textareas, tag lists and multi-line value cells. */
  align?: 'center' | 'start';
  /** A hinted or errored row uses the render-prop and puts `describedBy` on
   *  the control (or on FormControl). Never cloneElement: the child is often
   *  not the control. */
  children: ReactNode | ((a11y: SettingsRowA11y) => ReactNode);
}

export function SettingsRow({label, htmlFor, hint, required, error, align = 'center', children}: SettingsRowProps) {
  const generatedId = useId();
  const baseId = htmlFor ?? generatedId;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={cn(
        SETTINGS_ROW_GRID,
        align === 'center' ? '@[36rem]/settings:items-center' : '@[36rem]/settings:items-start',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-1 @[36rem]/settings:justify-end',
          align === 'start' && '@[36rem]/settings:pt-1',
        )}
      >
        <label htmlFor={htmlFor} className="text-[13px] text-muted-foreground @[36rem]/settings:text-right">
          {label}
        </label>
        {/* Siblings of the label, never inside it: they must not join the control's name. */}
        {required ? <span aria-hidden="true" className="text-[13px] text-destructive">*</span> : null}
        {hint ? <FieldHint label={label} hint={hint} /> : null}
      </div>
      <div className="min-w-0">
        {typeof children === 'function' ? children({describedBy}) : children}
        {hint ? <span id={hintId} className="sr-only">{hint}</span> : null}
        {error ? <p id={errorId} className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
```

`frontend/components/settings/SettingsGroup.tsx`:

```tsx
import type {ReactNode} from 'react';

import {FieldHint} from '@/components/patterns/FieldHint';
import {cn} from '@/lib/utils';

interface SettingsGroupProps {
  title?: string;
  hint?: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/** One group of rows. SettingsPage's body holds only groups, so the `first:`
 *  resets leave exactly one hairline per boundary (frontend-ux §6). */
export function SettingsGroup({title, hint, tone = 'default', children}: SettingsGroupProps) {
  return (
    <div className="border-t border-border/40 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0">
      {title ? (
        <div className="mb-1 flex items-center gap-1">
          <h2 className={cn('text-[13px] font-medium', tone === 'danger' && 'text-destructive')}>{title}</h2>
          {hint ? <FieldHint label={title} hint={hint} /> : null}
        </div>
      ) : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}
```

`frontend/components/settings/SettingsPage.tsx`:

```tsx
import type {ReactNode} from 'react';

interface SettingsPageProps {
  intro?: ReactNode;
  /** SettingsGroup elements only; loading, empty and error states render inside a group. */
  children: ReactNode;
}

/** The one wrapper per settings section body. The view owns the `p-2` gutter; this owns the width. */
export function SettingsPage({intro, children}: SettingsPageProps) {
  return (
    <div className="mx-0 w-full max-w-3xl">
      {intro ? <p className="mb-4 text-[13px] text-muted-foreground">{intro}</p> : null}
      <div className="@container/settings">{children}</div>
    </div>
  );
}
```

`frontend/components/settings/SettingsActions.tsx`:

```tsx
import type {ReactNode} from 'react';

import {SETTINGS_ROW_GRID} from './SettingsRow';

/** A group's buttons, under the value column: primary `sm`, secondary `ghost sm`. */
export function SettingsActions({children}: {children: ReactNode}) {
  return (
    <div className={SETTINGS_ROW_GRID}>
      <div aria-hidden="true" className="hidden @[36rem]/settings:block" />
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
```

Replace `frontend/components/settings/index.ts` (also drops its stray `;` line):

```ts
export {SettingsSection} from './SettingsSection';
export {SettingsField} from './SettingsField';
export {TagInput} from './TagInput';
export {SettingsCard} from './SettingsCard';
export {SettingsPage} from './SettingsPage';
export {SettingsGroup} from './SettingsGroup';
export {SettingsRow} from './SettingsRow';
export {SettingsActions} from './SettingsActions';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- frontend/components/settings/SettingsRow.test.tsx frontend/components/settings/SettingsLayout.test.tsx frontend/components/patterns/FieldHint.test.tsx`
Expected: PASS.

- [ ] **Step 5: Knip — swap Task 2a's temporary entry for this task's**

In `knip.jsonc`, delete Task 2a's block: the `// TEMPORARY (borderless density pass PR 1` comment that names FieldHint and useIsCoarsePointer, through its `"ignoreIssues": {…},` object.

Run: `npx knip --production --no-tag-hints`
Expected: 8 unused exports — `SettingsPage`, `SettingsGroup`, `SettingsRow`, `SettingsActions` in `frontend/components/settings/index.ts` and in their own files. Anything else is a real finding: fix it, do not add it below. In particular, `FieldHint.tsx` or `useIsCoarsePointer` reported again means `SettingsRow`/`SettingsGroup` do not import `FieldHint`.

In `knip.jsonc`, insert before `  // Invoked via npx inside scripts/generate_api_types.sh`:

```jsonc
  // TEMPORARY (borderless density pass PR 1, plan
  // docs/superpowers/plans/2026-09-13-borderless-density-pass-settings.md).
  // Task 2b lands SettingsPage/SettingsGroup/SettingsRow/SettingsActions before
  // their first production callers (Tasks 4-13 migrate the sections), so
  // --production reports each export in its file and its index.ts re-export.
  // It also keeps the SettingsCard/SettingsField re-exports quiet once Task 11b
  // removes their last callers. Remove it at the first task that leaves both
  // knip modes silent without it (never before 11b); Task 14 asserts it is
  // gone. Never widen it to another path or issue type.
  "ignoreIssues": {
    "frontend/components/settings/{index.ts,SettingsPage.tsx,SettingsGroup.tsx,SettingsRow.tsx,SettingsActions.tsx}": ["exports"]
  },
```

Run: `npx knip --production --no-tag-hints` then `npx knip --no-tag-hints`
Expected: no output from either.

- [ ] **Step 6: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green. No copy key changes in this task; `check_ui_primitives` finds no `<Button size="icon*">` and no `<TooltipProvider>` outside tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/settings/SettingsRow.tsx frontend/components/settings/SettingsGroup.tsx frontend/components/settings/SettingsPage.tsx frontend/components/settings/SettingsActions.tsx frontend/components/settings/SettingsRow.test.tsx frontend/components/settings/SettingsLayout.test.tsx frontend/components/settings/index.ts knip.jsonc
```
```bash
git commit -m "feat(settings): SettingsPage, SettingsGroup, SettingsRow and SettingsActions

A flat label/value grid on a container query, with hint and error ids handed
to the control through a render-prop. knip.jsonc swaps Task 2a's entry for a
scoped, temporary ignoreIssues entry until the sections adopt the primitives
(removed by Task 14 at the latest).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `TagInput` restyle

**Files:**
- Modify: `frontend/components/settings/TagInput.tsx:1-139` (whole file)
- Modify: `frontend/lib/copy/common.ts` (add a key after Task 2a's `fieldHintAria`)
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx` (4 `TagInput` call sites, lines ~129, ~148, ~174, ~222)
- Modify: `frontend/components/project/settings/PICOTSItemEditor.tsx` (2 `TagInput` call sites, lines ~88, ~105)
- Create: `frontend/components/settings/TagInput.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Input variant="quiet"`; `IconButton` (`frontend/components/patterns/IconButton.tsx`).
- Produces: `TagInputProps` gains `id?: string`, `'aria-describedby'?: string`, `addLabel: string` (required). `inputClassName` is removed: no caller passes it, and it existed to override the input size, which the quiet variant forbids. Callers pass `addLabel={t('common', 'addToLabel').replace('{{label}}', <row label>)}`. Copy key `common.addToLabel`. Tasks 5 and 10 move these call sites into `SettingsRow`s and pass `id`/`aria-describedby` there.

- [ ] **Step 1: Write the failing test** — `frontend/components/settings/TagInput.test.tsx`

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {TagInput} from '@/components/settings';

const noop = () => {};
const BORDER = /(^|\s)border(\s|-|$)/;

describe('TagInput', () => {
  it('lets a settings row label and describe its draft input', () => {
    render(
      <>
        <label htmlFor="review_keywords">Review keywords</label>
        <span id="review_keywords-hint">Terms that describe the review</span>
        <TagInput id="review_keywords" aria-describedby="review_keywords-hint" addLabel="Add to Review keywords" items={[]} onAdd={noop} onRemove={noop} />
      </>,
    );
    const input = screen.getByRole('textbox', {name: 'Review keywords'});
    expect(input).toHaveAttribute('aria-describedby', 'review_keywords-hint');
    expect(input).toHaveAccessibleDescription('Terms that describe the review');
  });

  it('draws the draft input quiet, with no size override', () => {
    render(<TagInput addLabel="Add" items={[]} onAdd={noop} onRemove={noop} />);
    expect(screen.getByRole('textbox')).toHaveClass('border-transparent', 'h-8', 'md:text-[13px]');
    expect(screen.getByRole('textbox')).not.toHaveClass('h-7');
  });

  it.each(['badge', 'list'] as const)('names the %s add control by addLabel and adds the trimmed draft', async (variant) => {
    const onAdd = vi.fn();
    render(<TagInput variant={variant} addLabel="Add to Inclusion criteria" items={[]} onAdd={onAdd} onRemove={noop} />);
    await userEvent.type(screen.getByRole('textbox'), '  adults  ');
    await userEvent.click(screen.getByRole('button', {name: 'Add to Inclusion criteria'}));
    expect(onAdd).toHaveBeenCalledWith('adults');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('still adds on Enter and removes by index', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<TagInput addLabel="Add" items={['a', 'b']} onAdd={onAdd} onRemove={onRemove} />);
    await userEvent.type(screen.getByRole('textbox'), 'c{Enter}');
    expect(onAdd).toHaveBeenCalledWith('c');
    await userEvent.click(screen.getAllByRole('button', {name: 'Remove'})[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('draws badge chips with no border', () => {
    render(<TagInput variant="badge" addLabel="Add" items={['cardiology']} onAdd={noop} onRemove={noop} />);
    const chip = screen.getByText('cardiology');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).not.toMatch(BORDER);
  });

  it.each([
    ['neutral', 'bg-muted/50'],
    ['green', 'bg-success/10'],
    ['red', 'bg-destructive/10'],
  ] as const)('tints a %s list item with %s tokens and no border', (listVariant, tint) => {
    render(<TagInput variant="list" listVariant={listVariant} addLabel="Add" items={['NYHA II-IV']} onAdd={noop} onRemove={noop} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveClass(tint);
    expect(item.className).not.toMatch(BORDER);
    expect(item.className).not.toMatch(/green-500|red-500/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/settings/TagInput.test.tsx`
Expected: "still adds on Enter and removes by index" PASSES (pins behaviour); every other case FAILS (no textbox named "Review keywords", no button named by `addLabel`, `h-7` present, `border` present, `green-500` tint).

- [ ] **Step 3: Add the copy key** — in `frontend/lib/copy/common.ts`, after `    fieldHintAria: 'About {{label}}',`:

```ts
    /** Names TagInput's add control; `{{label}}` is the row label. */
    addToLabel: 'Add to {{label}}',
```

- [ ] **Step 4: Restyle `TagInput`** — replace `frontend/components/settings/TagInput.tsx`

The `success` and `destructive` colours are theme tokens (`frontend/index.css:70,85`, `--color-success` / `--color-destructive`); `bg-success/10` is already used in `frontend/components`.

```tsx
/**
 * Draft input + add control + the added items, each removable. Shared by
 * AdvancedSettingsSection and PICOTSItemEditor. Flat-grid look (spec
 * 2026-09-13-borderless-density-pass §4.1): quiet input, IconButton add,
 * borderless chips and list items tinted with theme tokens.
 */

import * as React from 'react';
import {Plus, X} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Input} from '@/components/ui/input';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

type TagInputVariant = 'badge' | 'list';

export interface TagInputProps {
    items: string[];
    onAdd: (value: string) => void;
    onRemove: (index: number) => void;
    placeholder?: string;
    variant?: TagInputVariant;
    /** List style: 'green' for inclusion, 'red' for exclusion, 'neutral' default */
    listVariant?: 'neutral' | 'green' | 'red';
    className?: string;
    /** The draft input's id, so a SettingsRow label can point at it. */
    id?: string;
    /** The draft input's description ids (SettingsRow's render-prop `describedBy`). */
    'aria-describedby'?: string;
    /** Names the add control, e.g. "Add to Inclusion criteria" (common.addToLabel). */
    addLabel: string;
}

const LIST_ITEM_TINT = {
    neutral: 'bg-muted/50',
    green: 'bg-success/10',
    red: 'bg-destructive/10',
} as const;

export function TagInput({
    items,
    onAdd,
    onRemove,
    placeholder = t('common', 'addItemPlaceholder'),
    variant = 'badge',
    listVariant = 'neutral',
    className,
    id,
    'aria-describedby': ariaDescribedBy,
    addLabel,
}: TagInputProps) {
    const [value, setValue] = React.useState('');

    const handleAdd = () => {
        const trimmed = value.trim();
        if (trimmed) {
            onAdd(trimmed);
            setValue('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    const draft = (
        <div className="flex items-center gap-1">
            <Input
                id={id}
                aria-describedby={ariaDescribedBy}
                variant="quiet"
                placeholder={placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
            />
            <IconButton label={addLabel} icon={<Plus strokeWidth={1.5}/>} onClick={handleAdd}/>
        </div>
    );

    if (variant === 'badge') {
        return (
            <div className={cn('space-y-2', className)}>
                {draft}
                {items.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {items.map((item, index) => (
                            <span
                                key={`${item}-${index}`}
                                className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 py-1 pl-2.5 pr-1.5 text-[13px]"
                            >
                                {item}
                                <IconButton
                                    label={t('common', 'remove')}
                                    size="icon-xs"
                                    className="rounded-full"
                                    onClick={() => onRemove(index)}
                                    icon={<X strokeWidth={1.5}/>}
                                />
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={cn('space-y-1.5', className)}>
            {draft}
            {items.length > 0 && (
                <ul className="space-y-1">
                    {items.map((item, index) => (
                        <li
                            key={`${item}-${index}`}
                            className={cn('flex items-center gap-2 rounded-md py-0.5 pl-2 pr-0.5 text-[13px]', LIST_ITEM_TINT[listVariant])}
                        >
                            <span className="flex-1 text-muted-foreground">{item}</span>
                            <IconButton
                                label={t('common', 'remove')}
                                size="icon-xs"
                                onClick={() => onRemove(index)}
                                icon={<X strokeWidth={1.5}/>}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
```

- [ ] **Step 5: Pass `addLabel` at every caller**

Confirm the caller list first: `grep -rn "<TagInput" frontend --include='*.tsx'` → exactly 6 hits: 4 in `AdvancedSettingsSection.tsx`, 2 in `PICOTSItemEditor.tsx` (tests excepted). Each gets one new prop line right after its `placeholder=` line, at the same indentation.

`frontend/components/project/settings/AdvancedSettingsSection.tsx`:
- after `placeholder={t('project', 'advancedKeywordsPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'advancedCardKeywordsTitle'))}`
- after `placeholder={t('project', 'advancedInclusionPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'advancedInclusionLabel'))}`
- after `placeholder={t('project', 'advancedExclusionPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'advancedExclusionLabel'))}`
- after `placeholder={t('project', 'advancedStudyTypesPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'advancedCardStudyTypesTitle'))}`

`frontend/components/project/settings/PICOTSItemEditor.tsx`:
- after `placeholder={t('project', 'picotsAddInclusionPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'picotsInclusionCriteriaLabel'))}`
- after `placeholder={t('project', 'picotsAddExclusionPlaceholder')}` add
  `addLabel={t('common', 'addToLabel').replace('{{label}}', t('project', 'picotsExclusionCriteriaLabel'))}`

All six copy keys exist (`frontend/lib/copy/project.ts:86,87,133,138,139,144`).

- [ ] **Step 6: Run the new test and the callers' tests**

Run: `npm run test:run -- frontend/components/settings/TagInput.test.tsx frontend/test/components/ReviewQuestionSection.test.tsx frontend/test/components/AdvancedSettingsSection.test.tsx frontend/test/components/ProjectSettings.sections.test.tsx`
Expected: all PASS. `ReviewQuestionSection.test.tsx` still counts 2 `type="text"` textboxes (the draft `Input` keeps no `type` attribute).

- [ ] **Step 7: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green; `typecheck` proves no `TagInput` caller is missing `addLabel`. Button scale: `TagInput.tsx`, `AdvancedSettingsSection.tsx` and `PICOTSItemEditor.tsx` have no entry in `scripts/fitness/check_button_scale.baseline` and this task adds no `h-*` to a `<Button>` (the outline add `Button` is gone), so the baseline is not edited. Verify with `grep -n "TagInput\|AdvancedSettingsSection\|PICOTSItemEditor" scripts/fitness/check_button_scale.baseline` → no output.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/settings/TagInput.tsx frontend/components/settings/TagInput.test.tsx frontend/lib/copy/common.ts frontend/components/project/settings/AdvancedSettingsSection.tsx frontend/components/project/settings/PICOTSItemEditor.tsx
```
```bash
git commit -m "refactor(settings): flat TagInput with quiet input, named add control and token tints

The draft input takes id and aria-describedby so a settings row can label and
describe it; the add control is an IconButton named by addLabel
(common.addToLabel). Chips and list items drop their border, and the list
tints move from raw green-500/red-500 to the success/destructive tokens.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Basic info + Review details + Project settings gutter

**Files:**
- Modify: `frontend/components/project/ProjectSettings.tsx:173` (main inner wrapper)
- Modify (full rewrite of the render): `frontend/components/project/settings/BasicInfoSection.tsx:1-116`
- Modify (full rewrite of the render): `frontend/components/project/settings/ReviewDetailsSection.tsx:1-118`
- Modify: `frontend/lib/copy/project.ts:46-49,56-57,59-60,63-64,66,80` (key deletions)
- Test (modify): `frontend/test/components/ProjectSettings.sections.test.tsx` (append one `it`)
- Test (create): `frontend/test/components/BasicInfoSection.test.tsx`
- Test (create): `frontend/test/components/ReviewDetailsSection.test.tsx`

**Interfaces:**
- Consumes: `SettingsPage`, `SettingsGroup`, `SettingsRow` (render-prop `({describedBy})`) from `@/components/settings` (Task 2b); `variant="quiet"` on `Input`, `Textarea`, `SelectTrigger` (Task 1); `common.fieldHintAria` "About {{label}}" (Task 2a); `SettingsGroup` root carries the class `border-t` and its title is an `<h2>` (Task 2b).
- Produces: nothing new. `BasicInfoSection` and `ReviewDetailsSection` keep their props.

`ProjectSettings.sections.test.tsx` stubs every section, so it only pins the gutter. The two sections get real-render test files. They use the real copy, following `AiEngineSection.test.tsx`.

- [ ] **Step 1: Write the failing gutter test.** Append this inside `describe('ProjectSettings sections', …)` in `frontend/test/components/ProjectSettings.sections.test.tsx`, after the `'no longer stacks the AI engine under review details'` test:

```tsx
  it('owns a p-2 gutter and no centred 1920px wrapper (the section owns the width)', () => {
    renderAt('?tab=settings&section=basic');
    const inner = screen.getByRole('main').firstElementChild;
    expect(inner).toHaveClass('p-2');
    for (const old of ['max-w-[1920px]', 'mx-auto', 'px-6', 'py-6', 'lg:px-8', 'lg:py-8']) {
      expect(inner).not.toHaveClass(old);
    }
  });
```

- [ ] **Step 2: Write the failing Basic info test.** Create `frontend/test/components/BasicInfoSection.test.tsx`:

```tsx
/** Basic info as one untitled group of label/value rows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {REVIEW_TYPES, type ReviewType} from '@/types/project';
import {BasicInfoSection} from '@/components/project/settings/BasicInfoSection';

function renderBasic(review_type: ReviewType) {
  return render(
    <BasicInfoSection project={{name: 'P', description: '', review_type}} onChange={vi.fn()} />,
  );
}

const aboutLabel = (label: string) => t('common', 'fieldHintAria').replace('{{label}}', label);

describe('BasicInfoSection', () => {
  it('renders one untitled group: no section heading and no card titles', () => {
    renderBasic('interventional');
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('no longer renders the PICOTS notice box for a predictive-model review', () => {
    const {container} = renderBasic('predictive_model');
    expect(screen.queryByText('PICOTS framework enabled')).toBeNull();
    expect(container.querySelector('[class~="border-primary/20"]')).toBeNull();
  });

  it("the review-type row hint is the selected type's description", () => {
    const {rerender} = renderBasic('predictive_model');
    const trigger = screen.getByRole('combobox', {name: /Review type/});
    expect(trigger).toHaveAccessibleDescription(REVIEW_TYPES.predictive_model.description);
    expect(screen.getByRole('button', {name: aboutLabel(t('project', 'basicReviewTypeLabel'))})).toBeInTheDocument();

    rerender(
      <BasicInfoSection project={{name: 'P', description: '', review_type: 'diagnostic'}} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', {name: /Review type/})).toHaveAccessibleDescription(
      REVIEW_TYPES.diagnostic.description,
    );
  });

  it('name and description hints reach their controls; controls are quiet with no caller height', () => {
    renderBasic('interventional');
    const name = screen.getByRole('textbox', {name: /Project name/});
    expect(name).toHaveAccessibleDescription(t('project', 'basicProjectNameHint'));
    expect(name).toHaveClass('border-transparent');
    expect(name).not.toHaveClass('h-9');
    expect(screen.getByRole('textbox', {name: /Description/})).toHaveAccessibleDescription(
      t('project', 'basicDescriptionHint'),
    );
  });
});
```

- [ ] **Step 3: Write the failing Review details test.** Create `frontend/test/components/ReviewDetailsSection.test.tsx`:

```tsx
/** Review details as two titled groups of label/value rows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {ReviewDetailsSection} from '@/components/project/settings/ReviewDetailsSection';

const PROJECT = {
  review_title: '',
  condition_studied: '',
  review_rationale: '',
  search_strategy: '',
  review_context: '',
  review_type: 'interventional' as const,
};

function renderDetails() {
  return render(<ReviewDetailsSection project={PROJECT} onChange={vi.fn()} />);
}

describe('ReviewDetailsSection', () => {
  it('renders exactly the two group titles as <h2>', () => {
    renderDetails();
    expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
      ['H2', t('project', 'reviewCardGeneralTitle')],
      ['H2', t('project', 'reviewCardSearchTitle')],
    ]);
  });

  it.each([
    ['reviewTitleLabel', 'reviewTitleHint'],
    ['reviewConditionStudiedLabel', 'reviewConditionStudiedHint'],
    ['reviewContextLabel', 'reviewContextHint'],
    ['reviewRationaleLabel', 'reviewRationaleHint'],
    ['reviewStrategyLabel', 'reviewStrategyHint'],
  ] as const)('row %s is labelled and its hint reaches the control', (labelKey, hintKey) => {
    renderDetails();
    const control = screen.getByRole('textbox', {name: t('project', labelKey)});
    expect(control).toHaveAccessibleDescription(t('project', hintKey));
    expect(control).toHaveClass('border-transparent');
  });

  it('keeps the strategy textarea monospace', () => {
    renderDetails();
    expect(screen.getByRole('textbox', {name: t('project', 'reviewStrategyLabel')})).toHaveClass('font-mono');
  });
});
```

- [ ] **Step 4: Run the three files red.**

Run: `npm run test:run -- frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/components/BasicInfoSection.test.tsx frontend/test/components/ReviewDetailsSection.test.tsx`
Expected: FAIL. The gutter test fails on `toHaveClass('p-2')`. Basic info fails on headings found, the PICOTS text present, and no accessible description. Review details fails on the heading list (`H2 Review details` plus card titles) and on descriptions. The pre-existing `ProjectSettings` tests still pass.

- [ ] **Step 5: Change the gutter.** In `frontend/components/project/ProjectSettings.tsx:173` replace

```tsx
            <div className="w-full max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8">
```

with

```tsx
            <div className="w-full p-2">
```

- [ ] **Step 6: Rewrite `BasicInfoSection.tsx`.** Replace the whole file with:

```tsx
/**
 * Basic project info section — name, description, review type — as one
 * untitled group of label/value rows (spec 2026-09-13 §4.3).
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Badge} from '@/components/ui/badge';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import type {Project, ReviewType} from '@/types/project';
import {REVIEW_TYPES} from '@/types/project';
import {t} from '@/lib/copy';

interface BasicInfoSectionProps {
    project: Pick<Project, 'name' | 'description' | 'review_type'>;
    onChange: (updates: Partial<Pick<Project, 'name' | 'description' | 'review_type'>>) => void;
}

export function BasicInfoSection({project, onChange}: BasicInfoSectionProps) {
    const currentReviewType = (project.review_type || 'interventional') as ReviewType;

    return (
        <SettingsPage>
            <SettingsGroup>
                <SettingsRow
                    label={t('project', 'basicProjectNameLabel')}
                    htmlFor="name"
                    required
                    hint={t('project', 'basicProjectNameHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="name"
                            variant="quiet"
                            value={project.name}
                            onChange={(e) => onChange({name: e.target.value})}
                            placeholder={t('project', 'basicProjectNamePlaceholder')}
                            required
                            aria-describedby={describedBy}
                            className="max-w-2xl"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'basicDescriptionLabel')}
                    htmlFor="description"
                    hint={t('project', 'basicDescriptionHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="description"
                            variant="quiet"
                            value={project.description ?? ''}
                            onChange={(e) => onChange({description: e.target.value})}
                            placeholder={t('project', 'basicDescriptionPlaceholder')}
                            rows={4}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'basicReviewTypeLabel')}
                    htmlFor="review_type"
                    required
                    hint={REVIEW_TYPES[currentReviewType].description}
                >
                    {({describedBy}) => (
                        <Select
                            value={currentReviewType}
                            onValueChange={(value: ReviewType) => onChange({review_type: value})}
                        >
                            <SelectTrigger
                                id="review_type"
                                variant="quiet"
                                aria-describedby={describedBy}
                                className="max-w-md"
                            >
                                <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(REVIEW_TYPES) as ReviewType[]).map((type) => (
                                    <SelectItem key={type} value={type}>
                                        <div className="flex items-center gap-2">
                                            <span>{REVIEW_TYPES[type].label}</span>
                                            {REVIEW_TYPES[type].badge && (
                                                <Badge variant="secondary" className="text-[11px]">
                                                    {REVIEW_TYPES[type].badge}
                                                </Badge>
                                            )}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </SettingsRow>
            </SettingsGroup>
        </SettingsPage>
    );
}
```

- [ ] **Step 7: Rewrite `ReviewDetailsSection.tsx`.** Replace the whole file with:

```tsx
/**
 * Review details section — the review's prose fields (title, condition,
 * context, rationale, search strategy). The AI review question (PICOTS) is its
 * own section, `ReviewQuestionSection`, written through a manager-gated typed
 * PUT rather than this section's batched PostgREST draft.
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import type {Project} from '@/types/project';
import {t} from '@/lib/copy';

type ProjectShape = Pick<
    Project,
    | 'review_title'
    | 'condition_studied'
    | 'review_rationale'
    | 'search_strategy'
    | 'review_context'
    | 'review_type'
>;

interface ReviewDetailsSectionProps {
    project: ProjectShape;
    onChange: (updates: Partial<ProjectShape>) => void;
}

export function ReviewDetailsSection({project, onChange}: ReviewDetailsSectionProps) {
    return (
        <SettingsPage>
            <SettingsGroup title={t('project', 'reviewCardGeneralTitle')}>
                <SettingsRow
                    label={t('project', 'reviewTitleLabel')}
                    htmlFor="review_title"
                    hint={t('project', 'reviewTitleHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="review_title"
                            variant="quiet"
                            value={project.review_title ?? ''}
                            onChange={(e) => onChange({review_title: e.target.value})}
                            placeholder={t('project', 'reviewTitlePlaceholder')}
                            aria-describedby={describedBy}
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewConditionStudiedLabel')}
                    htmlFor="condition_studied"
                    hint={t('project', 'reviewConditionStudiedHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="condition_studied"
                            variant="quiet"
                            value={project.condition_studied ?? ''}
                            onChange={(e) => onChange({condition_studied: e.target.value})}
                            placeholder={t('project', 'reviewConditionStudiedPlaceholder')}
                            aria-describedby={describedBy}
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewContextLabel')}
                    htmlFor="review_context"
                    hint={t('project', 'reviewContextHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="review_context"
                            variant="quiet"
                            value={project.review_context ?? ''}
                            onChange={(e) => onChange({review_context: e.target.value})}
                            placeholder={t('project', 'reviewContextPlaceholder')}
                            rows={3}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewRationaleLabel')}
                    htmlFor="review_rationale"
                    hint={t('project', 'reviewRationaleHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="review_rationale"
                            variant="quiet"
                            value={project.review_rationale ?? ''}
                            onChange={(e) => onChange({review_rationale: e.target.value})}
                            placeholder={t('project', 'reviewRationalePlaceholder')}
                            rows={5}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
            </SettingsGroup>

            <SettingsGroup title={t('project', 'reviewCardSearchTitle')}>
                <SettingsRow
                    label={t('project', 'reviewStrategyLabel')}
                    htmlFor="search_strategy"
                    hint={t('project', 'reviewStrategyHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="search_strategy"
                            variant="quiet"
                            value={project.search_strategy ?? ''}
                            onChange={(e) => onChange({search_strategy: e.target.value})}
                            placeholder={t('project', 'reviewStrategyPlaceholder')}
                            rows={8}
                            aria-describedby={describedBy}
                            className="font-mono resize-none"
                        />
                    )}
                </SettingsRow>
            </SettingsGroup>
        </SettingsPage>
    );
}
```

- [ ] **Step 8: Run the three files green.**

Run: `npm run test:run -- frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/components/BasicInfoSection.test.tsx frontend/test/components/ReviewDetailsSection.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 9: Grep the copy keys before deleting them.**

Run: `bash -c 'for k in basicSectionTitle basicSectionDesc basicCardIdentification basicCardIdentificationDesc basicReviewTypeCardTitle basicReviewTypeCardDesc basicPicotsEnabledTitle basicPicotsEnabledDesc reviewSectionTitle reviewSectionDesc reviewCardGeneralDesc reviewCardSearchDesc; do echo "== $k"; grep -rnw "$k" frontend/; done'`
Expected: each key prints exactly one hit, its definition in `frontend/lib/copy/project.ts`. If any other hit appears, stop: that is a reference to update first.

- [ ] **Step 10: Delete the keys.** In `frontend/lib/copy/project.ts` delete these lines, leaving every neighbouring key in place:

```ts
    basicSectionTitle: 'Basic info',
    basicSectionDesc: 'Identify your project with a clear name and set the review type.',
    basicCardIdentification: 'Project identification',
    basicCardIdentificationDesc: 'This information helps you and your team identify the project.',
    basicReviewTypeCardTitle: 'Review type',
    basicReviewTypeCardDesc: 'Select the systematic review type to enable specific features.',
    basicPicotsEnabledTitle: 'PICOTS framework enabled',
    basicPicotsEnabledDesc: 'The Review details section will include the PICOTS framework with inclusion/exclusion criteria (Population, Index, Comparator, Outcomes, Timing, Setting).',
    reviewSectionTitle: 'Review details',
    reviewSectionDesc: 'Configure the methodological aspects of your systematic review.',
    reviewCardGeneralDesc: 'Review title, condition studied and rationale.',
    reviewCardSearchDesc: 'Databases, search terms and collection period.',
```

- [ ] **Step 11: Run the gates.** Run each and read the tail:

```bash
npm run test:run
npm run typecheck
npm run lint
npx knip --no-tag-hints
npx knip --production --no-tag-hints
bash scripts/fitness/run_all.sh
```

Expected: every command exits 0, knip reports zero findings in both modes, and `run_all.sh` shows every check OK. `SettingsCard`, `SettingsField` and `SettingsSection` are still used elsewhere, so knip stays clean.

- [ ] **Step 12: Commit.** Run each as its own shell call:

```bash
git add frontend/components/project/ProjectSettings.tsx frontend/components/project/settings/BasicInfoSection.tsx frontend/components/project/settings/ReviewDetailsSection.tsx frontend/lib/copy/project.ts frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/components/BasicInfoSection.test.tsx frontend/test/components/ReviewDetailsSection.test.tsx
```

```bash
git commit -m "refactor(settings): basic info and review details as flat label rows, p-2 gutter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Review question

**Files:**
- Modify (full rewrite): `frontend/components/project/settings/ReviewQuestionSection.tsx:1-31`
- Modify (full rewrite): `frontend/components/project/settings/PICOTSItemEditor.tsx:1-117`
- Modify: `frontend/components/project/PicotsPane.tsx:21-42` (imports), `:124-206` (PicotsForm render), `:237-254` (PicotsPane states), `:268-281` (PicotsPreview)
- Modify: `frontend/lib/copy/aiContext.ts:12`, `frontend/lib/copy/project.ts:91` (key deletions)
- Test (modify): `frontend/test/components/ReviewQuestionSection.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `SettingsPage({intro})`, `SettingsGroup`, `SettingsRow` (render-prop, `align="start"`) (Task 2b); `variant="quiet"` on `Textarea` (Task 1); `TagInput` props `id`, `addLabel` (Task 3); `common.fieldHintAria` and `common.addToLabel` (Task 2a / Task 3).
- Produces: `PICOTSItemEditor`'s prop `infoTooltip: string` becomes `hint?: string`. Its only caller is `PicotsPane.tsx`, updated in this task. `PicotsPane` now returns `SettingsGroup`s, a fragment of two in the loaded state, so it must be rendered as a direct child of `SettingsPage`.

- [ ] **Step 1: Write the failing tests.** Append to `frontend/test/components/ReviewQuestionSection.test.tsx`:

```tsx
describe('ReviewQuestionSection — flat layout (spec 2026-09-13 §4.3, §10)', () => {
  const INTRO = 'What this review is asking. Sent to the AI with every extraction and quality assessment.';
  const groupOf = (el: Element | null) => el?.closest('.border-t') as HTMLElement | null;

  it('renders the intro line in place of the section heading', () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Review question'})).toBeNull();
  });

  it('has no separator between the groups or inside a slot', () => {
    const {container} = render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.queryByRole('separator')).toBeNull();
    // ui/separator is decorative (role="none"), so the role query alone is vacuous;
    // Radix Separator always stamps data-orientation.
    expect(container.querySelector('[data-orientation]')).toBeNull();
  });

  it("the switch is a row whose hint reaches it; the timing slot's help is the row ⓘ", () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.getByRole('switch', {name: 'Send to the AI'})).toHaveAccessibleDescription(
      'Turn off to withhold the review question from AI calls without deleting it.',
    );
    expect(screen.getByRole('button', {name: 'About Timing'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Help'})).toBeNull();
    expect(screen.getByLabelText('Timing')).toHaveAccessibleDescription(
      'Covers both the prediction moment (T0) and the prediction horizon.',
    );
  });

  it('labels the criteria inputs and names their add controls from the row label', () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    // TagInput's draft Input sets no type attribute (Task 3); the property defaults to text.
    expect((screen.getByLabelText('Inclusion criteria') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', {name: 'Add to Inclusion criteria'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Add to Exclusion criteria'})).toBeInTheDocument();
  });

  it('the preview drops its border and keeps its muted fill', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    await user.click(screen.getByRole('button', {name: /What the AI is sent/}));
    const pre = document.querySelector('pre');
    expect(pre).not.toHaveClass('border');
    expect(pre).toHaveClass('bg-muted/40');
  });

  it('the sticky footer Cancel is ghost', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    await user.type(screen.getByLabelText('Population'), '!');
    const cancel = screen.getByRole('button', {name: 'Cancel'});
    expect(cancel).not.toHaveClass('border');
    expect(cancel).not.toHaveClass('border-input');
  });

  it('loading and error render inside the first group', () => {
    vi.mocked(useAiContext).mockReturnValue({data: undefined, isLoading: true, isError: false} as unknown as ReturnType<typeof useAiContext>);
    const {unmount} = render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(groupOf(document.querySelector('.animate-pulse'))).not.toBeNull();
    unmount();

    vi.mocked(useAiContext).mockReturnValue({data: undefined, isLoading: false, isError: true} as unknown as ReturnType<typeof useAiContext>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(groupOf(screen.getByText('Could not load the review question'))).not.toBeNull();
  });

  it.each([
    ['loading', {data: undefined, isLoading: true, isError: false}],
    ['error', {data: undefined, isLoading: false, isError: true}],
    ['empty', {data: readModel({preview: null}), isLoading: false, isError: false}],
  ])('a non-manager sees the preview %s state inside the managerOnly group', (state, read) => {
    vi.mocked(useProjectMemberRole).mockReturnValue({isManager: false} as unknown as ReturnType<typeof useProjectMemberRole>);
    vi.mocked(useAiContext).mockReturnValue(read as unknown as ReturnType<typeof useAiContext>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    const group = groupOf(screen.getByText('Only project managers can change the review question.'));
    expect(group).not.toBeNull();
    const stateEl =
      state === 'loading'
        ? group!.querySelector('.animate-pulse')
        : state === 'error'
          ? screen.getByText('Could not load the review question')
          : screen.getByText('Nothing yet. Fill in at least one part above.');
    expect(stateEl).not.toBeNull();
    expect(group!.contains(stateEl)).toBe(true);
  });
});
```

- [ ] **Step 2: Run red.**

Run: `npm run test:run -- frontend/test/components/ReviewQuestionSection.test.tsx`
Expected: FAIL on the new describe. There is still a "Review question" heading, a `data-orientation` separator exists, there is no "About Timing" button, the criteria are unlabelled, the preview has a `border`, Cancel carries `border-input`, and no `.border-t` group exists. The existing 13 tests pass.

- [ ] **Step 3: Rewrite `ReviewQuestionSection.tsx`.** Replace the whole file with:

```tsx
/**
 * Project → Configuration → Review question. The review question used to be
 * a dialog opened from a card in Review details; it is configuration, so it
 * is a section of the configuration view (spec 2026-09-13 §4.2). Flat groups
 * under one intro line (spec 2026-09-13 borderless density pass §4.3).
 */
import {SettingsGroup, SettingsPage} from '@/components/settings';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';

import {PicotsPane, PicotsPreview} from '../PicotsPane';

interface ReviewQuestionSectionProps {
  projectId: string;
  onDirtyChange: (dirty: boolean) => void;
}

export function ReviewQuestionSection({projectId, onDirtyChange}: ReviewQuestionSectionProps) {
  const {isManager} = useProjectMemberRole(projectId);
  return (
    <SettingsPage intro={t('aiContext', 'sectionDesc')}>
      {isManager ? (
        <PicotsPane projectId={projectId} onDirtyChange={onDirtyChange} />
      ) : (
        <SettingsGroup>
          <p className="text-[13px] text-muted-foreground">{t('aiContext', 'managerOnly')}</p>
          <PicotsPreview projectId={projectId} />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
```

- [ ] **Step 4: Rewrite `PICOTSItemEditor.tsx`.** Task 3 added `addLabel` at this file's two `TagInput` call sites; this full file supersedes that edit:

```tsx
/**
 * One PICOTS slot as a settings row: the description, then — where the slot
 * shows criteria — the inclusion and exclusion lists (TagInput), in the same
 * value cell with no separator (spec 2026-09-13 §4.3).
 */

import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {SettingsRow, TagInput} from '@/components/settings';
import {t} from '@/lib/copy';

/** One PICOTS slot. Declared here now — the section that used to own this
 * type no longer edits slots, and the editor is the only shape authority. */
export interface PICOTSItem {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSItemEditorProps {
  /** The server's wording for the slot — the row label. */
  label: string;
  fieldKey: string;
  data: PICOTSItem;
  /** Row hint behind the ⓘ; omit when the label carries the meaning. */
  hint?: string;
  descriptionPlaceholder: string;
  /** Criteria lists are a Population concern — every other slot renders as a
   * plain description box. A slot that already CARRIES criteria still shows
   * the populated list, so stored data is never sent to the AI invisibly. */
  showCriteria: boolean;
  onUpdate: (field: string, subField: string, value: unknown) => void;
  onAddItem: (field: string, arrayField: 'inclusion' | 'exclusion', value: string) => void;
  onRemoveItem: (field: string, arrayField: 'inclusion' | 'exclusion', index: number) => void;
}

export function PICOTSItemEditor({
  label,
  fieldKey,
  data,
  hint,
  descriptionPlaceholder,
  showCriteria,
  onUpdate,
  onAddItem,
  onRemoveItem,
}: PICOTSItemEditorProps) {
  const inclusion = data.inclusion || [];
  const exclusion = data.exclusion || [];
  const withInclusion = showCriteria || inclusion.length > 0;
  const withExclusion = showCriteria || exclusion.length > 0;
  const inclusionLabel = t('project', 'picotsInclusionCriteriaLabel');
  const exclusionLabel = t('project', 'picotsExclusionCriteriaLabel');

  return (
    <SettingsRow label={label} htmlFor={`${fieldKey}_description`} hint={hint} align="start">
      {({describedBy}) => (
        <div className="space-y-2">
          <Textarea
            id={`${fieldKey}_description`}
            variant="quiet"
            value={data.description ?? ''}
            onChange={(e) => onUpdate(fieldKey, 'description', e.target.value)}
            placeholder={descriptionPlaceholder}
            rows={2}
            aria-describedby={describedBy}
            className="resize-none"
          />

          {withInclusion && (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2 px-2">
                <Label htmlFor={`${fieldKey}_inclusion`} className="text-xs font-medium text-muted-foreground">
                  {inclusionLabel}
                </Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
              </div>
              <TagInput
                id={`${fieldKey}_inclusion`}
                items={inclusion}
                onAdd={(value) => onAddItem(fieldKey, 'inclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'inclusion', index)}
                placeholder={t('project', 'picotsAddInclusionPlaceholder')}
                addLabel={t('common', 'addToLabel').replace('{{label}}', inclusionLabel)}
                variant="list"
                listVariant="green"
              />
            </div>
          )}

          {withExclusion && (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2 px-2">
                <Label htmlFor={`${fieldKey}_exclusion`} className="text-xs font-medium text-muted-foreground">
                  {exclusionLabel}
                </Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
              </div>
              <TagInput
                id={`${fieldKey}_exclusion`}
                items={exclusion}
                onAdd={(value) => onAddItem(fieldKey, 'exclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'exclusion', index)}
                placeholder={t('project', 'picotsAddExclusionPlaceholder')}
                addLabel={t('common', 'addToLabel').replace('{{label}}', exclusionLabel)}
                variant="list"
                listVariant="red"
              />
            </div>
          )}
        </div>
      )}
    </SettingsRow>
  );
}
```

Task 3 keeps `variant: 'badge' | 'list'` and `listVariant: 'neutral' | 'green' | 'red'`, so these are Task 3's values.

- [ ] **Step 5: `PicotsPane.tsx` imports (`:21-42`).** Delete `import {Switch} …`'s neighbours `import {Label} from '@/components/ui/label';` and `import {Separator} from '@/components/ui/separator';`. Add after the `Skeleton` import:

```tsx
import {SettingsGroup, SettingsRow} from '@/components/settings';
```

`Button`, `Collapsible*`, `Switch`, `Skeleton`, `ChevronRight` and `toast` stay.

- [ ] **Step 6: `PicotsForm` render (`:124-206`).** Replace everything from `  return (` through the closing `  );` of `PicotsForm` with:

```tsx
  return (
    <>
      <SettingsGroup>
        <SettingsRow
          label={t('aiContext', 'enabledLabel')}
          htmlFor="picots-enabled"
          hint={t('aiContext', 'enabledHint')}
        >
          {({describedBy}) => (
            <Switch
              id="picots-enabled"
              checked={enabled}
              onCheckedChange={(value) => commit(draft, value)}
              aria-describedby={describedBy}
            />
          )}
        </SettingsRow>

        {/* The prompt preview is the ground truth of this whole section — what
            the model actually receives — so it sits at the TOP, where it is
            discoverable, and collapsed, so it costs nothing until asked for. */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group w-full justify-start gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
            >
              {/* Radix puts data-state on the TRIGGER, which is this button —
                  so the group is the button, not a wrapper. */}
              <ChevronRight
                className="shrink-0 transition-transform group-data-[state=open]:rotate-90"
                strokeWidth={1.5}
                aria-hidden
              />
              {t('aiContext', 'previewTitle')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-1 px-2 text-xs text-muted-foreground">{t('aiContext', 'previewHint')}</p>
            <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-muted/40 p-2.5 text-xs whitespace-pre-wrap">
              {initial.preview ?? t('aiContext', 'previewEmpty')}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </SettingsGroup>

      <SettingsGroup>
        {SLOT_KEYS.map((key) => (
          <PICOTSItemEditor
            key={key}
            label={initial.labels?.[key] ?? key}
            fieldKey={key}
            data={slots[key] ?? EMPTY_SLOT}
            hint={key === 'timing' ? t('aiContext', 'timingHint') : undefined}
            descriptionPlaceholder=""
            showCriteria={key === 'population'}
            onUpdate={updateField}
            onAddItem={addItem}
            onRemoveItem={removeItem}
          />
        ))}

        {dirty && (
          <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-border/40 bg-background py-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              {t('aiContext', 'cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => onSave({picots: draft, picots_enabled: enabled})}
              disabled={pending}
            >
              {pending ? t('aiContext', 'saving') : t('aiContext', 'save')}
            </Button>
          </div>
        )}
      </SettingsGroup>
    </>
  );
```

- [ ] **Step 7: `PicotsPane` states (`:237-254`).** Replace the `if (isError) {…}` and `if (!data) {…}` blocks with:

```tsx
  if (isError) {
    // Save stays unreachable: with no read there is no draft, and an empty
    // one would overwrite the stored review question with blanks.
    return (
      <SettingsGroup>
        <p className="text-[13px] text-destructive">{t('aiContext', 'loadError')}</p>
      </SettingsGroup>
    );
  }
  if (!data) {
    return (
      <SettingsGroup>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </SettingsGroup>
    );
  }
```

- [ ] **Step 8: `PicotsPreview` (`:268-281`).** The host (`ReviewQuestionSection`) owns the group. Replace only the skeleton line:

```tsx
    return <Skeleton className="h-20 w-full rounded-md" />;
```

with

```tsx
    return <Skeleton className="h-8 w-full" />;
```

The error `<p>` and the borderless `<pre>` stay as they are.

- [ ] **Step 9: Run green.**

Run: `npm run test:run -- frontend/test/components/ReviewQuestionSection.test.tsx frontend/test/components/ProjectSettings.sections.test.tsx`
Expected: PASS, every test including the 13 pre-existing ones.

- [ ] **Step 10: Grep the copy keys before deleting them.**

Run: `bash -c 'grep -rn "picotsHelpAria" frontend/; grep -rnw "sectionTitle" frontend/'`
Expected: `picotsHelpAria` has one hit, `frontend/lib/copy/project.ts:91`. `sectionTitle` has exactly two hits: `frontend/lib/copy/aiContext.ts:12` and `frontend/lib/copy/consensus.ts:8`, the latter owned by Task 8b. There is no `t('aiContext', 'sectionTitle')` left.

- [ ] **Step 11: Delete the keys.** In `frontend/lib/copy/aiContext.ts` delete `    sectionTitle: 'Review question',`. In `frontend/lib/copy/project.ts` delete `    picotsHelpAria: 'Help',`.

- [ ] **Step 12: Run the gates.** Run each and read the tail:

```bash
npm run test:run
npm run typecheck
npm run lint
npx knip --no-tag-hints
npx knip --production --no-tag-hints
bash scripts/fitness/run_all.sh
```

Expected: every command exits 0 with zero knip findings. `ui/separator` is still imported by `ArticlesList.tsx` and `AISuggestionReviewPopover.tsx`, so it is not orphaned.

- [ ] **Step 13: Commit.** Run each as its own shell call:

```bash
git add frontend/components/project/settings/ReviewQuestionSection.tsx frontend/components/project/settings/PICOTSItemEditor.tsx frontend/components/project/PicotsPane.tsx frontend/lib/copy/aiContext.ts frontend/lib/copy/project.ts frontend/test/components/ReviewQuestionSection.test.tsx
```

```bash
git commit -m "refactor(settings): review question as flat groups with slot rows and ghost cancel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: AI engine

**Files:**
- Modify: `frontend/components/project/settings/AiEngineSection.tsx`. The regions are: header comment `:1-7`, imports `:8-43`, `EngineCard` render `:81-152`, `SharedKeys` `addButton` + render `:177-329`, and `AiEngineSection` render `:337-362`. The logic (`label`, `write`, `current`, the hooks, `submit`, the state) is unchanged.
- Modify: `frontend/lib/copy/llmConnections.ts:71` (delete `cardTitle`)
- Test (modify): `frontend/test/components/AiEngineSection.test.tsx`. Edit `:89-94` and `:96-104`, and append tests.

**Interfaces:**
- Consumes: `SettingsPage`, `SettingsGroup({title, hint})`, `SettingsRow` (render-prop), `SettingsActions` (Task 2b); `variant="quiet"` on `Input`/`SelectTrigger` (Task 1); `IconButton` (existing); `SettingsGroup` root carries `border-t` (Task 2b).
- Produces: nothing new. `AiEngineSection({projectId})` is unchanged.

- [ ] **Step 1: Edit the two table tests.** In `frontend/test/components/AiEngineSection.test.tsx` replace `:89-94` with:

```tsx
  it('a manager sees the Shared keys list with serves tags and a remove control per row', async () => {
    renderSection();
    const list = await screen.findByRole('list', {name: t('llmConnections', 'sharedTitle')});
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText('parsing key')).toBeInTheDocument();
    expect(within(row).getByText(t('llmConnections', 'servesParsing'))).toBeInTheDocument();
    expect(within(row).getByRole('button', {name: t('llmConnections', 'sharedRemoveAria')})).toBeInTheDocument();
  });
```

and replace `:96-104` with:

```tsx
  it('a non-manager sees no shared keys and never fetches the list', async () => {
    role.isManager = false;
    let projectListHits = 0;
    server.use(http.get('*/api/v1/projects/p1/connections', () => { projectListHits += 1; return ok([SHARED]); }));
    renderSection();
    expect(await screen.findByText('GPT-4o mini')).toBeInTheDocument();
    expect(screen.queryByText('parsing key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: t('llmConnections', 'sharedRemoveAria')})).not.toBeInTheDocument();
    expect(projectListHits).toBe(0);
  });
```

- [ ] **Step 2: Append the new tests** inside `describe('AiEngineSection', …)`, before its closing `});`:

```tsx
  it('a non-manager sees the Locked badge next to the default when members are locked', async () => {
    role.isManager = false;
    server.use(http.get('*/api/v1/projects/p1/llm-engine', () => ok({...READ, default: {...READ.default, user_choice_allowed: false}})));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'lockedBadge'))).toBeInTheDocument();
    expect(screen.getByText('GPT-4o mini')).toBeInTheDocument();
  });

  it('rows carry their hints: default ← cardDescription, lock ← lockHint; no card title', async () => {
    renderSection();
    const lock = await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')});
    expect(lock).toHaveAccessibleDescription(t('llmConnections', 'lockHint'));
    expect(screen.getByRole('combobox', {name: t('llmConnections', 'defaultLabel')})).toHaveAccessibleDescription(
      t('llmConnections', 'cardDescription'),
    );
    expect(screen.queryByRole('heading', {name: 'AI engine'})).not.toBeInTheDocument();
  });

  it('the engine skeleton renders inside its group', async () => {
    server.use(http.get('*/api/v1/projects/p1/llm-engine', async () => { await delay(50); return ok(READ); }));
    renderSection();
    expect(screen.getByTestId('ai-engine-skeleton').closest('.border-t')).not.toBeNull();
    await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')});
  });

  it('shared keys skeleton, error and empty states render inside the Shared keys group', async () => {
    const sharedGroup = () =>
      screen.getByRole('heading', {name: t('llmConnections', 'sharedTitle')}).closest('.border-t') as HTMLElement;

    server.use(http.get('*/api/v1/projects/p1/connections', async () => { await delay(50); return ok([]); }));
    const first = renderSection();
    expect(sharedGroup().querySelector('.animate-pulse')).not.toBeNull();
    const empty = await screen.findByText(t('llmConnections', 'sharedEmpty'));
    expect(sharedGroup().contains(empty)).toBe(true);
    const add = within(sharedGroup()).getByRole('button', {name: t('llmConnections', 'sharedAddButton')});
    expect(add).not.toHaveClass('border');
    first.unmount();

    server.use(http.get('*/api/v1/projects/p1/connections', () => HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500})));
    renderSection();
    const error = await screen.findByText(t('llmConnections', 'sharedLoadError'));
    expect(sharedGroup().contains(error)).toBe(true);
    expect(within(sharedGroup()).getByRole('button', {name: t('llmConnections', 'retry')})).toBeInTheDocument();
  });

  it('the add form is labelled rows with a primary Save and a ghost Cancel, in no bordered box', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('button', {name: t('llmConnections', 'sharedAddButton')}));
    const fields = [
      screen.getByRole('combobox', {name: t('llmConnections', 'providerLabel')}),
      screen.getByLabelText(t('llmConnections', 'labelLabel')),
      screen.getByLabelText(t('llmConnections', 'keyLabel')),
    ];
    for (const field of fields) {
      // SETTINGS_ROW_GRID (Task 2b): each control sits in its own SettingsRow.
      expect(field.closest('.grid')).toHaveClass('@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
      for (let el = field.parentElement; el && el !== document.body; el = el.parentElement) {
        const classes = Array.from(el.classList);
        expect(classes.includes('border') && classes.some((c) => c.startsWith('rounded'))).toBe(false);
      }
    }
    // ui/button.tsx: variant "default" renders bg-primary; "ghost" renders hover:bg-accent.
    const save = screen.getByRole('button', {name: t('llmConnections', 'saveButton')});
    expect(save).toHaveClass('bg-primary');
    expect(save).not.toHaveClass('hover:bg-accent');
    const cancel = screen.getByRole('button', {name: t('llmConnections', 'cancelButton')});
    expect(cancel).toHaveClass('hover:bg-accent');
    expect(cancel).not.toHaveClass('bg-primary');
  });
```

Also update the file's first comment line to: `/** §7.6: manager editable rows, non-manager read-only, lock PUTs the default,` and `* card load error, plus the Shared keys list, form and per-group states. */`.

- [ ] **Step 3: Run red.**

Run: `npm run test:run -- frontend/test/components/AiEngineSection.test.tsx`
Expected: FAIL on:
- the list test (no `list` role; there is a table);
- the hint test (no accessible description; "AI engine" is still a card `h3`/heading);
- the engine-skeleton group test;
- the shared-states group test;
- the add-form test (today the form is a `rounded-md border` box and its fields sit in `space-y-1.5` divs, so `closest('.grid')` is null). Its Save/Cancel variant assertions already hold today; they pin the variants through the migration.

The Locked-badge test already passes; it pins today's behaviour through the migration. The non-manager test passes, and so do the rest.

- [ ] **Step 4: Imports and header (`:1-43`).** Replace the header comment with:

```tsx
/**
 * Project → Configuration → AI engine (spec 2026-09-13 §4.3): the project
 * DEFAULT (a catalogue pair), its mode and the lock as rows, then Shared keys —
 * the project's hosted-provider keys, every provider with "project" in its
 * scopes, llama_cloud included, each tagged by what it serves. Each group's
 * read loads and fails independently of the other's, inside its own group.
 */
```

In the imports, replace `import {SettingsCard} from '@/components/settings';` with

```tsx
import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
```

and delete `import {Label} from '@/components/ui/label';` and `import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';`. The imports `ui/table` keeps other consumers (`ArticlesList`, `HITLArticleTable`, `ArticleExtractionTable`).

- [ ] **Step 5: `EngineCard` render (`:81-152`).** Replace from `  return (` to the end of `EngineCard` with:

```tsx
  return (
    <>
      <SettingsRow
        label={t('llmConnections', 'defaultLabel')}
        htmlFor={isManager ? 'engine-default' : undefined}
        hint={t('llmConnections', 'cardDescription')}
      >
        {({describedBy}) =>
          isManager ? (
            <Select
              value={current}
              onValueChange={(v) => {
                const [provider, model] = v.split(':');
                write({provider, model});
              }}
            >
              <SelectTrigger id="engine-default" variant="quiet" aria-describedby={describedBy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {read.catalog.map((e) => (
                  <SelectItem key={e.canonical} value={e.canonical}>
                    {e.label}{' '}
                    <span className="text-[12px] text-muted-foreground">
                      ({providers.find((p) => p.id === e.provider)?.label ?? e.provider})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 px-2 text-[13px]">
              {label(read.default.provider, read.default.model)}
              {!read.default.user_choice_allowed && (
                <Badge variant="secondary">{t('llmConnections', 'lockedBadge')}</Badge>
              )}
            </div>
          )
        }
      </SettingsRow>
      <SettingsRow label={t('llmConnections', 'modeLabel')} htmlFor={isManager ? 'engine-mode' : undefined}>
        {isManager ? (
          <Select value={read.default.mode} onValueChange={(v) => write({mode: v as 'fast' | 'verified'})}>
            <SelectTrigger id="engine-mode" variant="quiet" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{t('llmConnections', 'modeFast')}</SelectItem>
              <SelectItem value="verified">{t('llmConnections', 'modeVerified')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="px-2 text-[13px]">
            {read.default.mode === 'verified' ? t('llmConnections', 'modeVerified') : t('llmConnections', 'modeFast')}
          </span>
        )}
      </SettingsRow>
      {isManager && (
        <SettingsRow label={t('llmConnections', 'lockLabel')} htmlFor="engine-lock" hint={t('llmConnections', 'lockHint')}>
          {({describedBy}) => (
            <Switch
              id="engine-lock"
              checked={!read.default.user_choice_allowed}
              disabled={save.isPending}
              onCheckedChange={(checked) => write({user_choice_allowed: !checked})}
              aria-describedby={describedBy}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}
```

The row `<label htmlFor>` now names the Mode trigger and the lock switch, so their `aria-label`s are removed, and the Mode `h-8 text-[13px]` override is stripped (§10). The existing tests query both by that same name.

- [ ] **Step 6: `SharedKeys` `addButton` + render (`:177-329`).** Replace from `  const addButton = (` to the end of `SharedKeys` with:

```tsx
  const addButton = (
    <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={adding}>
      <Plus strokeWidth={1.5} />
      {t('llmConnections', 'sharedAddButton')}
    </Button>
  );
  return (
    <>
      {connections.isPending && (
        <>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </>
      )}
      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'sharedLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>
            {t('llmConnections', 'retry')}
          </Button>
        </p>
      )}
      {connections.data && connections.data.length === 0 && !adding && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span>{t('llmConnections', 'sharedEmpty')}</span>
          {addButton}
        </div>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul role="list" aria-label={t('llmConnections', 'sharedTitle')}>
          {connections.data.map((row) => {
            const spec = providers.find((p) => p.id === row.provider);
            return (
              <li key={row.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted/60">
                <span className="truncate font-medium">{row.label}</span>
                <span className="text-muted-foreground">{spec?.label ?? row.provider}</span>
                <Badge variant="outline">{t('llmConnections', SERVES_COPY[servesOf(spec)])}</Badge>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <IconButton
                      label={t('llmConnections', 'sharedRemoveAria')}
                      className="ml-auto"
                      icon={<Trash2 strokeWidth={1.5} />}
                    />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('llmConnections', 'sharedRemoveTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('llmConnections', 'sharedRemoveDescription')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('llmConnections', 'cancelButton')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          remove.mutate(row.id, {
                            onSuccess: () => toast.success(t('llmConnections', 'sharedRemoveSuccess')),
                            onError: () => toast.error(t('llmConnections', 'sharedRemoveError')),
                          })
                        }
                      >
                        {t('llmConnections', 'removeConfirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SettingsRow label={t('llmConnections', 'providerLabel')} htmlFor="shared-provider">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="shared-provider" variant="quiet">
                <SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}{' '}
                    <span className="text-[12px] text-muted-foreground">
                      ({t('llmConnections', SERVES_COPY[servesOf(p)])})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t('llmConnections', 'labelLabel')} htmlFor="shared-label">
            <Input
              id="shared-label"
              variant="quiet"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('llmConnections', 'labelPlaceholder')}
              maxLength={80}
            />
          </SettingsRow>
          <SettingsRow label={t('llmConnections', 'keyLabel')} htmlFor="shared-key">
            <Input
              id="shared-key"
              variant="quiet"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('llmConnections', 'keyPlaceholder')}
            />
          </SettingsRow>
          <SettingsActions>
            <Button type="submit" size="sm" disabled={create.isPending || label === '' || apiKey === ''}>
              {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('llmConnections', 'cancelButton')}
            </Button>
          </SettingsActions>
        </form>
      ) : (connections.data?.length ?? 0) > 0 || connections.isError ? (
        addButton
      ) : null}
    </>
  );
}
```

- [ ] **Step 7: `AiEngineSection` render (`:337-362`).** Replace from `  return (` to the end of the file with:

```tsx
  return (
    <SettingsPage>
      <SettingsGroup>
        {engine.isPending && (
          <>
            <Skeleton className="h-8 w-full" data-testid="ai-engine-skeleton" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        )}
        {engine.isError && (
          <p className="flex items-center gap-2 text-[13px] text-destructive">
            {t('llmConnections', 'cardLoadError')}
            <Button size="sm" variant="ghost" onClick={() => void engine.refetch()}>
              {t('llmConnections', 'retry')}
            </Button>
          </p>
        )}
        {engine.data && (
          <EngineCard projectId={projectId} read={engine.data} isManager={isManager} providers={providerRows} />
        )}
      </SettingsGroup>
      {isManager && (
        <SettingsGroup title={t('llmConnections', 'sharedTitle')} hint={t('llmConnections', 'sharedDescription')}>
          <SharedKeys projectId={projectId} providers={providerRows} />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
```

- [ ] **Step 8: Run green.**

Run: `npm run test:run -- frontend/test/components/AiEngineSection.test.tsx`
Expected: PASS, 15 tests.

- [ ] **Step 9: Grep the copy key before deleting it.**

Run: `bash -c 'grep -rnw "cardTitle" frontend/; grep -rn "cardDescription\|sharedDescription" frontend/'`
Expected: `cardTitle` has one hit, `frontend/lib/copy/llmConnections.ts:71`. `cardDescription` and `sharedDescription` each have their definition plus the new `hint=` use in `AiEngineSection.tsx`; they are kept.

- [ ] **Step 10: Delete the key.** In `frontend/lib/copy/llmConnections.ts` delete `    cardTitle: 'AI engine',`.

- [ ] **Step 11: Run the gates.** Run each and read the tail:

```bash
npm run test:run
npm run typecheck
npm run lint
npx knip --no-tag-hints
npx knip --production --no-tag-hints
bash scripts/fitness/run_all.sh
```

Expected: every command exits 0, zero knip findings, `run_all.sh` all OK. `AiEngineSection.tsx` was never in `check_button_scale.baseline` and still has no `<Button>` height override.

- [ ] **Step 12: Commit.** Run each as its own shell call:

```bash
git add frontend/components/project/settings/AiEngineSection.tsx frontend/lib/copy/llmConnections.ts frontend/test/components/AiEngineSection.test.tsx
```

```bash
git commit -m "refactor(settings): AI engine rows and shared keys as a flush list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Team

**Files:**
- Modify: `frontend/components/project/settings/TeamMembersSection.tsx`. The regions are: imports `:5-27` and the render `:155-354`. The handlers `:31-153` (load, invite, edit, save role, remove with `confirm()`, `managerCount`) are unchanged.
- Modify: `frontend/lib/copy/project.ts:94-95,97,103` (key deletions)
- Modify: `scripts/fitness/check_button_scale.baseline:16` (delete the `TeamMembersSection.tsx:6` entry by hand)
- Test (modify): `frontend/components/project/settings/TeamMembersSection.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `SettingsPage`, `SettingsGroup({title, hint})`, `SettingsRow` (render-prop) (Task 2b); `variant="quiet"` on `Input`/`SelectTrigger` (Task 1); `SettingsGroup` root carries `border-t` (Task 2b); the reveal classes from Global Constraints.
- Produces: nothing new. `TeamMembersSection({projectId})` is unchanged.

- [ ] **Step 1: Write the failing tests.** In `frontend/components/project/settings/TeamMembersSection.test.tsx` change the testing-library import to `import {render, screen, waitFor, within} from '@testing-library/react';`, add `import {MEMBER_ROLES} from '@/types/project';` after the `ProjectMemberRow` import, and append before the trailing `// NOTE:` comment:

```tsx
describe('TeamMembersSection — flat layout (spec 2026-09-13 §4.3, §10)', () => {
  const REVEAL = ['opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100', '[@media(hover:none)]:opacity-100'];
  const twoManagers = () =>
    getMembersMock.mockResolvedValue({
      ok: true,
      data: [
        member({id: 'm1', user_id: 'u1'}),
        member({id: 'm2', user_id: 'u2', user_full_name: 'Bob', user_email: 'bob@example.com'}),
      ],
    });

  it('drops the selected-role description under the invite; the Roles group lists it once', async () => {
    getMembersMock.mockResolvedValue({ok: true, data: [member({})]});
    renderSection();
    await screen.findByText('Alice');
    const lines = screen.getAllByText(MEMBER_ROLES.reviewer.description);
    expect(lines).toHaveLength(1);
    const group = lines[0].closest('.border-t') as HTMLElement;
    expect(within(group).getByRole('heading', {name: t('project', 'teamCardRolesTitle')})).toBeInTheDocument();
  });

  it('the invite email is labelled by the row, described by its hint, with no absolute Mail icon', async () => {
    getMembersMock.mockResolvedValue({ok: true, data: [member({})]});
    renderSection();
    await screen.findByText('Alice');
    const email = screen.getByRole('textbox', {name: t('project', 'teamCardAddTitle')});
    expect(email).toHaveAccessibleDescription(t('project', 'teamUserMustBeRegistered'));
    expect(email).not.toHaveClass('pl-8');
    expect(email.parentElement?.querySelector(':scope > svg')).toBeNull();
    expect(screen.getByRole('button', {name: t('project', 'teamAddButton')})).not.toHaveClass('h-9');
  });

  it('an empty member list is one muted line, not a callout', async () => {
    getMembersMock.mockResolvedValue({ok: true, data: []});
    renderSection();
    const line = await screen.findByText(t('project', 'teamNoMembersYet'));
    expect(line).toHaveClass('text-[13px]', 'text-muted-foreground');
    expect(screen.queryByRole('alert')).toBeNull();
    const group = line.closest('.border-t') as HTMLElement;
    expect(within(group).getByRole('heading', {name: t('project', 'teamCardMembersTitle')})).toBeInTheDocument();
  });

  it('row actions carry the reveal classes on a group row', async () => {
    twoManagers();
    renderSection();
    await screen.findByText('Alice');
    const edit = screen.getAllByRole('button', {name: t('project', 'teamAriaEditRole')})[0];
    const strip = edit.closest('[class~="opacity-0"]') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip).toHaveClass(...REVEAL);
    expect(strip.closest('li')).toHaveClass('group');
  });

  it('a row in the role-edit state shows its controls without hover', async () => {
    twoManagers();
    renderSection();
    await screen.findByText('Alice');
    await userEvent.click(screen.getAllByRole('button', {name: t('project', 'teamAriaEditRole')})[0]);
    const save = await screen.findByRole('button', {name: t('project', 'teamAriaSaveChange')});
    expect(save.closest('[class~="opacity-0"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run red.**

Run: `npm run test:run -- frontend/components/project/settings/TeamMembersSection.test.tsx`
Expected: FAIL on the new describe:
- the reviewer description appears twice;
- no textbox is named "Add member";
- the empty state is a `role="alert"` callout;
- there is no `opacity-0` strip.

The four pre-existing tests pass.

- [ ] **Step 3: Imports (`:5-27`).** Replace the import block with:

```tsx
import {Fragment, useEffect, useState} from 'react';
import {
  findUserIdByEmail,
  getProjectMembers,
  insertProjectMember,
  removeProjectMember,
  updateMemberRole,
  type ProjectMemberRow,
} from '@/services/projectSettingsService';
import {PgError} from '@/lib/error-utils';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Check, Edit2, Trash2, X} from 'lucide-react';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import {MEMBER_ROLES, type MemberRole} from '@/types/project';
import {t} from '@/lib/copy';
```

This drops `Separator`, `Alert`/`AlertDescription`, `Mail`, `Shield`, `UserPlus`, `UsersIcon`, `SettingsSection` and `SettingsCard`. `ui/alert` keeps its consumers until Tasks 8a, 8b and 11b.

- [ ] **Step 4: The render (`:155-354`).** Replace from `  return (` to the end of the file with:

```tsx
  const revealClasses =
    'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

  return (
    <SettingsPage>
      <SettingsGroup>
        <form onSubmit={handleInviteMember}>
          <SettingsRow
            label={t('project', 'teamCardAddTitle')}
            htmlFor="team-invite-email"
            hint={t('project', 'teamUserMustBeRegistered')}
          >
            {({describedBy}) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="team-invite-email"
                  type="email"
                  variant="quiet"
                  placeholder={t('project', 'teamEmailPlaceholder')}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  aria-describedby={describedBy}
                  className="min-w-[200px] flex-1"
                  required
                />
                <Select value={selectedRole} onValueChange={(v: MemberRole) => setSelectedRole(v)}>
                  <SelectTrigger variant="quiet" className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {MEMBER_ROLES[role].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={loading} size="sm">
                  {loading ? t('project', 'teamAdding') : t('project', 'teamAddButton')}
                </Button>
              </div>
            )}
          </SettingsRow>
        </form>
      </SettingsGroup>

      <SettingsGroup title={t('project', 'teamCardMembersTitle')}>
        {members.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('project', 'teamNoMembersYet')}</p>
        ) : (
          <ul className="space-y-0.5">
            {members.map((member) => {
              const isSoleManager = member.role === 'manager' && managerCount === 1;
              return (
                <li
                  key={member.id}
                  className="group flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                      {member.user_avatar_url ? (
                        <img
                          src={member.user_avatar_url}
                          alt={member.user_full_name ?? t('project', 'teamAvatarFallback')}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[12px] font-medium text-primary">
                          {member.user_full_name?.charAt(0)?.toUpperCase() ??
                            member.user_email?.charAt(0)?.toUpperCase() ??
                            '?'}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium leading-tight">
                        {member.user_full_name ?? t('project', 'teamUserFallback')}
                      </p>
                      <p className="truncate text-[12px] text-muted-foreground">{member.user_email}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {editingMemberId === member.id ? (
                      <>
                        <Select value={editingRole ?? member.role} onValueChange={(v: MemberRole) => setEditingRole(v)}>
                          {isSoleManager ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SelectTrigger variant="quiet" className="w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                              </TooltipTrigger>
                              <TooltipContent>{t('project', 'teamLastManagerGuard')}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <SelectTrigger variant="quiet" className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                          )}
                          <SelectContent>
                            {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
                              <SelectItem key={role} value={role} disabled={isSoleManager && role !== 'manager'}>
                                {MEMBER_ROLES[role].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <IconButton
                          label={t('project', 'teamAriaSaveChange')}
                          className="text-success"
                          onClick={() => handleSaveRole(member.id)}
                          icon={<Check strokeWidth={1.5} />}
                        />
                        <IconButton
                          label={t('project', 'teamAriaCancel')}
                          onClick={handleCancelEditRole}
                          icon={<X strokeWidth={1.5} />}
                        />
                      </>
                    ) : (
                      <>
                        <Badge variant={MEMBER_ROLES[member.role].variant} className="text-[11px]">
                          {MEMBER_ROLES[member.role].label}
                        </Badge>
                        <div className={revealClasses}>
                          <IconButton
                            label={t('project', 'teamAriaEditRole')}
                            onClick={() => handleStartEditRole(member.id, member.role)}
                            icon={<Edit2 strokeWidth={1.5} />}
                          />
                          {isSoleManager ? (
                            <IconButton
                              label={t('project', 'teamAriaRemoveMember')}
                              disabled
                              tooltip={t('project', 'teamLastManagerGuard')}
                              icon={<Trash2 strokeWidth={1.5} />}
                            />
                          ) : (
                            <IconButton
                              label={t('project', 'teamAriaRemoveMember')}
                              onClick={() => handleRemoveMember(member.id)}
                              icon={<Trash2 strokeWidth={1.5} />}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('project', 'teamCardRolesTitle')} hint={t('project', 'teamCardRolesDesc')}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-2 text-[13px]">
          {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((role) => (
            <Fragment key={role}>
              <dt>
                <Badge variant={MEMBER_ROLES[role].variant} className="text-[11px]">
                  {MEMBER_ROLES[role].label}
                </Badge>
              </dt>
              <dd className="text-muted-foreground">{MEMBER_ROLES[role].description}</dd>
            </Fragment>
          ))}
        </dl>
      </SettingsGroup>
    </SettingsPage>
  );
}
```

- [ ] **Step 5: Run green.**

Run: `npm run test:run -- frontend/components/project/settings/TeamMembersSection.test.tsx`
Expected: PASS, 9 tests. The four min-one-manager tests are unchanged: sole-manager disabled Remove, two-manager enabled, and the PM001 toasts on remove and on role save.

- [ ] **Step 6: Grep the copy keys before deleting them.**

Run: `bash -c 'for k in teamSectionTitle teamSectionDesc teamCardAddDesc teamCardMembersDesc; do echo "== $k"; grep -rnw "$k" frontend/; done'`
Expected: each key has exactly one hit, its definition in `frontend/lib/copy/project.ts`. `teamCardAddTitle`, `teamUserMustBeRegistered`, `teamCardMembersTitle`, `teamNoMembersYet`, `teamCardRolesTitle` and `teamCardRolesDesc` are still used and are kept.

- [ ] **Step 7: Delete the keys.** In `frontend/lib/copy/project.ts` delete:

```ts
    teamSectionTitle: 'Team management',
    teamSectionDesc: 'Add collaborators and manage project access permissions.',
    teamCardAddDesc: 'Invite an existing user to join this project.',
    teamCardMembersDesc: 'All members with access to this project.',
```

- [ ] **Step 8: Tighten the button-scale baseline by hand.** Confirm the new count:

Run: `python3 -c "import sys; sys.path.insert(0,'scripts/fitness'); import check_button_scale as c; print(c.scan_file(open('frontend/components/project/settings/TeamMembersSection.tsx').read()))"`
Expected: `0`. Today's count is `1`, the `h-9` Add button; the baseline allows `6`. With the count at 0 the file is no longer an offender, so delete the whole line `frontend/components/project/settings/TeamMembersSection.tsx:6` from `scripts/fitness/check_button_scale.baseline`. Change no other line and do not run `--update-baseline`. If the printed count is not 0, set the entry to that number instead.

- [ ] **Step 9: Run the gates.** Run each and read the tail:

```bash
npm run test:run
npm run typecheck
npm run lint
npx knip --no-tag-hints
npx knip --production --no-tag-hints
bash scripts/fitness/run_all.sh
```

Expected: every command exits 0, zero knip findings, and `run_all.sh` all OK, with button-scale showing no growth and no new offender.

- [ ] **Step 10: Commit.** Run each as its own shell call:

```bash
git add frontend/components/project/settings/TeamMembersSection.tsx frontend/components/project/settings/TeamMembersSection.test.tsx frontend/lib/copy/project.ts scripts/fitness/check_button_scale.baseline
```

```bash
git commit -m "refactor(settings): team as invite row, flush member rows and a compact roles list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8a: Review consensus — visibility hook + `ConsensusConfigForm` rows

**Files:**
- Create: `frontend/hooks/hitl/useManagerReviewVisibility.ts`
- Create: `frontend/hooks/hitl/useManagerReviewVisibility.test.tsx`
- Modify: `frontend/components/runs/ManagerReviewVisibilityToggle.tsx:12-57` (state block → hook call; markup `:59-77` unchanged)
- Modify: `frontend/components/project/settings/ConsensusConfigForm.tsx` (whole render → fragment of `SettingsRow`s)
- Create: `frontend/test/components/ConsensusConfigForm.rows.test.tsx`
- Unchanged, must stay green: `frontend/test/components/ManagerReviewVisibilityToggle.test.tsx`, `frontend/test/ConsensusConfigForm.test.tsx`

**Interfaces:**
- Consumes (header): `SettingsRow` (render-prop `{describedBy}`, `required`, `error`) from `@/components/settings` (Task 2b); `SelectTrigger variant="quiet"` (Task 1).
- Produces for Tasks 8b and 9:
  - `export function useManagerReviewVisibility(projectId: string, kind: ReviewKind, currentValue: boolean): {checked: boolean; saving: boolean; onToggle: (next: boolean) => void}` in `frontend/hooks/hitl/useManagerReviewVisibility.ts`.
  - `ConsensusConfigForm` keeps its props (`value`, `onChange`, `members`, `membersLoading?`, `disabled?`) and now returns a **fragment** of `SettingsRow`s (Rule row; Arbitrator row when the rule is `arbitrator`). Control ids come from `useId()`, so several forms can mount at once. The caller must render it inside a `SettingsGroup` body. Task 8b does that for the project default and Task 9 for each template override. Until then its two callers (`ReviewConsensusSection`, `TemplateConsensusOverride`) show the rows stacked inside their old cards, with no behaviour change.

**Copy.** The fragment uses exactly the keys the old form used (`ruleLabel`, `ruleHint`, the three rule options, `arbitratorLabel`, `arbitratorHint`, `arbitratorPlaceholder`, `arbitratorRequired`, `arbitratorNoEligibleMembers`, `project.teamUserFallback`), so this task adds and deletes no key. It drops `SettingsField` and `ui/alert` from `ConsensusConfigForm.tsx`; both keep other consumers until Tasks 11b and 14.

- [ ] **Step 1: Write the failing hook test**

`frontend/hooks/hitl/useManagerReviewVisibility.test.tsx`:

```tsx
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/hitlConfigService', () => ({setManagerReviewVisibility: vi.fn()}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {toast} from 'sonner';
import {setManagerReviewVisibility} from '@/services/hitlConfigService';
import {useManagerReviewVisibility} from '@/hooks/hitl/useManagerReviewVisibility';

const setMock = vi.mocked(setManagerReviewVisibility);

beforeEach(() => vi.clearAllMocks());

describe('useManagerReviewVisibility', () => {
  it('flips optimistically and saves only its own kind', async () => {
    let resolve!: () => void;
    setMock.mockReturnValue(new Promise((r) => { resolve = () => r({extraction: true, quality_assessment: false} as never); }));
    const {result} = renderHook(() => useManagerReviewVisibility('p1', 'extraction', false));

    act(() => result.current.onToggle(true));
    expect(result.current.checked).toBe(true);
    expect(result.current.saving).toBe(true);
    expect(setMock).toHaveBeenCalledWith('p1', 'extraction', true);

    await act(async () => resolve());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.checked).toBe(true);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('reverts and reports the error when the save fails', async () => {
    setMock.mockRejectedValue(new Error('boom'));
    const {result} = renderHook(() => useManagerReviewVisibility('p1', 'quality_assessment', false));

    act(() => result.current.onToggle(true));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.checked).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('re-syncs when the persisted value arrives after mount', () => {
    const {result, rerender} = renderHook(
      ({value}) => useManagerReviewVisibility('p1', 'extraction', value),
      {initialProps: {value: false}},
    );
    expect(result.current.checked).toBe(false);
    rerender({value: true});
    expect(result.current.checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npm run test:run -- frontend/hooks/hitl/useManagerReviewVisibility.test.tsx`
Expected: FAIL. The import `@/hooks/hitl/useManagerReviewVisibility` does not resolve.

- [ ] **Step 3: Create the hook (moved verbatim from the toggle `:35-57`)**

`frontend/hooks/hitl/useManagerReviewVisibility.ts`:

```ts
/**
 * State for one kind's manager-review-visibility switch: optimistic toggle,
 * revert on failure, toasts, and a render-phase re-sync when the persisted
 * value arrives after mount. Shared by `ManagerReviewVisibilityToggle` (QA
 * Configuration) and the Review consensus settings row. The write stays the
 * typed `setManagerReviewVisibility` endpoint, which sets only its own kind.
 *
 * A verbatim, behaviour-preserving extraction of the toggle's former state
 * block (spec 2026-09-13 §10): `ManagerReviewVisibilityToggle.test` passes
 * unchanged. Recorded debt, deliberately not paid here: this is plain
 * useState, not a TanStack `useMutation`, and `setManagerReviewVisibility`
 * rejects instead of returning `ErrorResult<T>`. Converting both is a follow-up.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import type {ReviewKind} from '@/lib/comparison/permissions';
import {setManagerReviewVisibility} from '@/services/hitlConfigService';

export function useManagerReviewVisibility(projectId: string, kind: ReviewKind, currentValue: boolean) {
  const [checked, setChecked] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const [prevCurrent, setPrevCurrent] = useState(currentValue);
  if (prevCurrent !== currentValue) {
    setPrevCurrent(currentValue);
    setChecked(currentValue);
  }

  const onToggle = (next: boolean) => {
    setChecked(next); // optimistic
    setSaving(true);
    setManagerReviewVisibility(projectId, kind, next)
      .then(() => toast.success(t('consensus', 'managerVisibilitySaved')))
      .catch((e: unknown) => {
        setChecked(!next); // revert on failure
        toast.error(e instanceof Error ? e.message : t('consensus', 'managerVisibilityError'));
      })
      .finally(() => setSaving(false));
  };

  return {checked, saving, onToggle};
}
```

In `ManagerReviewVisibilityToggle.tsx`:
- Replace the imports at `:12-18` with the lines below. The `Switch` import stays.

  ```tsx
  import { Switch } from '@/components/ui/switch';
  import { useManagerReviewVisibility } from '@/hooks/hitl/useManagerReviewVisibility';
  import { t } from '@/lib/copy';
  import type { ReviewKind } from '@/lib/comparison/permissions';
  ```

- Replace the body lines `:35-57` (from `const [checked, setChecked]` through the closing `};` of `onToggle`) with this line:

  ```tsx
  const { checked, saving, onToggle } = useManagerReviewVisibility(projectId, kind, currentValue);
  ```

The JSX from `const id = ...` to the end stays byte-for-byte.

- [ ] **Step 4: Run hook + toggle tests green**

Run: `npm run test:run -- frontend/hooks/hitl/useManagerReviewVisibility.test.tsx frontend/test/components/ManagerReviewVisibilityToggle.test.tsx frontend/test/components/QualityAssessmentConfiguration.test.tsx`
Expected: PASS (3 + 2 + existing). The toggle test file has no edits.

- [ ] **Step 5: Write the failing rows test**

`frontend/test/components/ConsensusConfigForm.rows.test.tsx`:

```tsx
/** ConsensusConfigForm as a fragment of SettingsRows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {ConsensusConfigForm} from '@/components/project/settings/ConsensusConfigForm';
import type {ProjectMemberSummary} from '@/hooks/hitl/useProjectMembers';
import {consensus} from '@/lib/copy/consensus';
import type {HitlConfigPayload} from '@/services/hitlConfigService';

const MANAGER: ProjectMemberSummary = {
  user_id: 'm1', role: 'manager', user_email: 'm@x.org', user_full_name: 'Maria', user_avatar_url: null,
};
const ARBITRATOR_RULE: HitlConfigPayload = {reviewer_count: 1, consensus_rule: 'arbitrator', arbitrator_id: null};

/** The text of every element the control's aria-describedby points at. */
const describedTexts = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);

describe('ConsensusConfigForm — settings rows', () => {
  it('returns rows with no wrapper element', () => {
    const {container} = render(
      <ConsensusConfigForm value={{...ARBITRATOR_RULE, consensus_rule: 'unanimous'}} onChange={vi.fn()} members={[MANAGER]} />,
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass('grid');
  });

  it('describes the rule trigger by its hint and a missing arbitrator by the row error', () => {
    render(<ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />);
    const [rule, arbitrator] = screen.getAllByRole('combobox');
    expect(rule).toHaveClass('border-transparent');
    expect(describedTexts(rule)).toEqual([consensus.ruleHint]);
    expect(describedTexts(arbitrator)).toEqual([consensus.arbitratorHint, consensus.arbitratorRequired]);
    expect(screen.getByText(consensus.arbitratorRequired)).toHaveClass('text-destructive');
  });

  it('keeps control ids unique, each named by its own label, when two forms mount at once', () => {
    render(
      <>
        <ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />
        <ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />
      </>,
    );
    const controls = screen.getAllByRole('combobox');
    expect(controls).toHaveLength(4);
    expect(new Set(controls.map((el) => el.id)).size).toBe(4);
    const labels = Array.from(document.querySelectorAll('label'));
    controls.forEach((el) => expect(labels.filter((label) => label.htmlFor === el.id)).toHaveLength(1));
  });

  it('says there is no eligible arbitrator in a muted line, not a callout', () => {
    render(<ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[]} />);
    expect(screen.getByText(consensus.arbitratorNoEligibleMembers)).toHaveClass('text-[13px]', 'text-muted-foreground');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(consensus.arbitratorRequired)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it red**

Run: `npm run test:run -- frontend/test/components/ConsensusConfigForm.rows.test.tsx`
Expected: FAIL, all four cases. The root is a `div.space-y-4` wrapper, not a row. The arbitrator error `<p>` has no id, so no `aria-describedby` reaches it. Both forms reuse the ids `consensus-rule`/`arbitrator-id`. The no-eligible message is an `Alert` (`role="alert"`).

- [ ] **Step 7: `ConsensusConfigForm` → fragment of rows**

Replace the file from line 6 to the end with:

```tsx
import { useId } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsRow } from '@/components/settings';
import { t } from '@/lib/copy';
import type {
  ConsensusRule,
  HitlConfigPayload,
} from '@/services/hitlConfigService';
import type { ProjectMemberSummary } from '@/hooks/hitl/useProjectMembers';

export interface ConsensusConfigFormProps {
  value: HitlConfigPayload;
  onChange: (next: HitlConfigPayload) => void;
  members: ProjectMemberSummary[];
  membersLoading?: boolean;
  disabled?: boolean;
}

/** Returns rows, not a wrapper: render it directly inside a SettingsGroup body. */
export function ConsensusConfigForm({
  value,
  onChange,
  members,
  membersLoading = false,
  disabled = false,
}: ConsensusConfigFormProps) {
  // Several forms mount at once (project default + expanded overrides).
  const baseId = useId();
  const ruleId = `${baseId}-rule`;
  const arbitratorId = `${baseId}-arbitrator`;
  const arbitratorEligible = members.filter((m) => m.role === 'consensus' || m.role === 'manager');

  const handleRuleChange = (rule: ConsensusRule) => {
    if (rule === 'arbitrator') {
      onChange({ ...value, consensus_rule: rule });
    } else {
      // Drop arbitrator when the rule no longer requires one.
      onChange({ ...value, consensus_rule: rule, arbitrator_id: null });
    }
  };

  const handleArbitratorChange = (id: string) => {
    onChange({ ...value, arbitrator_id: id });
  };

  const showArbitratorPicker = value.consensus_rule === 'arbitrator';
  const noEligible = arbitratorEligible.length === 0;
  const arbitratorMissing =
    showArbitratorPicker &&
    (!value.arbitrator_id ||
      !arbitratorEligible.some((m) => m.user_id === value.arbitrator_id));

  return (
    <>
      <SettingsRow label={t('consensus', 'ruleLabel')} htmlFor={ruleId} hint={t('consensus', 'ruleHint')}>
        {({ describedBy }) => (
          <Select
            value={value.consensus_rule}
            onValueChange={(v) => handleRuleChange(v as ConsensusRule)}
            disabled={disabled}
          >
            <SelectTrigger id={ruleId} variant="quiet" aria-describedby={describedBy} className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unanimous">{t('consensus', 'ruleUnanimous')}</SelectItem>
              <SelectItem value="majority">{t('consensus', 'ruleMajority')}</SelectItem>
              <SelectItem value="arbitrator">{t('consensus', 'ruleArbitrator')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </SettingsRow>

      {showArbitratorPicker && (
        <SettingsRow
          label={t('consensus', 'arbitratorLabel')}
          htmlFor={noEligible ? undefined : arbitratorId}
          hint={t('consensus', 'arbitratorHint')}
          required
          error={arbitratorMissing && !noEligible ? t('consensus', 'arbitratorRequired') : undefined}
        >
          {({ describedBy }) =>
            noEligible ? (
              <p className="px-2 text-[13px] text-muted-foreground">
                {t('consensus', 'arbitratorNoEligibleMembers')}
              </p>
            ) : (
              <Select
                value={value.arbitrator_id ?? ''}
                onValueChange={handleArbitratorChange}
                disabled={disabled || membersLoading}
              >
                <SelectTrigger id={arbitratorId} variant="quiet" aria-describedby={describedBy} className="w-full max-w-md">
                  <SelectValue placeholder={t('consensus', 'arbitratorPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {arbitratorEligible.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.user_full_name ?? member.user_email ?? t('project', 'teamUserFallback')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        </SettingsRow>
      )}
    </>
  );
}
```

Update the header docstring (lines 1-4) to add: `Renders a fragment of SettingsRows; the caller owns the SettingsGroup.`

- [ ] **Step 8: Run the touched tests green**

Run: `npm run test:run -- frontend/test/components/ConsensusConfigForm.rows.test.tsx frontend/test/ConsensusConfigForm.test.tsx frontend/test/components/ManagerReviewVisibilityToggle.test.tsx frontend/hooks/hitl/useManagerReviewVisibility.test.tsx frontend/test/components/ProjectSettings.sections.test.tsx`
Expected: all PASS. `ConsensusConfigForm.test.tsx` is unedited. Its queries are `getByText(/consensus rule/i)`, `queryByText(/^Arbitrator$/)`, `getAllByRole('combobox')[0]` and `getByText(/No eligible arbitrator/i)`, and the fragment keeps all four. If one fails on duplicate text (a hint rendered twice), do not edit that file; report the query and the duplicate to the orchestrator.

- [ ] **Step 9: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green, and knip reports zero. No copy key changes. No button-scale entry exists for these files.

- [ ] **Step 10: Commit**

```bash
git add frontend/hooks/hitl/useManagerReviewVisibility.ts frontend/hooks/hitl/useManagerReviewVisibility.test.tsx frontend/components/runs/ManagerReviewVisibilityToggle.tsx frontend/components/project/settings/ConsensusConfigForm.tsx frontend/test/components/ConsensusConfigForm.rows.test.tsx
```
```bash
git commit -m "refactor(settings): consensus form as settings rows; shared manager-visibility hook

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8b: Review consensus — intro + project default + visibility row

**Files:**
- Modify: `frontend/components/project/settings/ReviewConsensusSection.tsx:10-34` (imports), `:135-256` (render)
- Modify: `frontend/lib/copy/consensus.ts` (delete 7 keys: 5 this render drops plus the 2 dead `templatesOverrideAction`/`templatesEditAction`; add 2; correct `tabConsensusDesc`)
- Modify: `scripts/fitness/check_copy_keys.baseline:61-62` (remove the two dead consensus entries)
- Create: `frontend/test/components/ReviewConsensusSection.test.tsx`
- Unchanged, must stay green: `frontend/test/components/ManagerReviewVisibilityToggle.test.tsx`, `frontend/test/ConsensusConfigForm.test.tsx`, `frontend/test/components/ConsensusConfigForm.rows.test.tsx`

**Interfaces:**
- Consumes (Task 8a): `useManagerReviewVisibility(projectId, kind, currentValue)` → `{checked, saving, onToggle}`; `ConsensusConfigForm` as a fragment of `SettingsRow`s, rendered directly in a `SettingsGroup` body.
- Consumes (header): `SettingsPage` (`intro`), `SettingsGroup` (`title`, `hint`), `SettingsRow` (render-prop `{describedBy}`), `SettingsActions` from `@/components/settings` (Task 2b); `SelectTrigger variant="quiet"` (Task 1).
- Produces for Task 9: in `ReviewConsensusSection`, the *Per-template overrides* group is already a `SettingsGroup title={templatesTitle} hint={templatesDesc}`. Its body still holds the old loading/empty/list markup (anchor: the `{templatesLoading ? (` block). Task 9 replaces that body. `ManagerReviewVisibilityToggle` loses this caller and keeps `QualityAssessmentConfiguration.tsx`.

- [ ] **Step 1: Write the failing section test**

`frontend/test/components/ReviewConsensusSection.test.tsx`:

```tsx
/** Review consensus as a flat settings page (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: vi.fn()}));
vi.mock('@/hooks/useCurrentUser', () => ({useCurrentUser: () => ({userId: 'u1'})}));
vi.mock('@/hooks/shared/useComparisonPermissions', () => ({useComparisonPermissions: vi.fn()}));
vi.mock('@/hooks/hitl/useHitlConfig', () => ({
  useProjectHitlConfig: vi.fn(),
  useUpsertProjectHitlConfig: vi.fn(),
  useClearProjectHitlConfig: vi.fn(),
  useTemplateHitlConfig: vi.fn(),
  useUpsertTemplateHitlConfig: vi.fn(),
  useClearTemplateHitlConfig: vi.fn(),
}));
vi.mock('@/hooks/hitl/useProjectMembers', () => ({useProjectMembers: vi.fn()}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({useProjectTemplates: vi.fn()}));
vi.mock('@/services/hitlConfigService', () => ({setManagerReviewVisibility: vi.fn()}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import * as hitl from '@/hooks/hitl/useHitlConfig';
import {useProjectMembers} from '@/hooks/hitl/useProjectMembers';
import {useProjectTemplates} from '@/hooks/hitl/useProjectTemplates';
import {ReviewConsensusSection} from '@/components/project/settings/ReviewConsensusSection';
import {consensus} from '@/lib/copy/consensus';

const MANAGER = {user_id: 'm1', role: 'manager', user_email: 'm@x.org', user_full_name: 'Maria', user_avatar_url: null};

function config(over: Record<string, unknown> = {}) {
  return {scope_kind: 'system_default', scope_id: null, reviewer_count: 1, consensus_rule: 'unanimous', arbitrator_id: null, inherited: true, ...over};
}

function mockConfig(state: {data?: unknown; isLoading?: boolean; isError?: boolean}) {
  vi.mocked(hitl.useProjectHitlConfig).mockReturnValue({isLoading: false, isError: false, ...state} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProjectMemberRole).mockReturnValue({isManager: true} as never);
  vi.mocked(useComparisonPermissions).mockReturnValue({loading: false, canSeeOthers: false, canManageBlindMode: true} as never);
  vi.mocked(hitl.useUpsertProjectHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(hitl.useClearProjectHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(useProjectMembers).mockReturnValue({data: [MANAGER], isLoading: false} as never);
  vi.mocked(useProjectTemplates).mockReturnValue({data: [], isLoading: false} as never);
  mockConfig({data: config()});
});

describe('ReviewConsensusSection', () => {
  it('states the new-runs-only rule as one intro paragraph, not a callout', () => {
    render(<ReviewConsensusSection projectId="p1" />);
    const title = screen.getByText(consensus.runsBannerTitle);
    expect(title).toHaveClass('text-foreground');
    expect(title.closest('p')).toHaveTextContent(consensus.runsBannerBody);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the Current row only for a loaded, non-project scope', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.currentDefaultLabel)).toBeInTheDocument();
    expect(screen.getByText(consensus.currentSystemDefault)).toHaveClass('text-muted-foreground');
    unmount();

    for (const state of [{data: config({scope_kind: 'project'})}, {isLoading: true}, {isError: true}]) {
      mockConfig(state);
      const view = render(<ReviewConsensusSection projectId="p1" />);
      expect(screen.queryByText(consensus.currentSystemDefault)).toBeNull();
      view.unmount();
    }
  });

  it('renders the project-default skeleton as h-8 rows inside the group', () => {
    mockConfig({isLoading: true});
    render(<ReviewConsensusSection projectId="p1" />);
    const group = screen.getByRole('heading', {level: 2, name: consensus.projectDefaultTitle}).parentElement!.parentElement!;
    const skeletons = group.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    skeletons.forEach((el) => expect(el).toHaveClass('h-8'));
  });

  it('reports a missing arbitrator as the row error the picker points at', () => {
    mockConfig({data: config({scope_kind: 'project', consensus_rule: 'arbitrator'})});
    render(<ReviewConsensusSection projectId="p1" />);
    const errors = screen.getAllByText(consensus.arbitratorRequired);
    expect(errors.some((el) => el.classList.contains('text-destructive'))).toBe(true);
    const picker = screen.getByLabelText(new RegExp(`^${consensus.arbitratorLabel}`));
    const ids = (picker.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(consensus.arbitratorRequired);
  });

  it('renders the visibility switch as a hinted row, and nothing while permissions load', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    const sw = screen.getByRole('switch', {name: consensus.managerVisibilityLabel});
    const ids = (sw.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(consensus.managerVisibilityHint);
    unmount();

    vi.mocked(useComparisonPermissions).mockReturnValue({loading: true, canSeeOthers: false, canManageBlindMode: false} as never);
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a non-manager gets a disabled Save, no Reset, and the visibility row disabled', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({isManager: false} as never);
    vi.mocked(useComparisonPermissions).mockReturnValue({loading: false, canSeeOthers: false, canManageBlindMode: false} as never);
    // Customized, so a manager WOULD see Reset: its absence is the isManager gate.
    mockConfig({data: config({scope_kind: 'project'})});
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByRole('button', {name: consensus.saveProjectDefault})).toBeDisabled();
    expect(screen.queryByRole('button', {name: consensus.resetProjectDefault})).toBeNull();
    // Today's rules: rendered once permissions load, disabled unless canManageBlindMode.
    const sw = screen.getByRole('switch', {name: consensus.managerVisibilityLabel});
    expect(sw).toBeDisabled();
    expect(sw.closest('.grid')).toHaveClass('@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
  });

  it('a manager gets a ghost Reset only when customized, and a primary Save', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.queryByRole('button', {name: consensus.resetProjectDefault})).toBeNull();
    unmount();

    mockConfig({data: config({scope_kind: 'project'})});
    render(<ReviewConsensusSection projectId="p1" />);
    // ui/button.tsx: ghost → hover:bg-accent, default → bg-primary; size sm → text-[13px]
    // (no call-site text override left to beat it through cn()).
    const reset = screen.getByRole('button', {name: consensus.resetProjectDefault});
    expect(reset).toHaveClass('hover:bg-accent', 'text-[13px]');
    expect(reset).not.toHaveClass('bg-primary');
    const save = screen.getByRole('button', {name: consensus.saveProjectDefault});
    expect(save).toHaveClass('bg-primary', 'text-[13px]');
    expect(save).not.toHaveClass('hover:bg-accent');
    expect(save).toBeEnabled();
  });

  it('carries the corrected tab description', () => {
    expect(consensus.tabConsensusDesc).toBe('Consensus rule and arbitrator');
  });
});
```

> The skeleton test finds the group by walking up from the `<h2>`: `h2 → title row → group root`, which is the nesting Task 2b's `SettingsGroup` renders (`<div class="border-t …"><div class="mb-1 flex …"><h2>`). Do not loosen the class assertion.

- [ ] **Step 2: Run it red**

Run: `npm run test:run -- frontend/test/components/ReviewConsensusSection.test.tsx`
Expected: FAIL. `role="alert"` is present, `currentDefaultLabel` is undefined, and the arbitrator error is not referenced by `aria-describedby`. The non-manager case fails because the switch has no row grid ancestor (its Save/Reset/disabled assertions already hold and pin today's rules). The manager case fails because Reset and Save still carry `className="text-[12px]"`, which `cn()` keeps over the sm tier's `text-[13px]`.

- [ ] **Step 3: Copy — grep, delete, add, correct**

```bash
for k in sectionTitle sectionDesc managerVisibilityCardTitle managerVisibilityCardDesc projectDefaultUsingSystem; do echo "== $k"; grep -rn "consensus', '$k'\|consensus\.$k\b\|\b$k:" frontend/; done
```

Expected: each key appears only in `frontend/lib/copy/consensus.ts` and `ReviewConsensusSection.tsx`. `aiContext.sectionTitle/sectionDesc` are a different namespace and are Task 5's to handle. If any other `consensus` reference appears, stop and report it.

Then prove the two dead keys have no reference (the copy-key gate is namespace-blind, so any quoted or `.key` use anywhere in `frontend/` would keep them alive):

```bash
grep -rn "templatesOverrideAction\|templatesEditAction" frontend/ scripts/fitness/
```

Expected: exactly four hits. They are the definitions `frontend/lib/copy/consensus.ts:32-33` and the entries `scripts/fitness/check_copy_keys.baseline:61-62`. If any other hit appears, do not delete those two keys; stop and report it.

In `frontend/lib/copy/consensus.ts`:
- `tabConsensusDesc: 'Reviewers, consensus rule, and arbitrator',` → `tabConsensusDesc: 'Consensus rule and arbitrator',`
- delete the `sectionTitle` line and the two-line `sectionDesc` entry
- delete the two-line `projectDefaultUsingSystem` entry and insert in its place:
  ```ts
      currentDefaultLabel: 'Current',
      currentSystemDefault: 'System default (1 reviewer, unanimous)',
  ```
- delete the `managerVisibilityCardTitle` line and the two-line `managerVisibilityCardDesc` entry
- delete the two dead lines `    templatesOverrideAction: 'Override',` and `    templatesEditAction: 'Edit override',`

In `scripts/fitness/check_copy_keys.baseline`, delete these two lines by hand. Never `--update-baseline`.

```
frontend/lib/copy/consensus.ts:templatesEditAction
frontend/lib/copy/consensus.ts:templatesOverrideAction
```

Verify the ratchet (same invocation as `scripts/fitness/run_all.sh:101-102`):

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0 and `check_copy_keys.py: OK (…; N unreferenced key(s), all baselined)`, with no `baseline entry(ies) now clean` suffix. That suffix would mean a baseline line was left behind. A regression line naming `currentDefaultLabel`/`currentSystemDefault` cannot occur, because the Step 1 test references both.

- [ ] **Step 4: `ReviewConsensusSection` render**

Replace the imports `:10-34` with:

```tsx
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SettingsActions, SettingsGroup, SettingsPage, SettingsRow } from '@/components/settings';
import { t } from '@/lib/copy';
import {
  useClearProjectHitlConfig,
  useProjectHitlConfig,
  useUpsertProjectHitlConfig,
} from '@/hooks/hitl/useHitlConfig';
import { useManagerReviewVisibility } from '@/hooks/hitl/useManagerReviewVisibility';
import { useProjectMembers } from '@/hooks/hitl/useProjectMembers';
import { useProjectTemplates } from '@/hooks/hitl/useProjectTemplates';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

import { ConsensusConfigForm } from './ConsensusConfigForm';
import { TemplateConsensusOverride } from './TemplateConsensusOverride';
```

After `const visibilityPerms = useComparisonPermissions(...)` (`:48`), add:

```tsx
  const visibility = useManagerReviewVisibility(projectId, 'extraction', visibilityPerms.canSeeOthers);
```

After the `projectIsCustomized` declaration (`:97-99`), add:

```tsx
  // The fallback is named only once the config has loaded cleanly and says so.
  const showSystemDefault =
    !projectConfig.isLoading &&
    !projectConfig.isError &&
    projectConfig.data !== undefined &&
    projectConfig.data.scope_kind !== 'project';
```

Replace `return ( <SettingsSection … </SettingsSection> );` (`:138-256`) with:

```tsx
  return (
    <SettingsPage
      intro={
        <>
          <span className="text-foreground">{t('consensus', 'runsBannerTitle')}</span>{' '}
          {t('consensus', 'runsBannerBody')}
        </>
      }
    >
      <SettingsGroup title={t('consensus', 'projectDefaultTitle')} hint={t('consensus', 'projectDefaultDesc')}>
        {projectConfig.isLoading ? (
          <>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        ) : (
          <>
            {showSystemDefault && (
              <SettingsRow label={t('consensus', 'currentDefaultLabel')}>
                <p className="px-2 text-[13px] text-muted-foreground">{t('consensus', 'currentSystemDefault')}</p>
              </SettingsRow>
            )}
            <ConsensusConfigForm
              value={draft}
              onChange={setDraft}
              members={members.data ?? []}
              membersLoading={members.isLoading}
              disabled={!isManager || upsertProject.isPending || clearProject.isPending}
            />
            <SettingsActions>
              {projectIsCustomized && isManager && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearProject}
                  disabled={clearProject.isPending || upsertProject.isPending}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  {t('consensus', 'resetProjectDefault')}
                </Button>
              )}
              <Button size="sm" onClick={handleSaveProject} disabled={saveDisabled}>
                {upsertProject.isPending ? t('consensus', 'saving') : t('consensus', 'saveProjectDefault')}
              </Button>
            </SettingsActions>
          </>
        )}
      </SettingsGroup>

      {visibilityPerms.loading ? null : (
        <SettingsGroup>
          <SettingsRow
            label={t('consensus', 'managerVisibilityLabel')}
            htmlFor="manager-visibility-extraction"
            hint={t('consensus', 'managerVisibilityHint')}
          >
            {({ describedBy }) => (
              <Switch
                id="manager-visibility-extraction"
                checked={visibility.checked}
                disabled={!visibilityPerms.canManageBlindMode || visibility.saving}
                onCheckedChange={visibility.onToggle}
                aria-describedby={describedBy}
              />
            )}
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t('consensus', 'templatesTitle')} hint={t('consensus', 'templatesDesc')}>
        {templatesLoading ? (
          <div className="text-[12px] text-muted-foreground py-3">
            {t('consensus', 'templatesLoading')}
          </div>
        ) : allTemplates.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3">
            {t('consensus', 'templatesEmpty')}
          </div>
        ) : (
          <div className="space-y-2">
            {allTemplates.map((template) => (
              <TemplateConsensusOverride
                key={template.id}
                projectId={projectId}
                template={template}
                members={members.data ?? []}
                membersLoading={members.isLoading}
                canEdit={isManager}
              />
            ))}
          </div>
        )}
      </SettingsGroup>
    </SettingsPage>
  );
```

Update the docstring (`:1-8`): "the banner up top" → "the intro line".

- [ ] **Step 5: Run the touched tests green**

Run: `npm run test:run -- frontend/test/components/ReviewConsensusSection.test.tsx frontend/test/ConsensusConfigForm.test.tsx frontend/test/components/ConsensusConfigForm.rows.test.tsx frontend/test/components/ManagerReviewVisibilityToggle.test.tsx frontend/test/components/ProjectSettings.sections.test.tsx frontend/test/copy-run-vocabulary.test.ts`
Expected: all PASS, with no edit to any file but `ReviewConsensusSection.test.tsx`.

- [ ] **Step 6: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green, and knip reports zero. `check_copy_keys` passes because both new keys are referenced, the 7 deleted keys are gone, and their 2 baseline lines are removed. No button-scale entry exists for these files.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/project/settings/ReviewConsensusSection.tsx frontend/lib/copy/consensus.ts frontend/test/components/ReviewConsensusSection.test.tsx scripts/fitness/check_copy_keys.baseline
```
```bash
git commit -m "refactor(settings): review consensus as an intro line, project-default rows and a visibility row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Review consensus — per-template overrides

**Files:**
- Modify: `frontend/components/project/settings/TemplateConsensusOverride.tsx:10-28` (imports), `:114-197` (render)
- Modify: `frontend/components/project/settings/ReviewConsensusSection.tsx`, the templates group body (anchor: `{templatesLoading ? (` through the matching `)}` before `</SettingsGroup>`)
- Test: `frontend/test/components/ReviewConsensusSection.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes (Task 8a): `ConsensusConfigForm` returns a fragment of `SettingsRow`s.
- Consumes (Task 8b): the templates `SettingsGroup` already exists in `ReviewConsensusSection`, and `frontend/test/components/ReviewConsensusSection.test.tsx` exists with its mocks, `config()` and `consensus` import.
- Consumes (header): `SettingsActions`, `Skeleton`.
- Produces: nothing new. `TemplateConsensusOverride` props are unchanged, and its root is now `role="listitem"`.

- [ ] **Step 1: Append failing tests**

Append to `frontend/test/components/ReviewConsensusSection.test.tsx`:

```tsx
const TEMPLATE = {id: 't1', name: 'CHARMS', framework: 'CHARMS'};

function mockTemplate(over: Record<string, unknown> = {}, isLoading = false) {
  vi.mocked(useProjectTemplates).mockImplementation((({kind}: {kind: string}) =>
    ({data: kind === 'extraction' ? [TEMPLATE] : [], isLoading: false})) as never);
  vi.mocked(hitl.useTemplateHitlConfig).mockReturnValue({
    data: isLoading ? undefined : config({scope_kind: 'template', inherited: true, ...over}),
    isLoading,
  } as never);
  vi.mocked(hitl.useUpsertTemplateHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(hitl.useClearTemplateHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
}

describe('ReviewConsensusSection — per-template overrides', () => {
  it('lists overrides as flush row buttons with no frame', () => {
    mockTemplate();
    render(<ReviewConsensusSection projectId="p1" />);
    const list = screen.getByRole('list');
    const row = screen.getByRole('button', {name: /CHARMS/});
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveClass('hover:bg-muted/60');
    for (const el of [list, screen.getByRole('listitem'), row]) {
      expect(el.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    }
    expect(row).toHaveTextContent(consensus.templatesInheritsBadge);
  });

  it('expands into rule rows and ghost/primary actions', async () => {
    mockTemplate({inherited: false});
    render(<ReviewConsensusSection projectId="p1" />);
    await userEvent.click(screen.getByRole('button', {name: /CHARMS/}));
    // project default rule + this override's rule
    expect(screen.getAllByText(consensus.ruleLabel)).toHaveLength(2);
    expect(screen.getByRole('button', {name: consensus.templatesRemoveOverride})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: consensus.save})).toBeInTheDocument();
  });

  it('keeps loading and empty states as muted lines inside the group', () => {
    vi.mocked(useProjectTemplates).mockReturnValue({data: undefined, isLoading: true} as never);
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.templatesLoading)).toHaveClass('text-[13px]', 'text-muted-foreground');
    unmount();
    vi.mocked(useProjectTemplates).mockReturnValue({data: [], isLoading: false} as never);
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.templatesEmpty)).toHaveClass('text-[13px]', 'text-muted-foreground');
  });

  it('renders the expanded-body skeleton as h-8 rows', async () => {
    mockTemplate({}, true);
    render(<ReviewConsensusSection projectId="p1" />);
    await userEvent.click(screen.getByRole('button', {name: /CHARMS/}));
    const item = screen.getByRole('listitem');
    const bodySkeletons = [...item.querySelectorAll('.animate-pulse')].filter((el) => !el.closest('button'));
    expect(bodySkeletons.length).toBe(2);
    bodySkeletons.forEach((el) => expect(el).toHaveClass('h-8'));
  });
});
```

Also add this line to the file's top-level imports, directly after `import {render, screen} from '@testing-library/react';`. Keep it top-level: an `await import()` inside `it()` causes contention flakes.

```tsx
import userEvent from '@testing-library/user-event';
```

- [ ] **Step 2: Run red**

Run: `npm run test:run -- frontend/test/components/ReviewConsensusSection.test.tsx`
Expected: the 4 new tests FAIL. There is no `list` role, the root has `border`, and the loading line has `text-[12px]`.

- [ ] **Step 3: Section templates body**

In `ReviewConsensusSection.tsx`, replace the templates group's body (from `{templatesLoading ? (` to its closing `)}`) with:

```tsx
        {templatesLoading ? (
          <p className="text-[13px] text-muted-foreground">{t('consensus', 'templatesLoading')}</p>
        ) : allTemplates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('consensus', 'templatesEmpty')}</p>
        ) : (
          <div role="list" className="space-y-0.5">
            {allTemplates.map((template) => (
              <TemplateConsensusOverride
                key={template.id}
                projectId={projectId}
                template={template}
                members={members.data ?? []}
                membersLoading={members.isLoading}
                canEdit={isManager}
              />
            ))}
          </div>
        )}
```

- [ ] **Step 4: `TemplateConsensusOverride` render**

Replace imports `:10-28` with:

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsActions } from '@/components/settings';
import { t } from '@/lib/copy';
import {
  useClearTemplateHitlConfig,
  useTemplateHitlConfig,
  useUpsertTemplateHitlConfig,
} from '@/hooks/hitl/useHitlConfig';
import type { ProjectMemberSummary } from '@/hooks/hitl/useProjectMembers';
import type { ProjectTemplate } from '@/hooks/hitl/useHITLProjectTemplates';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

import { ConsensusConfigForm } from './ConsensusConfigForm';
```

(`cn` is dropped because the row no longer toggles a border class.)

Replace `return ( <div className="border border-border/40 rounded-md"> … </div> );` (`:114-197`) with:

```tsx
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        )}
        <span className="truncate font-medium">{template.name}</span>
        {template.framework && (
          <span className="truncate text-muted-foreground">· {template.framework}</span>
        )}
        {config.isLoading ? (
          <Skeleton className="ml-auto h-5 w-24 shrink-0" />
        ) : (
          <Badge variant={isOverridden ? 'default' : 'outline'} className="ml-auto shrink-0 text-[11px]">
            {isOverridden
              ? t('consensus', 'templatesOverriddenBadge')
              : t('consensus', 'templatesInheritsBadge')}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="space-y-1 pb-2">
          {config.isLoading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : (
            <ConsensusConfigForm
              value={draft}
              onChange={setDraft}
              members={members}
              membersLoading={membersLoading}
              disabled={!canEdit || upsert.isPending || clear.isPending}
            />
          )}

          {canEdit && (
            <SettingsActions>
              {isOverridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={clear.isPending || upsert.isPending}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  {t('consensus', 'templatesRemoveOverride')}
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
                {upsert.isPending ? t('consensus', 'saving') : t('consensus', 'save')}
              </Button>
            </SettingsActions>
          )}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 5: Run green**

Run: `npm run test:run -- frontend/test/components/ReviewConsensusSection.test.tsx frontend/test/ConsensusConfigForm.test.tsx`
Expected: PASS (all Task 8b and Task 9 cases).

- [ ] **Step 6: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green. No copy key changes; Task 8b already deleted the dead `templatesOverrideAction`/`templatesEditAction` and their baseline lines.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/project/settings/TemplateConsensusOverride.tsx frontend/components/project/settings/ReviewConsensusSection.tsx frontend/test/components/ReviewConsensusSection.test.tsx
```
```bash
git commit -m "refactor(settings): per-template consensus overrides as a flush list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Advanced

**Files:**
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx:6-31` (imports), `:120-321` (render)
- Modify: `frontend/components/project/settings/HighQualityParsingToggle.tsx:8-13` (imports), `:52-70` (render)
- Modify: `frontend/lib/copy/project.ts:131-151` (6 deletions), `frontend/lib/copy/parsing.ts` (`highQualityHint` text)
- Test: `frontend/test/components/AdvancedSettingsSection.test.tsx:47` (edit) + 2 new cases; `frontend/test/components/HighQualityParsingToggle.test.tsx` (unchanged, must pass)

**Interfaces:**
- Consumes (header): `SettingsPage`, `SettingsGroup` (`tone="danger"`), `SettingsRow` (render-prop, `align="start"`), `Textarea variant="quiet"`, and `TagInput` `id` / `aria-describedby` / `addLabel`. `common.addToLabel` and `common.fieldHintAria` exist from Tasks 3 and 2a; verify with `grep -n "addToLabel\|fieldHintAria" frontend/lib/copy/common.ts`.
- Produces: `HighQualityParsingToggle` now renders a `SettingsRow`, so it must be placed inside a `SettingsGroup` body. Its props are unchanged.

- [ ] **Step 1: Edit + add failing tests**

In `AdvancedSettingsSection.test.tsx`, replace line 47 with:

```tsx
    const sw = screen.getByRole('switch');
    const hintName = t('common', 'fieldHintAria').replace('{{label}}', t('parsing', 'highQualityLabel'));
    expect(screen.getByRole('button', {name: hintName})).toBeInTheDocument();
    const ids = (sw.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(t('parsing', 'highQualityHint'));
```

Append inside the `describe`:

```tsx
  it('keeps the needs-key sentence visible under the disabled switch', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: []});
    renderSection(true);
    const sentence = await screen.findByText(t('parsing', 'highQualityNeedsKey'));
    expect(sentence).toBeVisible();
    expect(sentence).not.toHaveClass('sr-only');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toContain(sentence.id);
  });

  it('renders one flat group of rows, then a destructive Danger zone', () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection(true);
    const headings = screen.getAllByRole('heading', {level: 2});
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(t('project', 'advancedCardDangerTitle'));
    expect(headings[0]).toHaveClass('text-destructive');
    expect(screen.getByLabelText(t('project', 'advancedAdditionalNotesLabel'))).toHaveAttribute('id', 'eligibility_notes');
    expect(screen.getByRole('button', {name: t('project', 'advancedDeleteProjectButton')})).toBeInTheDocument();
    expect(t('parsing', 'highQualityHint')).toMatch(/Applies to newly ingested PDFs\.$/);
  });
```

- [ ] **Step 2: Run red**

Run: `npm run test:run -- frontend/test/components/AdvancedSettingsSection.test.tsx`
Expected: FAIL. There is no hint button, the switch has no `aria-describedby`, the headings are still card titles, and the hint text is uncorrected.

- [ ] **Step 3: Copy — grep, delete, correct**

```bash
for k in advancedSectionTitle advancedSectionDesc advancedCardEligibilityTitle advancedCardEligibilityDesc advancedCardParsingDesc advancedCardDangerDesc; do echo "== $k"; grep -rn "\b$k\b" frontend/; done
```

Expected: only `frontend/lib/copy/project.ts` and `AdvancedSettingsSection.tsx`. Delete these 6 lines from `project.ts`. Keep `advancedCardDangerTitle`, the keywords/study-types title and description keys, `advancedDeleteProjectHeading`/`Warning`, and every label and placeholder.

In `frontend/lib/copy/parsing.ts`:

```ts
    highQualityHint:
        'Uses LlamaParse for high-fidelity structured PDF parsing. When off, the self-hosted parser is used. Applies to newly ingested PDFs.',
```

- [ ] **Step 4: `HighQualityParsingToggle` as a row**

Replace imports `:8-13` with:

```tsx
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { SettingsRow } from '@/components/settings';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/copy';
import { setParserType } from '@/services/parserSettingsService';
```

Replace `:52-70` (`const id = useId();` to the end of the return) with:

```tsx
  const id = useId();
  const needsKeyId = `${id}-needs-key`;
  return (
    <SettingsRow
      label={t('parsing', 'highQualityLabel')}
      htmlFor={id}
      hint={t('parsing', 'highQualityHint')}
      align={hasLlamaCloudKey ? 'center' : 'start'}
    >
      {({ describedBy }) => (
        <div className="space-y-1">
          <Switch
            id={id}
            checked={checked}
            disabled={disabled || saving || !hasLlamaCloudKey}
            onCheckedChange={onToggle}
            aria-describedby={[describedBy, hasLlamaCloudKey ? undefined : needsKeyId].filter(Boolean).join(' ') || undefined}
          />
          {!hasLlamaCloudKey && (
            // A disabled reason stays visible text, never behind the hint.
            <p id={needsKeyId} className="text-[13px] text-muted-foreground">
              {t('parsing', 'highQualityNeedsKey')}
            </p>
          )}
        </div>
      )}
    </SettingsRow>
  );
```

Update the docstring: add `Renders a SettingsRow; place it inside a SettingsGroup.`

- [ ] **Step 5: `AdvancedSettingsSection` render**

Replace imports `:6-31` with:

```tsx
import {useState} from 'react';
import {useNavigate} from 'react-router';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Trash2} from 'lucide-react';
import {deleteProject} from '@/services/projectSettingsService';
import {useMyConnections} from '@/hooks/user/useLlmConnections';
import {useProjectConnections} from '@/hooks/project/useProjectConnections';
import {toast} from 'sonner';
import {SettingsGroup, SettingsPage, SettingsRow, TagInput} from '@/components/settings';
import type {EligibilityCriteria, StudyDesign} from '@/types/project';
import type {Json} from '@/integrations/supabase/types';
import {t} from '@/lib/copy';
import {HighQualityParsingToggle} from './HighQualityParsingToggle';
```

(This drops `Label` and the unused `_AlertTriangle` alias.)

Before `const handleDeleteProject`, add:

```tsx
  const addTo = (label: string) => t('common', 'addToLabel').replace('{{label}}', label);
  const keywordsLabel = t('project', 'advancedCardKeywordsTitle');
  const inclusionLabel = t('project', 'advancedInclusionLabel');
  const exclusionLabel = t('project', 'advancedExclusionLabel');
  const studyTypesLabel = t('project', 'advancedCardStudyTypesTitle');
```

Replace `return ( <SettingsSection … </SettingsSection> );` (`:120-321`) with:

```tsx
  return (
    <SettingsPage>
      <SettingsGroup>
        <SettingsRow label={keywordsLabel} htmlFor="advanced-keywords" hint={t('project', 'advancedCardKeywordsDesc')} align="start">
          {({describedBy}) => (
            <TagInput
              id="advanced-keywords"
              aria-describedby={describedBy}
              addLabel={addTo(keywordsLabel)}
              items={keywords}
              onAdd={(value) => onChange({review_keywords: [...keywords, value]})}
              onRemove={(index) => onChange({review_keywords: keywords.filter((_, i) => i !== index)})}
              placeholder={t('project', 'advancedKeywordsPlaceholder')}
              variant="badge"
            />
          )}
        </SettingsRow>

        <SettingsRow label={inclusionLabel} htmlFor="advanced-inclusion" align="start">
          <TagInput
            id="advanced-inclusion"
            addLabel={addTo(inclusionLabel)}
            items={inclusion}
            onAdd={(value) => onChange({eligibility_criteria: {...eligibility, inclusion: [...inclusion, value]}})}
            onRemove={(index) =>
              onChange({eligibility_criteria: {...eligibility, inclusion: inclusion.filter((_, i) => i !== index)}})
            }
            placeholder={t('project', 'advancedInclusionPlaceholder')}
            variant="list"
            listVariant="neutral"
          />
        </SettingsRow>

        <SettingsRow label={exclusionLabel} htmlFor="advanced-exclusion" align="start">
          <TagInput
            id="advanced-exclusion"
            addLabel={addTo(exclusionLabel)}
            items={exclusion}
            onAdd={(value) => onChange({eligibility_criteria: {...eligibility, exclusion: [...exclusion, value]}})}
            onRemove={(index) =>
              onChange({eligibility_criteria: {...eligibility, exclusion: exclusion.filter((_, i) => i !== index)}})
            }
            placeholder={t('project', 'advancedExclusionPlaceholder')}
            variant="list"
            listVariant="neutral"
          />
        </SettingsRow>

        <SettingsRow label={t('project', 'advancedAdditionalNotesLabel')} htmlFor="eligibility_notes" align="start">
          <Textarea
            id="eligibility_notes"
            variant="quiet"
            value={eligibility.notes ?? ''}
            onChange={(e) => onChange({eligibility_criteria: {...eligibility, notes: e.target.value}})}
            placeholder={t('project', 'advancedEligibilityNotesPlaceholder')}
            rows={3}
            className="resize-none"
          />
        </SettingsRow>

        <SettingsRow label={studyTypesLabel} htmlFor="advanced-study-types" hint={t('project', 'advancedCardStudyTypesDesc')} align="start">
          {({describedBy}) => (
            <TagInput
              id="advanced-study-types"
              aria-describedby={describedBy}
              addLabel={addTo(studyTypesLabel)}
              items={studyTypes}
              onAdd={(value) => onChange({study_design: {...studyDesign, types: [...studyTypes, value]}})}
              onRemove={(index) =>
                onChange({study_design: {...studyDesign, types: studyTypes.filter((_, i) => i !== index)}})
              }
              placeholder={t('project', 'advancedStudyTypesPlaceholder')}
              variant="badge"
            />
          )}
        </SettingsRow>

        <SettingsRow label={t('project', 'advancedDesignNotesLabel')} htmlFor="study_design_notes" align="start">
          <Textarea
            id="study_design_notes"
            variant="quiet"
            value={studyDesign.notes ?? ''}
            onChange={(e) => onChange({study_design: {...studyDesign, notes: e.target.value}})}
            placeholder={t('project', 'advancedDesignNotesPlaceholder')}
            rows={3}
            className="resize-none"
          />
        </SettingsRow>

        <HighQualityParsingToggle
          projectId={projectId}
          currentType={currentParserType}
          hasLlamaCloudKey={hasLlamaCloudKey}
          disabled={!isManager}
        />
      </SettingsGroup>

      <SettingsGroup title={t('project', 'advancedCardDangerTitle')} tone="danger">
        <SettingsRow label={t('project', 'advancedDeleteProjectHeading')} hint={t('project', 'advancedDeleteProjectWarning')}>
          {({describedBy}) => (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" aria-describedby={describedBy} className="w-fit">
                  <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  {t('project', 'advancedDeleteProjectButton')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive">
                    {t('project', 'advancedConfirmDeleteTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <p>
                      {t('project', 'advancedConfirmDeleteDescription')}{' '}
                      <strong>&quot;{project.name}&quot;</strong>.
                    </p>
                    <p>{t('project', 'advancedConfirmDeleteList')}</p>
                    <p className="font-medium text-destructive">{t('project', 'advancedConfirmDeleteFinal')}</p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteProject} disabled={isDeleting} variant="destructive">
                    {isDeleting ? t('project', 'advancedDeleting') : t('project', 'advancedConfirmDeleteButton')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
```

Docstring `:1-4` → `Advanced settings — one flat group of rows (keywords, eligibility, study types, PDF parsing), then the Danger zone.`

- [ ] **Step 6: Run green**

Run: `npm run test:run -- frontend/test/components/AdvancedSettingsSection.test.tsx frontend/test/components/HighQualityParsingToggle.test.tsx frontend/test/components/ProjectSettings.sections.test.tsx`
Expected: PASS. `HighQualityParsingToggle.test.tsx` is unedited: `getByRole('switch')` still resolves outside a container.

- [ ] **Step 7: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green. The file shrinks from 322 lines, and no button-scale entry exists for it.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/project/settings/AdvancedSettingsSection.tsx frontend/components/project/settings/HighQualityParsingToggle.tsx frontend/lib/copy/project.ts frontend/lib/copy/parsing.ts frontend/test/components/AdvancedSettingsSection.test.tsx
```
```bash
git commit -m "refactor(settings): advanced settings as one row group plus a danger zone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11a: Profile + User settings gutter

**Files:**
- Modify: `frontend/components/user/ProfileSection.tsx:9-18` (imports), `:85-186` (both renders)
- Modify: `frontend/pages/UserSettings.tsx:112-116`
- Modify: `frontend/lib/copy/user.ts` (5 deletions)
- Test: `frontend/test/ProfileSection.validation.test.tsx` (+3 cases), `frontend/test/UserSettings.test.tsx` (+1 case)

**Interfaces:**
- Consumes (header): `SettingsPage`, `SettingsGroup`, `SettingsRow` (render-prop), `SettingsActions` (Task 2b); `Input variant="quiet"` and `FormControl` merging an incoming `aria-describedby` (Task 1); `common.fieldHintAria` (Task 2a).
- Produces: nothing. `SecuritySection` (Task 11b) renders under the same `p-2` gutter.

- [ ] **Step 1: Failing tests**

Append to `ProfileSection.validation.test.tsx`, inside the `describe`:

```tsx
    it('shows the email as plain text with no label association', async () => {
        await renderLoaded();
        const email = screen.getByText('ada@example.org');
        expect(email.tagName).toBe('P');
        expect(screen.queryByLabelText(copy.profileEmailLabel)).toBeNull();
        expect('profileEmailAria' in copy).toBe(false);
        const hint = screen.getByRole('button', {name: `About ${copy.profileEmailLabel}`});
        expect(hint).toBeInTheDocument();
    });

    it('renders h-8 skeleton rows while the profile loads', async () => {
        fetchMock.mockReturnValue(new Promise(() => {}));
        render(<ProfileSection/>);
        await vi.waitFor(() => expect(document.querySelectorAll('.animate-pulse').length).toBe(3));
        document.querySelectorAll('.animate-pulse').forEach((el) => expect(el).toHaveClass('h-8'));
        expect(screen.queryByPlaceholderText(copy.profileFullNamePlaceholder)).toBeNull();
    });

    it('describes the Full name input by its hint, and by the message after a failed submit', async () => {
        await renderLoaded();
        const describedIds = () =>
            (nameInput().getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
        // SettingsRow's sr-only `-hint` span, merged in by FormControl (Task 1).
        const hint = describedIds()
            .map((id) => document.getElementById(id))
            .find((el) => el?.textContent === copy.profileFullNameHint);
        expect(hint).toBeTruthy();

        await userEvent.clear(nameInput());
        await submit();

        const message = await screen.findByText(copy.profileNameRequired);
        expect(message.id).not.toBe('');
        expect(describedIds()).toContain(message.id);
        expect(describedIds()).toContain(hint!.id);
    });
```

(`About {label}` is the English text of `common.fieldHintAria` from Task 2a.)

Append to `UserSettings.test.tsx`, inside the `describe`:

```tsx
  it('owns a p-2 gutter and leaves the content width to SettingsPage', () => {
    renderSettings();

    const main = screen.getByRole('main');
    expect(main).toHaveClass('p-2');
    expect(main.className).not.toMatch(/(?:^|\s)(?:px-4|py-3|lg:px-6)(?:\s|$)/);
    expect(main.querySelector('.max-w-3xl')).toBeNull();
    expect(main.firstElementChild).toHaveTextContent('profile section');
  });
```

- [ ] **Step 2: Run red**

Run: `npm run test:run -- frontend/test/ProfileSection.validation.test.tsx frontend/test/UserSettings.test.tsx`
Expected: the 4 new cases FAIL. The email is an `<input>`, there are 5 skeletons, and the gutter is `px-4`. The Full name input's `aria-describedby` is only the element-less `…-form-item-description` id, because `SettingsField` renders the hint as a `<p>` with no id. The existing cases PASS.

- [ ] **Step 3: Copy — grep, delete**

```bash
for k in profileTitle profileDescription profileCardTitle profileCardDescription profileEmailAria; do echo "== $k"; grep -rn "\b$k\b" frontend/; done
```

Expected: each key appears only in `frontend/lib/copy/user.ts`, `frontend/components/user/ProfileSection.tsx` and, for `profileEmailAria`, the new `'profileEmailAria' in copy` assertion. Delete those 5 lines from `user.ts`. Keep `profilePicture`, `profileUploadComingSoon`, `profileEmailLabel`, `profileEmailHint` and `profileFullNameHint`. The `security*` keys are Task 11b's.

- [ ] **Step 4: `ProfileSection`**

Replace imports `:9-18` with:

```tsx
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import {CheckCircle2, Loader2, User} from 'lucide-react';
import {fetchProfile, saveProfile} from '@/services/profileService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
```

Replace everything from `if (loading) {` (`:85`) to the end of the component (`:186`) with:

```tsx
  if (loading) {
    return (
      <SettingsPage>
        <SettingsGroup>
          <SettingsRow label={t('user', 'profilePicture')}>
            <Skeleton className="h-8 w-8 rounded-full"/>
          </SettingsRow>
          <SettingsRow label={t('user', 'profileEmailLabel')}>
            <Skeleton className="h-8 w-full"/>
          </SettingsRow>
          <SettingsRow label={t('user', 'profileFullNameLabel')}>
            <Skeleton className="h-8 w-full"/>
          </SettingsRow>
        </SettingsGroup>
      </SettingsPage>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsPage>
          <SettingsGroup>
            <SettingsRow label={t('user', 'profilePicture')}>
              <div className="flex items-center gap-2 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={avatarUrl} alt={fullName}/>
                  <AvatarFallback className="bg-primary/10 text-[13px] text-primary">
                    {fullName ? getInitials(fullName) : <User className="h-4 w-4"/>}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[13px] text-muted-foreground">{t('user', 'profileUploadComingSoon')}</span>
              </div>
            </SettingsRow>

            {/* No control: the address is managed by auth, so it is text, not a disabled input. */}
            <SettingsRow label={t('user', 'profileEmailLabel')} hint={t('user', 'profileEmailHint')}>
              <p className="px-2 text-[13px]">{email}</p>
            </SettingsRow>

            <FormField
              control={form.control}
              name="full_name"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow
                    label={t('user', 'profileFullNameLabel')}
                    htmlFor="profile-fullname"
                    hint={t('user', 'profileFullNameHint')}
                  >
                    {({describedBy}) => (
                      <>
                        <FormControl aria-describedby={describedBy}>
                          <Input
                            id="profile-fullname"
                            variant="quiet"
                            {...field}
                            placeholder={t('user', 'profileFullNamePlaceholder')}
                          />
                        </FormControl>
                        <FormMessage/>
                      </>
                    )}
                  </SettingsRow>
                </FormItem>
              )}
            />

            <SettingsActions>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                    {t('user', 'profileSaving')}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                    {t('user', 'profileSaveChanges')}
                  </>
                )}
              </Button>
            </SettingsActions>
          </SettingsGroup>
        </SettingsPage>
      </form>
    </Form>
  );
}
```

- [ ] **Step 5: `UserSettings` gutter**

Replace `:112-116` with:

```tsx
            <main className="min-w-0 flex-1 overflow-y-auto p-2">
                {renderTabContent()}
            </main>
```

- [ ] **Step 6: Run green**

Run: `npm run test:run -- frontend/test/ProfileSection.validation.test.tsx frontend/test/UserSettings.test.tsx frontend/components/ui/form.validation.test.tsx`
Expected: all PASS.

- [ ] **Step 7: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green, and knip reports zero. `ProfileSection.tsx` has no `check_button_scale.baseline` entry, so the baseline is not edited.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/user/ProfileSection.tsx frontend/pages/UserSettings.tsx frontend/lib/copy/user.ts frontend/test/ProfileSection.validation.test.tsx frontend/test/UserSettings.test.tsx
```
```bash
git commit -m "refactor(settings): profile as flat rows; user settings p-2 gutter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11b: Security

**Files:**
- Modify: `frontend/components/user/SecuritySection.tsx:9-18` (imports), `:90-250` (render)
- Modify: `frontend/lib/copy/user.ts` (6 deletions)
- Modify: `scripts/fitness/check_button_scale.baseline:30` (delete the `SecuritySection.tsx:2` line)
- Test: `frontend/test/SecuritySection.validation.test.tsx` (+1 case; `:1-130` unchanged)

**Interfaces:**
- Consumes (header): `SettingsPage` (`intro`), `SettingsGroup`, `SettingsRow`, `SettingsActions` (Task 2b); `Input variant="quiet"` and `FormControl` merging an incoming `aria-describedby` (Task 1); `IconButton`.
- Consumes (Task 11a): nothing in code; its `p-2` gutter on `UserSettings.tsx` already frames this view.
- Produces: nothing. This task removes the last `SettingsCard` and `SettingsField` callers; Task 14 deletes both.

- [ ] **Step 1: Failing test**

Append to `SecuritySection.validation.test.tsx`, inside the `describe` and after the last `it`:

```tsx
    it('states the rules once as the intro and keeps the reveal control in flow', () => {
        render(<SecuritySection/>);
        expect(screen.getByText(copy.securityAlertDescription).tagName).toBe('P');
        expect(screen.queryByRole('alert')).toBeNull();
        const reveal = screen.getByRole('button', {name: copy.securityAriaShowPassword});
        expect(reveal).not.toHaveClass('absolute');
        expect(reveal.parentElement).toHaveClass('flex', 'items-center', 'gap-1');
        expect('securityNewPasswordHint' in copy).toBe(false);
    });
```

- [ ] **Step 2: Run red**

Run: `npm run test:run -- frontend/test/SecuritySection.validation.test.tsx`
Expected: the new case FAILS (the Alert is present and the reveal is `absolute`). The existing cases PASS.

- [ ] **Step 3: Copy — grep, delete**

```bash
for k in securityTitle securityDescription securityCardTitle securityCardDescription securityNewPasswordHint securityConfirmHint; do echo "== $k"; grep -rn "\b$k\b" frontend/; done
```

Expected: each key appears only in `frontend/lib/copy/user.ts`, `frontend/components/user/SecuritySection.tsx` and, for `securityNewPasswordHint`, the new `'securityNewPasswordHint' in copy` assertion. Delete those 6 lines from `user.ts`. Keep `securityAlertDescription` and `securityPasswordStrength`.

- [ ] **Step 4: `SecuritySection`**

Replace imports `:9-18` with:

```tsx
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {IconButton} from '@/components/patterns/IconButton';
import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import {AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock} from 'lucide-react';
import {toast} from 'sonner';
import {updateUserPassword} from '@/services/authService';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
```

Replace `return ( <SettingsSection … </SettingsSection> );` (`:90-250`) with:

```tsx
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsPage intro={t('user', 'securityAlertDescription')}>
          <SettingsGroup>
            <FormField
              control={form.control}
              name="newPassword"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow label={t('user', 'securityNewPasswordLabel')} htmlFor="security-new-password" align="start">
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input
                          id="security-new-password"
                          variant="quiet"
                          {...field}
                          type={showPasswords.new ? 'text' : 'password'}
                          placeholder={t('user', 'securityNewPasswordPlaceholder')}
                        />
                      </FormControl>
                      <IconButton
                        label={showPasswords.new ? t('user', 'securityAriaHidePassword') : t('user', 'securityAriaShowPassword')}
                        icon={showPasswords.new ? <EyeOff className="h-4 w-4" strokeWidth={1.5}/> : <Eye className="h-4 w-4" strokeWidth={1.5}/>}
                        onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                      />
                    </div>
                    {newPassword && (
                      <div className="space-y-1.5 px-2 pt-1">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-muted-foreground">{t('user', 'securityPasswordStrength')}</span>
                          <span className={cn('font-medium', passwordStrength.textClass)}>
                            {passwordStrength.labelKey ? t('user', passwordStrength.labelKey) : ''}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {[...Array(6)].map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                'h-1 flex-1 rounded-full transition-colors duration-150',
                                i < passwordStrength.strength ? passwordStrength.colorClass : 'bg-muted',
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <FormMessage/>
                  </SettingsRow>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow label={t('user', 'securityConfirmLabel')} htmlFor="security-confirm-password" align="start">
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input
                          id="security-confirm-password"
                          variant="quiet"
                          {...field}
                          type={showPasswords.confirm ? 'text' : 'password'}
                          placeholder={t('user', 'securityConfirmPlaceholder')}
                        />
                      </FormControl>
                      <IconButton
                        label={showPasswords.confirm ? t('user', 'securityAriaHideConfirm') : t('user', 'securityAriaShowConfirm')}
                        icon={showPasswords.confirm ? <EyeOff className="h-4 w-4" strokeWidth={1.5}/> : <Eye className="h-4 w-4" strokeWidth={1.5}/>}
                        onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                      />
                    </div>
                    {confirmPassword && (
                      <div className="flex items-center gap-1.5 px-2 pt-0.5 text-[12px]">
                        {passwordsMatch ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-success" strokeWidth={1.5}/>
                            <span className="text-success">{t('user', 'securityPasswordsMatch')}</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3 text-destructive" strokeWidth={1.5}/>
                            <span className="text-destructive">{t('user', 'securityPasswordsDoNotMatch')}</span>
                          </>
                        )}
                      </div>
                    )}
                    <FormMessage/>
                  </SettingsRow>
                </FormItem>
              )}
            />

            <SettingsActions>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                    {t('user', 'securityUpdating')}
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                    {t('user', 'securityChangePassword')}
                  </>
                )}
              </Button>
            </SettingsActions>
          </SettingsGroup>
        </SettingsPage>
      </form>
    </Form>
  );
```

`SecuritySection.validation.test.tsx:13-16` describes the old `relative` wrapper. Leave the file header as it is (the file must stay unchanged apart from the appended case), and note the stale comment in your report.

- [ ] **Step 5: Button-scale baseline**

Run: `python3 scripts/fitness/check_button_scale.py`
Expected: exit 0. `SecuritySection.tsx` now has 0 `<Button>` height overrides, because the reveal buttons are `IconButton`s and the submit has no className. Delete the line `frontend/components/user/SecuritySection.tsx:2` from `scripts/fitness/check_button_scale.baseline` by hand, then re-run and expect exit 0.

- [ ] **Step 6: Run green**

Run: `npm run test:run -- frontend/test/SecuritySection.validation.test.tsx frontend/components/ui/form.validation.test.tsx`
Expected: all PASS. `SecuritySection.validation.test.tsx:88-90` passes with no edit, because `FormControl` still emits `formMessageId` after the failed submit.

- [ ] **Step 7: Gates**

Run: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`
Expected: all green, and knip reports zero. `SettingsCard` and `SettingsField` now have no caller; Task 2b's temporary knip block keeps their `index.ts` re-exports quiet until Task 14 deletes them.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/user/SecuritySection.tsx frontend/lib/copy/user.ts scripts/fitness/check_button_scale.baseline frontend/test/SecuritySection.validation.test.tsx
```
```bash
git commit -m "refactor(settings): security as flat rows with in-flow reveal controls

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Integrations — `IntegrationsSection` + AI connections

**Files:**
- Modify: `frontend/components/user/IntegrationsSection.tsx:1-27` (whole file)
- Modify: `frontend/components/user/AiConnectionsSection.tsx:22-28` (imports), `:76` (row), `:113-171` (`AddForm`), `:173-220` (`AiConnectionsSection`)
- Modify: `frontend/components/project/settings/ZoteroIntegrationSection.tsx:76-86,261` (wrap both returns in a `SettingsGroup` only; Task 13 rebuilds the body)
- Modify: `frontend/test/components/AiConnectionsSection.test.tsx` (append tests; the 8 existing tests stay unchanged)
- Create: `frontend/test/components/IntegrationsSection.test.tsx`

**Interfaces:**
- Consumes (Tasks 1, 2a, 2b): `SettingsPage`, `SettingsGroup`, `SettingsRow` (render-prop `{describedBy}`), `SettingsActions` from `@/components/settings`; `variant="quiet"` on `Input` and `SelectTrigger`; `common.fieldHintAria` ("About {{label}}").
- Produces: `AiConnectionsSection` and `ZoteroIntegrationSection` each return a `SettingsGroup` as their root element. Task 13 relies on the Zotero root being a group.

**Why Zotero changes here too.** `IntegrationsSection` stops rendering the Zotero title and description. If `ZoteroIntegrationSection` did not take them over in this task, `user.integrationsZoteroTitle/Description` would have no reference, the copy-key ratchet would fail this task's gate, and the "two direct group children" test could not pass. So Task 12 only wraps Zotero's two returns in a group. Task 13 replaces the body.

**Locators that must survive.** `frontend/e2e/flows/settings-connections.e2e.ts:15` uses `getByRole('heading', {name: 'AI connections'})`. `SettingsGroup` renders the title as an `<h2>` and puts `FieldHint` beside it, not inside it, so the heading's name stays "AI connections". It is the only heading on the page that contains that text. The existing unit tests use these locators, and all survive: `getByLabelText(labelLabel|keyLabel|hostLabel)` (SettingsRow `<label htmlFor>`), `getByRole('combobox')` (the only select), the button names `addButton`, `retry`, `saveButton`, `removeAria`, `removeConfirm` and `verifyAria`, and the texts `listEmpty`, `listLoadError` and `mine`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('AiConnectionsSection', …)` block of `frontend/test/components/AiConnectionsSection.test.tsx`, before its closing `});`:

```tsx
  it('is one AI connections group: an h2 title with its hint trigger', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    const {container} = renderSection();
    const title = t('llmConnections', 'integrationsTitle');
    expect(screen.getByRole('heading', {level: 2, name: title})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('common', 'fieldHintAria').replace('{{label}}', title)})).toBeInTheDocument();
    // The group is the component's root: no wrapper and no space-y-* parent.
    expect(container.firstElementChild).toHaveClass('border-t');
    expect(container.querySelector('.space-y-3')).toBeNull();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listEmpty'))).toBeInTheDocument());
  });

  it('loading renders h-8 skeleton rows inside the group', () => {
    vi.mocked(svc.fetchMyConnections).mockReturnValue(new Promise(() => {}));
    const {container} = renderSection();
    const list = screen.getByRole('list', {name: t('llmConnections', 'listLoading')});
    expect(container.firstElementChild).toContainElement(list);
    const skeletons = list.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
    skeletons.forEach((s) => expect(s).toHaveClass('h-8'));
  });

  it('the load error keeps its destructive line, with a ghost Retry, inside the group', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: false, error: new Error('x')});
    const {container} = renderSection();
    const line = await screen.findByText(t('llmConnections', 'listLoadError'));
    expect(line).toHaveClass('text-[13px]', 'text-destructive');
    expect(container.firstElementChild).toContainElement(line);
    const retry = screen.getByRole('button', {name: t('llmConnections', 'retry')});
    expect(retry).toHaveClass('active:bg-accent/80');
    expect(retry).not.toHaveClass('border');
  });

  it('connections are a flush list with no dividers; Add connection is ghost', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [ROW]});
    renderSection();
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
    const list = screen.getByRole('list');
    expect(list).not.toHaveClass('divide-y');
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent('mine');
    expect(item).toHaveTextContent('OpenAI');
    expect(item).toHaveTextContent(t('llmConnections', 'statusUnverified'));
    const add = screen.getByRole('button', {name: t('llmConnections', 'addButton')});
    expect(add).toHaveClass('active:bg-accent/80');
    expect(add).not.toHaveClass('border');
  });

  it('the add form is rows: hints reach their controls, docs link stays visible, Save primary and Cancel ghost', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    // OpenAI has a global key: its note is the Provider row hint.
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(t('llmConnections', 'globalKeyNote'));
    expect(screen.getByRole('link', {name: t('llmConnections', 'docsLink')})).toHaveAttribute('href', OPENAI.docs_url);
    const labelInput = screen.getByLabelText(t('llmConnections', 'labelLabel'));
    expect(labelInput).not.toHaveClass('h-9');
    expect(labelInput).toHaveClass('border-transparent');
    expect(screen.getByRole('button', {name: t('llmConnections', 'saveButton')})).toHaveClass('bg-primary');
    const cancel = screen.getByRole('button', {name: t('llmConnections', 'cancelButton')});
    expect(cancel).toHaveClass('active:bg-accent/80');
    const form = screen.getByRole('combobox').closest('form');
    expect(form).toHaveClass('space-y-1');
    expect(form).not.toHaveClass('border');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: /Custom host/}));
    expect(screen.getByLabelText(t('llmConnections', 'hostLabel'))).toHaveAccessibleDescription(t('llmConnections', 'hostHint'));
    expect(screen.getByRole('combobox')).not.toHaveAccessibleDescription(t('llmConnections', 'globalKeyNote'));
  });
```

Change the testing-library import at line 2 to:

```tsx
import {render, screen, waitFor, within} from '@testing-library/react';
```

Create `frontend/test/components/IntegrationsSection.test.tsx`:

```tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
  deleteMyConnection: vi.fn(),
  verifyMyConnection: vi.fn(),
}));
vi.mock('@/hooks/useZoteroIntegration', () => ({useZoteroIntegration: vi.fn()}));

import * as svc from '@/services/llmConnectionsService';
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {IntegrationsSection} from '@/components/user/IntegrationsSection';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
  vi.mocked(svc.fetchProviders).mockResolvedValue({ok: true, data: []});
  vi.mocked(useZoteroIntegration).mockReturnValue({
    integration: null, isConfigured: false, loading: false, testing: false,
    loadIntegration: vi.fn(), saveCredentials: vi.fn(), testConnection: vi.fn(), disconnect: vi.fn(),
  } as unknown as ReturnType<typeof useZoteroIntegration>);
});

describe('IntegrationsSection', () => {
  it('renders one SettingsPage whose body holds exactly the two groups', () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const {container} = render(
      <QueryClientProvider client={client}><TooltipProvider><IntegrationsSection /></TooltipProvider></QueryClientProvider>,
    );
    expect(container.firstElementChild).toHaveClass('max-w-3xl');
    const body = container.querySelector('[class~="@container/settings"]');
    expect(body).not.toBeNull();
    const groups = Array.from(body!.children);
    expect(groups).toHaveLength(2);
    groups.forEach((g) => expect(g).toHaveClass('border-t'));
    expect(within(groups[0] as HTMLElement).getByRole('heading', {level: 2, name: t('llmConnections', 'integrationsTitle')})).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByRole('heading', {level: 2, name: t('user', 'integrationsZoteroTitle')})).toBeInTheDocument();
    expect(container.querySelector('.space-y-8')).toBeNull();
    expect(screen.getAllByRole('heading', {level: 2})).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test:run -- frontend/test/components/AiConnectionsSection.test.tsx frontend/test/components/IntegrationsSection.test.tsx`
Expected: FAIL. 4 of the 5 new AI connections tests fail: there is no `h2` level-2 heading (SettingsSection's heading is outside the component), there is no `border-t` root, the skeletons are `h-7`, the list has `divide-y`, Add is `outline`, the add form is a bordered box without `space-y-1`, and the rows carry no `aria-describedby`. The load-error test already passes: today's line is `text-[13px] text-destructive` with a ghost Retry, and the test pins both through the migration. The IntegrationsSection test fails because there is no `max-w-3xl` or `@container/settings` element. The 8 existing tests PASS.

- [ ] **Step 3: Rewrite `IntegrationsSection.tsx`**

```tsx
/**
 * Settings → Integrations: one settings page whose body is the AI connections
 * group and the Zotero group (spec 2026-09-13 borderless density pass § 4.3).
 * Each child returns its own SettingsGroup as its root, so the body holds
 * groups only and draws one hairline between them.
 */

import {SettingsPage} from '@/components/settings';
import {AiConnectionsSection} from '@/components/user/AiConnectionsSection';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';

export function IntegrationsSection() {
  return (
    <SettingsPage>
      <AiConnectionsSection/>
      <ZoteroIntegrationSection/>
    </SettingsPage>
  );
}
```

- [ ] **Step 4: Rewrite the markup of `AiConnectionsSection.tsx`**

Imports: delete `import {Label} from '@/components/ui/label';` (line 26), and add after line 22:

```tsx
import {SettingsActions, SettingsGroup, SettingsRow} from '@/components/settings';
```

Row (line 76): drop the divider-era padding and add the flush hover fill.

```tsx
    <li className="flex items-center gap-3 rounded-md px-2 py-1 text-[13px] hover:bg-muted/60">
```

Replace the `return (…)` of `AddForm` (lines 128-170) with the following. The state, `spec` and `submit` above it stay the same.

```tsx
  return (
    <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <SettingsRow
        label={t('llmConnections', 'providerLabel')}
        htmlFor="conn-provider"
        hint={spec?.global_key_available ? t('llmConnections', 'globalKeyNote') : undefined}
      >
        {({describedBy}) => (
          <div className="space-y-1">
            <Select value={provider} onValueChange={(next) => { setProvider(next); setBaseUrl(''); }}>
              <SelectTrigger id="conn-provider" variant="quiet" aria-describedby={describedBy}>
                <SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label} <span className="text-[12px] text-muted-foreground">({p.description})</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
            {spec?.docs_url && (
              <a href={spec.docs_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 text-[12px] text-primary hover:underline">
                {t('llmConnections', 'docsLink')}<ExternalLink className="h-3 w-3" strokeWidth={1.5} />
              </a>
            )}
          </div>
        )}
      </SettingsRow>
      <SettingsRow label={t('llmConnections', 'labelLabel')} htmlFor="conn-label">
        <Input id="conn-label" variant="quiet" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('llmConnections', 'labelPlaceholder')} maxLength={80} />
      </SettingsRow>
      {spec?.needs_host && (
        <SettingsRow label={t('llmConnections', 'hostLabel')} htmlFor="conn-host" hint={t('llmConnections', 'hostHint')}>
          {({describedBy}) => (
            <Input id="conn-host" variant="quiet" aria-describedby={describedBy} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host/v1" />
          )}
        </SettingsRow>
      )}
      <SettingsRow label={t('llmConnections', 'keyLabel')} htmlFor="conn-key">
        <Input id="conn-key" variant="quiet" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={spec?.key_optional ? t('llmConnections', 'keyOptionalPlaceholder') : t('llmConnections', 'keyPlaceholder')} />
      </SettingsRow>
      <SettingsActions>
        <Button type="submit" size="sm" disabled={create.isPending || label === '' || (!spec?.key_optional && apiKey === '') || (Boolean(spec?.needs_host) && baseUrl === '')}>
          {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t('llmConnections', 'cancelButton')}</Button>
      </SettingsActions>
    </form>
  );
```

`<form className="space-y-1">` keeps Enter-to-submit and draws no box of its own; as the group body's direct child it receives the body's spacing and spaces its own `SettingsRow`s (orchestrator ruling).

Replace `AiConnectionsSection`'s `addButton` and `return` (lines 182-219):

```tsx
  const addButton = (
    <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={!providers.data || adding}>
      <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />{t('llmConnections', 'addButton')}
    </Button>
  );
  return (
    <SettingsGroup title={t('llmConnections', 'integrationsTitle')} hint={t('llmConnections', 'integrationsDescription')}>
      {connections.isPending && (
        <ul className="space-y-1" aria-label={t('llmConnections', 'listLoading')}>
          <li><Skeleton className="h-8 w-full" /></li><li><Skeleton className="h-8 w-full" /></li>
        </ul>
      )}
      {hasError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'listLoadError')}
          <Button size="sm" variant="ghost" onClick={retryBoth}>{t('llmConnections', 'retry')}</Button>
        </p>
      )}
      {!hasError && connections.data && connections.data.length === 0 && !adding && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span>{t('llmConnections', 'listEmpty')}</span>
          {addButton}
        </div>
      )}
      {!hasError && connections.data && connections.data.length > 0 && (
        <ul role="list">
          {connections.data.map((row) => (
            <ConnectionRow key={row.id} row={row} provider={providers.data?.find((p) => p.id === row.provider)} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddForm providers={userProviders} onDone={() => setAdding(false)} />
      ) : !hasError && ((connections.data?.length ?? 0) > 0 || connections.isPending) ? (
        addButton
      ) : null}
    </SettingsGroup>
  );
```

Update the file's header comment (lines 1-6) and add a final line: ` * Renders one SettingsGroup as its root (borderless density pass § 4.3).`

- [ ] **Step 5: Wrap Zotero's two returns in a group (the body is unchanged until Task 13)**

In `ZoteroIntegrationSection.tsx`, add `import {SettingsGroup} from '@/components/settings';` after line 5. Wrap the loading return (lines 77-82) so it reads:

```tsx
    return (
        <SettingsGroup title={t('user', 'integrationsZoteroTitle')} hint={t('user', 'integrationsZoteroDescription')}>
            <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" strokeWidth={1.5}/>
                {t('project', 'zoteroLoading')}
            </div>
        </SettingsGroup>
    );
```

In the main return, replace `<div className="space-y-4">` (line 86) with `<SettingsGroup title={t('user', 'integrationsZoteroTitle')} hint={t('user', 'integrationsZoteroDescription')}>`, and its closing `</div>` (line 261) with `</SettingsGroup>`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm run test:run -- frontend/test/components/AiConnectionsSection.test.tsx frontend/test/components/IntegrationsSection.test.tsx`
Expected: PASS (13 + 1 tests).

- [ ] **Step 7: Confirm no copy key was orphaned and the e2e locator holds**

Run: `grep -rn "integrationsTitle\|integrationsDescription\|integrationsZoteroTitle\|integrationsZoteroDescription\|listLoading" frontend --include="*.tsx"`
Expected: `AiConnectionsSection.tsx` (integrationsTitle, integrationsDescription, listLoading), `ZoteroIntegrationSection.tsx` (both Zotero keys, twice each) and the two test files. No hit in `IntegrationsSection.tsx`.

Run: `grep -n "getByRole\|getByText\|locator" frontend/e2e/flows/settings-connections.e2e.ts`
Expected: only line 15, `heading` named 'AI connections', which the group `<h2>` satisfies. The file is not edited.

- [ ] **Step 8: Gates**

Run each and read the tail: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green, knip zero findings. `check_button_scale.py` has no entry for `AiConnectionsSection.tsx` (no Button `h-*`) and does not change. `check_copy_keys.py` is OK.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/user/IntegrationsSection.tsx frontend/components/user/AiConnectionsSection.tsx frontend/components/project/settings/ZoteroIntegrationSection.tsx frontend/test/components/AiConnectionsSection.test.tsx frontend/test/components/IntegrationsSection.test.tsx
```

```bash
git commit -m "refactor(settings): integrations as a settings page of flat groups

AiConnectionsSection returns the AI connections group: flush list, ghost
Add, skeleton and load error inside the group, add form as rows with
hints wired through aria-describedby. IntegrationsSection drops its
space-y-8 wrapper and SettingsSection headings; Zotero takes its own
group title ahead of its body rewrite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Zotero

**Files:**
- Modify: `frontend/components/project/settings/ZoteroIntegrationSection.tsx` (whole file; 264 lines before Task 12, about 215 after)
- Create: `frontend/test/components/ZoteroIntegrationSection.test.tsx`
- Modify: `scripts/fitness/check_button_scale.baseline:17` (the `ZoteroIntegrationSection.tsx:4` entry)

**Interfaces:**
- Consumes (Tasks 1, 2a, 2b, 12): `SettingsGroup`, `SettingsRow` (render-prop `{describedBy}`), `SettingsActions`; `variant="quiet"` on `Input` and `SelectTrigger`; `common.fieldHintAria`; the group root added in Task 12.
- Produces: nothing new for later tasks.

**Copy.** Every key stays. The loading line, both links, the Show/Hide label and all labels keep their elements, so nothing is deleted. `zoteroUserId` and `zoteroLibraryType` label the connected rows. `zoteroUserIDLabel` and `zoteroLibraryTypeLabel` label the form rows, as they do today.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/components/ZoteroIntegrationSection.test.tsx`:

```tsx
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/hooks/useZoteroIntegration', () => ({useZoteroIntegration: vi.fn()}));

import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';

type Hook = ReturnType<typeof useZoteroIntegration>;
const INTEGRATION = {
  id: 'z1', user_id: 'u1', zotero_user_id: '1301234353', library_type: 'user', is_active: true,
  last_sync_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};
let hook: Hook;

function mockHook(over: Partial<Hook>) {
  hook = {
    integration: null, isConfigured: false, loading: false, testing: false,
    loadIntegration: vi.fn(), saveCredentials: vi.fn().mockResolvedValue(true),
    testConnection: vi.fn().mockResolvedValue({success: true}), disconnect: vi.fn().mockResolvedValue(true),
    ...over,
  } as unknown as Hook;
  vi.mocked(useZoteroIntegration).mockReturnValue(hook);
}

const renderSection = () => render(<TooltipProvider><ZoteroIntegrationSection /></TooltipProvider>);
const isGhost = (el: HTMLElement) => {
  expect(el).toHaveClass('active:bg-accent/80');
  expect(el).not.toHaveClass('border');
};

beforeEach(() => vi.clearAllMocks());

describe('ZoteroIntegrationSection', () => {
  it('is the Zotero group: h2 title, hint trigger, and the loading line inside it', () => {
    mockHook({loading: true});
    const {container} = renderSection();
    const title = t('user', 'integrationsZoteroTitle');
    expect(screen.getByRole('heading', {level: 2, name: title})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('common', 'fieldHintAria').replace('{{label}}', title)})).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('border-t');
    expect(container.firstElementChild).toHaveTextContent(t('project', 'zoteroLoading'));
  });

  it('connected: label and value sit in separate cells (no "User ID130...353" run-together)', () => {
    mockHook({isConfigured: true, integration: INTEGRATION});
    const {container} = renderSection();
    // No bordered status box (the Connected Badge is rounded-full, not rounded-md).
    expect(container.querySelector('.rounded-md.border')).toBeNull();
    const idLabel = screen.getByText(t('project', 'zoteroUserId'));
    const idValue = screen.getByText('130...353');
    expect(idLabel).toHaveTextContent(/^User ID$/);
    expect(idLabel.parentElement).not.toContainElement(idValue);
    expect(idValue.parentElement).toHaveTextContent(t('project', 'zoteroConnected'));
    const typeLabel = screen.getByText(t('project', 'zoteroLibraryType'));
    const typeValue = screen.getByText('user');
    expect(typeLabel.parentElement).not.toContainElement(typeValue);
    expect(screen.queryByText(t('project', 'zoteroLastSync'))).not.toBeInTheDocument();
  });

  it('connected: Last sync row appears when present; Test connection and Disconnect are ghost', async () => {
    mockHook({isConfigured: true, integration: {...INTEGRATION, last_sync_at: '2026-09-01T10:00:00Z'}});
    renderSection();
    expect(screen.getByText(t('project', 'zoteroLastSync'))).toBeInTheDocument();
    const test = screen.getByRole('button', {name: t('project', 'zoteroTestConnection')});
    isGhost(test);
    await userEvent.click(test);
    expect(hook.testConnection).toHaveBeenCalled();
    const disconnect = screen.getByRole('button', {name: t('project', 'zoteroDisconnect')});
    isGhost(disconnect);
    await userEvent.click(disconnect);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', {name: t('project', 'zoteroDisconnect')}));
    expect(hook.disconnect).toHaveBeenCalled();
  });

  it('not connected: muted intro line, labelled quiet rows with hints, sibling Show/Hide, primary Connect', async () => {
    mockHook({});
    renderSection();
    expect(screen.getByText(t('project', 'zoteroConfigureDesc'))).toHaveClass('text-[13px]', 'text-muted-foreground');
    expect(screen.getByRole('link', {name: t('project', 'zoteroGenerateApiKey')})).toBeInTheDocument();

    const userId = screen.getByLabelText(t('project', 'zoteroUserIDLabel'));
    expect(userId).toHaveAccessibleDescription(t('project', 'zoteroUserIDHint'));
    expect(userId).not.toHaveClass('h-9');
    const howTo = screen.getByRole('link', {name: t('project', 'zoteroHowToFind')});
    expect(screen.getByText(t('project', 'zoteroUserIDLabel'))).not.toContainElement(howTo);

    const apiKey = screen.getByLabelText(t('project', 'zoteroApiKeyLabel'));
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveAccessibleDescription(t('project', 'zoteroApiKeyPermissions'));
    expect(apiKey).not.toHaveClass('pr-20');
    const show = screen.getByRole('button', {name: t('project', 'zoteroShow')});
    expect(show).not.toHaveClass('absolute');
    isGhost(show);
    await userEvent.click(show);
    expect(apiKey).toHaveAttribute('type', 'text');

    expect(screen.getByRole('combobox')).toBe(screen.getByLabelText(t('project', 'zoteroLibraryTypeLabel')));
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'library-type');

    const connect = screen.getByRole('button', {name: t('project', 'zoteroConnect')});
    expect(connect).toHaveClass('bg-primary');
    expect(connect).toBeDisabled();
    await userEvent.type(userId, '123456');
    await userEvent.type(apiKey, 'secret');
    await userEvent.click(connect);
    expect(hook.saveCredentials).toHaveBeenCalledWith({zoteroUserId: '123456', apiKey: 'secret', libraryType: 'user'});
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test:run -- frontend/test/components/ZoteroIntegrationSection.test.tsx`
Expected: FAIL. The loading test passes (Task 12 added the group). The others fail: the connected label and value share one `<p>`, the buttons are `outline`, the How-to link sits inside the label, the inputs have no `aria-describedby`, Show/Hide is `absolute`, and Connect is not `size="sm"`. (Connect's `bg-primary` passes today, since that is its default variant.)

- [ ] **Step 3: Rewrite `ZoteroIntegrationSection.tsx`**

Replace the whole file:

```tsx
/**
 * Zotero integration (Settings → Integrations): one settings group. Connected,
 * it shows the connection's rows and its Test/Disconnect actions; otherwise the
 * credentials form as rows (borderless density pass § 4.3).
 */

import {useState} from 'react';
import {CheckCircle2, ExternalLink, Loader2, Unlink} from 'lucide-react';
import {SettingsActions, SettingsGroup, SettingsRow} from '@/components/settings';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {t} from '@/lib/copy';

const maskUserId = (userId: string) =>
  userId.length <= 6 ? userId : `${userId.slice(0, 3)}...${userId.slice(-3)}`;

export function ZoteroIntegrationSection() {
  const {integration, isConfigured, loading, testing, saveCredentials, testConnection, disconnect} =
    useZoteroIntegration();

  const [formData, setFormData] = useState({
    zoteroUserId: '',
    apiKey: '',
    libraryType: 'user' as 'user' | 'group',
  });
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSaveCredentials = async () => {
    if (!formData.zoteroUserId.trim() || !formData.apiKey.trim()) return;
    const success = await saveCredentials(formData);
    if (success) {
      setFormData({zoteroUserId: '', apiKey: '', libraryType: 'user'});
      setShowApiKey(false);
    }
  };

  const title = t('user', 'integrationsZoteroTitle');
  const hint = t('user', 'integrationsZoteroDescription');

  if (loading && !integration) {
    return (
      <SettingsGroup title={title} hint={hint}>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.5}/>
          {t('project', 'zoteroLoading')}
        </p>
      </SettingsGroup>
    );
  }

  if (isConfigured && integration) {
    return (
      <SettingsGroup title={title} hint={hint}>
        <SettingsRow label={t('project', 'zoteroUserId')}>
          <span className="flex items-center gap-2 px-2 text-[13px]">
            <span className="font-mono">{maskUserId(integration.zotero_user_id)}</span>
            <Badge variant="outline" className="gap-1 text-[11px] font-normal">
              <CheckCircle2 className="h-3 w-3" strokeWidth={1.5}/>
              {t('project', 'zoteroConnected')}
            </Badge>
          </span>
        </SettingsRow>
        <SettingsRow label={t('project', 'zoteroLibraryType')}>
          <span className="px-2 text-[13px] capitalize">{integration.library_type}</span>
        </SettingsRow>
        {integration.last_sync_at && (
          <SettingsRow label={t('project', 'zoteroLastSync')}>
            <span className="px-2 text-[13px]">{new Date(integration.last_sync_at).toLocaleString()}</span>
          </SettingsRow>
        )}
        <SettingsActions>
          <Button variant="ghost" size="sm" onClick={() => void testConnection()} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={1.5}/>
                {t('project', 'zoteroTesting')}
              </>
            ) : (
              t('project', 'zoteroTestConnection')
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                <Unlink strokeWidth={1.5}/>
                {t('project', 'zoteroDisconnect')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('project', 'zoteroDisconnectTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('project', 'zoteroDisconnectDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void disconnect()}>{t('project', 'zoteroDisconnect')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsActions>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={title} hint={hint}>
      <p className="text-[13px] text-muted-foreground">
        {t('project', 'zoteroConfigureDesc')}{' '}
        <a
          href="https://www.zotero.org/settings/keys/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {t('project', 'zoteroGenerateApiKey')}
          <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
        </a>
      </p>
      <SettingsRow label={t('project', 'zoteroUserIDLabel')} htmlFor="zotero-user-id" hint={t('project', 'zoteroUserIDHint')}>
        {({describedBy}) => (
          <div className="space-y-1">
            <Input
              id="zotero-user-id"
              variant="quiet"
              aria-describedby={describedBy}
              placeholder={t('project', 'zoteroUserIDPlaceholder')}
              value={formData.zoteroUserId}
              onChange={(e) => setFormData({...formData, zoteroUserId: e.target.value})}
            />
            <a
              href="https://www.zotero.org/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 text-[12px] text-muted-foreground hover:underline"
            >
              {t('project', 'zoteroHowToFind')}
              <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
            </a>
          </div>
        )}
      </SettingsRow>
      <SettingsRow label={t('project', 'zoteroApiKeyLabel')} htmlFor="api-key" hint={t('project', 'zoteroApiKeyPermissions')}>
        {({describedBy}) => (
          <div className="flex items-center gap-1">
            <Input
              id="api-key"
              variant="quiet"
              aria-describedby={describedBy}
              type={showApiKey ? 'text' : 'password'}
              placeholder="••••••••••••••••••••••••"
              value={formData.apiKey}
              onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? t('project', 'zoteroHide') : t('project', 'zoteroShow')}
            </Button>
          </div>
        )}
      </SettingsRow>
      <SettingsRow label={t('project', 'zoteroLibraryTypeLabel')} htmlFor="library-type">
        <Select
          value={formData.libraryType}
          onValueChange={(value: 'user' | 'group') => setFormData({...formData, libraryType: value})}
        >
          <SelectTrigger id="library-type" variant="quiet">
            <SelectValue/>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">{t('project', 'zoteroPersonalLibrary')}</SelectItem>
            <SelectItem value="group">{t('project', 'zoteroGroupLibrary')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsActions>
        <Button
          size="sm"
          onClick={() => void handleSaveCredentials()}
          disabled={!formData.zoteroUserId.trim() || !formData.apiKey.trim() || loading}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" strokeWidth={1.5}/>
              {t('project', 'zoteroSaving')}
            </>
          ) : (
            t('project', 'zoteroConnect')
          )}
        </Button>
      </SettingsActions>
    </SettingsGroup>
  );
}
```

Two notes on this rewrite. `Button`'s base already sizes icons (`[&_svg]:size-4`) and spaces them (`gap-2`), so the `mr-2 h-4 w-4` on button icons is dropped. The one-line `handleTestConnection` and `handleDisconnect` wrappers are inlined.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test:run -- frontend/test/components/ZoteroIntegrationSection.test.tsx frontend/test/components/IntegrationsSection.test.tsx`
Expected: PASS (4 + 1).

- [ ] **Step 5: Tighten the button-scale baseline by hand**

Run: `python3 scripts/fitness/check_button_scale.py --baseline /dev/null 2>&1 | grep ZoteroIntegrationSection`
Expected: no output. The file no longer has a Button `h-*` override: the three `h-9` and the Show/Hide `h-7` are gone.
Edit `scripts/fitness/check_button_scale.baseline`: delete the line `frontend/components/project/settings/ZoteroIntegrationSection.tsx:4`. Change no other line, and never pass `--update-baseline`. If the grep prints a count N > 0, change the entry to N instead.
Run: `python3 scripts/fitness/check_button_scale.py`
Expected: `OK`.

- [ ] **Step 6: Confirm the frames and copy keys**

Run: `grep -n "rounded-md border\|absolute\|pr-20\|h-9\|ui/label" frontend/components/project/settings/ZoteroIntegrationSection.tsx`
Expected: no output.

Run: `grep -rn "zoteroUserId\b\|zoteroLibraryType\b\|zoteroLastSync\|zoteroHowToFind\|zoteroShow\|zoteroHide\|zoteroLoading" frontend/components`
Expected: each key has at least one hit in `ZoteroIntegrationSection.tsx`. No copy key was removed from `frontend/lib/copy/project.ts`.

- [ ] **Step 7: Gates**

Run each and read the tail: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green, knip zero findings. The file is under 800 lines.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/project/settings/ZoteroIntegrationSection.tsx frontend/test/components/ZoteroIntegrationSection.test.tsx scripts/fitness/check_button_scale.baseline
```

```bash
git commit -m "refactor(settings): Zotero as a flat group of rows

Connected: User ID (masked, Connected badge inline), Library type and
Last sync as label/value rows, ghost Test connection and Disconnect.
Not connected: muted intro line and quiet rows with hints; Show/Hide is
a sibling of the key input, not absolutely positioned. Fixes the label
and value running together. Drops the file's button-scale entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Retire `SettingsCard`/`SettingsField` + `settings-frame` rule + retired symbols

**Files:**
- Delete: `frontend/components/settings/SettingsCard.tsx`, `frontend/components/settings/SettingsField.tsx`
- Modify: `frontend/components/settings/index.ts` (the two export lines)
- Modify: `scripts/fitness/check_ui_primitives.py:4-22` (docstring), `:48-87` (constants + `GUIDANCE`), `:90-115` (`scan_file`)
- Modify: `backend/tests/unit/scripts/test_check_ui_primitives_canary.py:35-83` (`VIOLATIONS`, `ALLOWED`)
- Modify: `scripts/fitness/check_retired_symbols.py:4` (module docstring), `:45` (class docstring), `:52-131` (`RETIRED`: existing labels + 2 entries), `:259-262` (finding), `:285-289` (failure text)
- Create: `backend/tests/unit/scripts/test_check_retired_symbols.py`
- Modify: `knip.jsonc` (delete Task 2b's temporary `ignoreIssues` block if it is still present)

**Interfaces:**
- Consumes: every earlier task. Tasks 4, 6, 7, 8a, 8b, 10, 11a and 11b remove the `SettingsCard`/`SettingsField` callers (11b the last of both). Tasks 3-13 remove every frame the new rule flags. Task 2b's temporary knip block, if still present.
- Produces: `check_ui_primitives.py` rule id `settings-frame`, and `check_retired_symbols.py` entries `SettingsCard` and `SettingsField`. PR 2 extends both: it adds the article paths to `SETTINGS_FRAME_SCOPE` and a `SettingsSection` entry.

**How the Python tests run.** `backend/tests/conftest.py` imports app settings that need `backend/.env` (without it: pydantic `DATABASE_URL Field required`). The script tests use only `tmp_path` and subprocesses, so run them with `--noconftest`. No database is needed. This was verified on `58b8df28`: `uv run --directory backend pytest tests/unit/scripts/test_check_ui_primitives_canary.py -q -p no:cacheprovider --noconftest` → `20 passed`. CI runs them inside the full `uv run pytest tests/` job.

**Baseline for the new rule.** A prototype of the rule, run on `58b8df28`, flagged exactly these files: `PicotsPane.tsx` (Task 5), `AiEngineSection.tsx` (6), `BasicInfoSection.tsx` (4), `ConsensusConfigForm.tsx` (8a), `ReviewConsensusSection.tsx` (8b), `TeamMembersSection.tsx` (7), `TemplateConsensusOverride.tsx` (9), `ZoteroIntegrationSection.tsx` (13), `SettingsCard.tsx` (this task), `TagInput.tsx` (3), `AiConnectionsSection.tsx` (12), `SecuritySection.tsx` (11b). After those tasks it must flag nothing. `check_ui_primitives.py` has no baseline file, and `test_check_ui_primitives.py::test_baseline_file_is_gone` forbids adding one. So a finding here is a gap in an earlier task, not something to baseline.

- [ ] **Step 1: Prove zero callers before deleting**

Run: `grep -rn "SettingsCard\|SettingsField" frontend --include="*.ts" --include="*.tsx"`
Expected, and only these:
- `frontend/components/settings/index.ts` (2 export lines)
- `frontend/components/settings/SettingsCard.tsx`, `frontend/components/settings/SettingsField.tsx`
- two comment-only lines: `frontend/test/SecuritySection.validation.test.tsx` (`// SettingsField's htmlFor …`, which Task 11b leaves unchanged) and `frontend/components/articles/ArticleKeywordsField.tsx:12` (JSDoc). `check_retired_symbols.py` strips comments before matching, so neither one fails the gate. Leave both: the test must stay unchanged, and the article panel is PR 2.

**If any other file appears, STOP.** An earlier task is incomplete. Report the file and line to the orchestrator; do not migrate it here.

- [ ] **Step 2: Write the failing canary cases for `settings-frame`**

In `backend/tests/unit/scripts/test_check_ui_primitives_canary.py`, append to `VIOLATIONS` (before its closing `]`):

```python
    (
        "settings-frame",
        "frontend/components/project/settings/X.tsx",
        "import {Card} from '@/components/ui/card';",
    ),
    (
        "settings-frame",
        "frontend/components/user/X.tsx",
        'import {Alert, AlertDescription} from "@/components/ui/alert";',
    ),
    (
        "settings-frame",
        "frontend/components/project/settings/X.tsx",
        "import {Alert} from '../../ui/alert';",
    ),
    (
        "settings-frame",
        "frontend/components/settings/X.tsx",
        'import {Card} from "../ui/card";',
    ),
    (
        "settings-frame",
        "frontend/components/project/PicotsPane.tsx",
        '<pre className="rounded-md border border-border/50 p-2">x</pre>',
    ),
    (
        "settings-frame",
        "frontend/components/settings/x.ts",
        "export const box = cn('flex border-dashed rounded-lg');",
    ),
```

Append to `ALLOWED` (before its closing `]`):

```python
    ("frontend/components/quality/X.tsx", "import {Card} from '@/components/ui/card';"),
    ("frontend/components/articles/X.tsx", 'import {Alert} from "../ui/alert";'),
    ("frontend/components/quality/X.tsx", '<div className="rounded-md border p-3" />'),
    (
        "frontend/components/project/settings/X.tsx",
        '<div className="border-t border-border/40 rounded-md pt-4" />',
    ),
    (
        "frontend/components/user/X.tsx",
        "import {AlertDialog} from '@/components/ui/alert-dialog';",
    ),
    (
        "frontend/components/settings/X.tsx",
        '// <div className="rounded-md border"> in a comment\nexport const a = 1;',
    ),
    (
        "frontend/components/project/settings/X.test.tsx",
        "import {Card} from '@/components/ui/card';",
    ),
```

- [ ] **Step 3: Run the canary and confirm the new cases fail**

Run: `uv run --directory backend pytest tests/unit/scripts/test_check_ui_primitives_canary.py -q -p no:cacheprovider --noconftest`
Expected: 6 FAILED, all `test_violation_fails[settings-frame-…]` (exit 0, not 1). Every ALLOWED case passes.

- [ ] **Step 4: Implement `settings-frame` in `check_ui_primitives.py`**

Docstring: change `Four interaction-primitive rules` (line 4) to `Interaction-primitive rules`. After the `overlay-size` bullet (line 19) insert:

```python
* ``settings-frame`` — in the settings surfaces (``SETTINGS_FRAME_SCOPE``), an
  import of ``ui/card`` or ``ui/alert`` (alias or relative, either quote), or
  one string literal holding an all-sides ``border``/``border-dashed`` token
  together with a ``rounded*`` token: the raw framed box. Settings are flat
  groups and rows (docs/superpowers/specs/2026-09-13-borderless-density-pass-
  design.md § 6).
```

After `TOKEN = …` (line 80) add:

```python
SETTINGS_FRAME_SCOPE = (
    "frontend/components/project/settings/",
    "frontend/components/user/",
    "frontend/components/settings/",
    "frontend/components/project/PicotsPane.tsx",
)
FRAME_IMPORT = re.compile(
    r"""\bfrom\s+(["'])(?:@/components/ui/|(?:\.{1,2}/)+(?:components/)?ui/)(?:card|alert)\1"""
)
STRING_LITERAL = re.compile(r""""([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`""")
BORDER_ALL_SIDES = {"border", "border-dashed"}
```

Add to `GUIDANCE`:

```python
    "settings-frame": "no card, callout or bordered box on settings surfaces; use SettingsGroup/SettingsRow",
```

Add a helper above `scan_file`:

```python
def is_framed_box(literal: str) -> bool:
    """One class string with an all-sides border AND a radius: a raw frame."""
    bases = [split_variants(tok)[1] for tok in literal.split()]
    return any(b in BORDER_ALL_SIDES for b in bases) and any(
        b == "rounded" or b.startswith("rounded-") for b in bases
    )
```

In `scan_file`, before `for tok in TOKEN.findall(src):` (line 111) add:

```python
    if rel.startswith(SETTINGS_FRAME_SCOPE):
        for _ in FRAME_IMPORT.finditer(src):
            bump("settings-frame")
        for line in src.splitlines():
            for m in STRING_LITERAL.finditer(line):
                if is_framed_box(next(g for g in m.groups() if g is not None)):
                    bump("settings-frame")
```

(`src` is already comment-stripped. Literals are matched per line, so a stray apostrophe in JSX text cannot pair quotes across lines. `alert-dialog` does not match, because the closing quote must follow `card`/`alert` directly.)

- [ ] **Step 5: Run the canary and the green-path test**

Run: `uv run --directory backend pytest tests/unit/scripts/test_check_ui_primitives_canary.py tests/unit/scripts/test_check_ui_primitives.py -q -p no:cacheprovider --noconftest`
Expected: all pass. The canary has 20 + 13 cases. `test_check_ui_primitives.py` has 3 tests, including `test_tree_is_clean_with_no_baseline` → `OK (0 `. If that test fails with `settings-frame` on a real file, apart from `SettingsCard.tsx` (deleted in Step 7), STOP and report the file: an earlier task left a frame.

- [ ] **Step 6: Write the failing retired-symbols test**

Create `backend/tests/unit/scripts/test_check_retired_symbols.py`:

```python
"""check_retired_symbols.py: a retired settings component must not come back.

The symbol names are built by concatenation: this file sits under backend/tests,
which the gate scans, and a literal name in code here would fail it.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_retired_symbols.py"
CARD = "Settings" + "Card"
FIELD = "Settings" + "Field"
SLICE = "borderless density pass PR 1"


def _run(root: Path | None = None) -> subprocess.CompletedProcess[str]:
    args = [sys.executable, str(CHECK)]
    if root is not None:
        args += ["--repo-root", str(root)]
    return subprocess.run(args, capture_output=True, text=True, timeout=60)


def _plant(root: Path, rel: str, body: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def test_flags_a_retired_settings_card_import(tmp_path: Path) -> None:
    _plant(tmp_path, "frontend/components/user/X.tsx", f"import {{{CARD}}} from '@/components/settings';\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert f"frontend/components/user/X.tsx:1  {CARD}" in proc.stdout
    assert f"retired in {SLICE}" in proc.stdout
    assert "entry-group trees train" not in proc.stdout


def test_flags_settings_field_usage(tmp_path: Path) -> None:
    _plant(tmp_path, "frontend/components/project/settings/X.tsx", f"<{FIELD} label='x'/>\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert FIELD in proc.stdout


def test_prose_mentions_and_longer_names_pass(tmp_path: Path) -> None:
    _plant(
        tmp_path,
        "frontend/components/user/X.tsx",
        f"// {CARD} used to wrap this group\nexport type {CARD}Props = never;\n",
    )
    assert _run(tmp_path).returncode == 0


def test_the_real_tree_is_clean() -> None:
    proc = _run()
    assert proc.returncode == 0, proc.stdout
    assert "none present" in proc.stdout
```

Run: `uv run --directory backend pytest tests/unit/scripts/test_check_retired_symbols.py -q -p no:cacheprovider --noconftest`
Expected: FAIL. `test_flags_a_retired_settings_card_import` and `test_flags_settings_field_usage` fail with exit 0 (the symbols are not retired yet). `test_prose_mentions_and_longer_names_pass` passes. `test_the_real_tree_is_clean` passes.

- [ ] **Step 7: Delete the components and their exports**

```bash
git rm frontend/components/settings/SettingsCard.tsx frontend/components/settings/SettingsField.tsx
```

In `frontend/components/settings/index.ts`, delete exactly `export {SettingsField} from './SettingsField';` and `export {SettingsCard} from './SettingsCard';`, (Task 2b's rewrite already dropped the stray `;` line). Leave every other export as Task 2b wrote it.
Run: `grep -n "Settings" frontend/components/settings/index.ts`
Expected: `SettingsSection`, `SettingsPage`, `SettingsGroup`, `SettingsRow`, `SettingsActions` exports only.

- [ ] **Step 8: Remove the temporary knip entry**

Task 2b's `ignoreIssues` block silenced the settings primitives' exports and, from Task 11b on, the `SettingsCard`/`SettingsField` re-exports that Step 7 just deleted. A task after 11b may already have removed it (Task 2b, "Removing the block").

Run: `grep -n "TEMPORARY (borderless density pass PR 1" knip.jsonc`
If it prints a line, delete that comment block and the `"ignoreIssues": {…},` object under it, and leave every other entry byte-for-byte.
Run: `grep -n "ignoreIssues" knip.jsonc`
Expected: no output.
Run: `npx knip --production --no-tag-hints` then `npx knip --no-tag-hints`
Expected: no output from either. A finding is a real orphan: a settings primitive or export with no production caller means an earlier task did not adopt it. Report the file and line; never restore the entry.

- [ ] **Step 9: Retire the symbols and generalize the messages**

In `scripts/fitness/check_retired_symbols.py`:

Line 4 becomes:

```python
Names concepts a spec or train retired, and fails if one comes back.
```

Line 45 (class docstring) becomes:

```python
    """One retired symbol: the spec or PR that retired it (``slice_``), and why it must not return."""
```

In `RETIRED`, change the labels of the existing entries so the generalized finding still names their train: `"B5"` → `"entry-group trees B5"`, `"B6"` → `"entry-group trees B6"`, `"B2"` → `"entry-group trees B2"` (15 entries, values only). Then append before the closing `)`:

```python
    # Borderless density pass (docs/superpowers/specs/2026-09-13-borderless-density-pass-design.md § 6).
    Retired(
        "SettingsCard",
        "borderless density pass PR 1",
        "settings are flat SettingsGroup/SettingsRow grids; a card frame is what the spec removed",
    ),
    Retired(
        "SettingsField",
        "borderless density pass PR 1",
        "SettingsRow owns the label/value row, its hint and its aria-describedby",
    ),
```

Lines 259-262 (finding):

```python
                    findings.append(
                        f"{rel}:{lineno}  {retired.symbol}  "
                        f"(retired in {retired.slice_}: {retired.why})"
                    )
```

Lines 285-289 (failure text):

```python
        print(
            "\nEach was retired by the spec or train its label names, and there is "
            "no baseline to add to. If a spec change genuinely brings one back, "
            "edit RETIRED in this file in the same diff, with the reason."
        )
```

- [ ] **Step 10: Run both script tests and the gates' own scripts**

Run: `uv run --directory backend pytest tests/unit/scripts/test_check_retired_symbols.py tests/unit/scripts/test_check_ui_primitives_canary.py tests/unit/scripts/test_check_ui_primitives.py -q -p no:cacheprovider --noconftest`
Expected: all pass (4 + 33 + 3).
Run: `python3 scripts/fitness/check_retired_symbols.py`
Expected: `check_retired_symbols: OK (… ms; 17 retired symbols, none present)`.
Run: `python3 scripts/fitness/check_ui_primitives.py`
Expected: `check_ui_primitives: OK (0 baselined entr(y/ies))`.

- [ ] **Step 11: Final sweep: §4.4 PR 1 copy deletions**

Each command must print nothing. A hit means the key still exists; `grep -rn "<key>" frontend/` then shows whether the owning task (4-11) left a reference or forgot the deletion. Report it; do not fix another task's surface here.

Run: `grep -nwE "basicSectionTitle|basicSectionDesc|basicCardIdentification|basicCardIdentificationDesc|basicReviewTypeCardTitle|basicReviewTypeCardDesc|basicPicotsEnabledTitle|basicPicotsEnabledDesc|reviewSectionTitle|reviewSectionDesc|reviewCardGeneralDesc|reviewCardSearchDesc|picotsHelpAria|teamSectionTitle|teamSectionDesc|teamCardAddDesc|teamCardMembersDesc|advancedSectionTitle|advancedSectionDesc|advancedCardEligibilityTitle|advancedCardEligibilityDesc|advancedCardParsingDesc|advancedCardDangerDesc" frontend/lib/copy/project.ts`
Run: `grep -nwE "sectionTitle" frontend/lib/copy/aiContext.ts`
Run: `grep -nwE "cardTitle" frontend/lib/copy/llmConnections.ts`
Run: `grep -nwE "sectionTitle|sectionDesc|managerVisibilityCardTitle|managerVisibilityCardDesc|projectDefaultUsingSystem" frontend/lib/copy/consensus.ts`
Run: `grep -nwE "profileTitle|profileDescription|profileCardTitle|profileCardDescription|profileEmailAria|securityTitle|securityDescription|securityCardTitle|securityCardDescription|securityNewPasswordHint|securityConfirmHint" frontend/lib/copy/user.ts`
Expected: no output from any of the five. `aiContext.sectionDesc`, `llmConnections.cardDescription` and `llmConnections.sharedDescription` are kept on purpose (intro line and hints), so they are not in the patterns.

Run: `grep -n "tabConsensusDesc\|highQualityHint" frontend/lib/copy/consensus.ts frontend/lib/copy/parsing.ts`
Expected: `tabConsensusDesc: 'Consensus rule and arbitrator'` and a `highQualityHint` that contains `Applies to newly ingested PDFs.`

- [ ] **Step 12: Gates (full)**

Run each and read the tail: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh`.
Expected: all green, knip zero findings. `ui/card.tsx` and `ui/alert.tsx` keep importers outside the scope (`ErrorBoundary.tsx`, `QualityAssessmentInterface.tsx`, `AddProjectDialog.tsx`, …), so knip reports no orphaned file. `run_all.sh` summary: `check_ui_primitives.py: OK`, `check_retired_symbols.py: OK`, `check_copy_keys.py: OK`, `check_button_scale.py: OK`, `check_file_size.py: OK`.

- [ ] **Step 13: Commit**

```bash
git add knip.jsonc frontend/components/settings/index.ts scripts/fitness/check_ui_primitives.py scripts/fitness/check_retired_symbols.py backend/tests/unit/scripts/test_check_ui_primitives_canary.py backend/tests/unit/scripts/test_check_retired_symbols.py
```

```bash
git commit -m "chore(settings): retire SettingsCard and SettingsField behind fitness gates

Deletes both components. check_ui_primitives gains settings-frame: card
or alert imports and border+rounded class strings on settings surfaces,
starting at zero. check_retired_symbols retires both names; its messages
now name each entry's own spec or train instead of the trees train. The
temporary knip.jsonc ignoreIssues entry from Task 2b is gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Browser verification against §7

**Files:**
- Create (gitignored, not committed): `.superpowers/sdd/2026-09-13-borderless-density-pass-settings/verify/measure.mjs`; output goes to `…/verify/out/`
- App code: none, unless a pass criterion fails (Step 9)

**Interfaces:**
- Consumes: the finished branch (Tasks 1-14). The base commit `58b8df28` is "before".
- Produces: `verify/out/verdict.txt`, `verify/out/results.json` and the PNG captures, for the ledger and the PR body.

**Pages (every in-scope settings view).** Project settings: `/projects/5b9d8976-6da5-45e4-84a5-380a40fdbb0b?tab=settings&section=<id>` for `basic`, `review`, `review-question`, `ai-engine`, `team`, `consensus` and `advanced` (`SECTIONS` in `frontend/components/project/ProjectSettings.tsx:50-73`; `tab` is read by `useShellLocation`). User settings: `/settings?tab=<id>` for `profile`, `security` and `integrations` (`TABS` in `frontend/pages/UserSettings.tsx:29-33`). `SCRATCH` below means your session scratchpad directory, as an absolute path.

- [ ] **Step 1: Environment. Local only, never prod**

Run: `grep -o "^SUPABASE_ENV=[a-z]*\|^DEBUG=[a-z]*" /Users/raphael/PycharmProjects/prumo/backend/.env`
Expected: `SUPABASE_ENV=local` and `DEBUG=true`. **If either differs, STOP.**
Run: `grep -o "^VITE_SUPABASE_URL=http://[0-9.:]*\|^VITE_API_URL=http://[0-9.:]*" /Users/raphael/PycharmProjects/prumo/.env`
Expected: `http://127.0.0.1:54321` and `http://127.0.0.1:8000`. **Anything else: STOP.**
Then copy each file with its own command: `cp /Users/raphael/PycharmProjects/prumo/.env .env` and `cp /Users/raphael/PycharmProjects/prumo/backend/.env backend/.env`.
Run: `lsof -nP -iTCP:54321 -sTCP:LISTEN`
Expected: a listener (local Supabase is up). It is shared with other sessions; never reset it.

- [ ] **Step 2: Backend (unchanged by this PR, so one serves both sides)**

Run: `git diff --stat 58b8df28 HEAD -- backend/app`
Expected: no output.
Run: `lsof -nP -iTCP:8000 -sTCP:LISTEN`. If it prints a listener, it belongs to another session: leave it alone and use port 8001 below. If not, you may use 8000. The steps below assume 8001 (`API`).
Start it in the background (`run_in_background`): `env -u DATABASE_URL -u DIRECT_DATABASE_URL -u SUPABASE_DATABASE_URL uv run --directory backend uvicorn app.main:app --port 8001`. This is `make backend-start` without `--reload`.
Run: `curl -s http://127.0.0.1:8001/health`
Expected: a JSON health body.

- [ ] **Step 3: "Before" checkout and both Vite servers. Never `git stash`**

Run: `git worktree add --detach SCRATCH/before 58b8df28`
Run: `cp -cR node_modules SCRATCH/before/node_modules` (APFS clone: fast, no network, and its own `.vite` cache)
Run: `rm -rf SCRATCH/before/node_modules/.vite`
Run: `cp .env SCRATCH/before/.env`
Run: `rm -rf node_modules/.vite` (in this worktree: a shared transform cache serves stale modules)
Start both in the background, each as its own command:
- `VITE_API_URL=http://127.0.0.1:8001 npm --prefix SCRATCH/before run dev -- --port 8091 --strictPort`
- `VITE_API_URL=http://127.0.0.1:8001 npm run dev -- --port 8092 --strictPort`

Check what each server actually serves, not what is on disk:
Run: `curl -s http://127.0.0.1:8091/frontend/components/user/IntegrationsSection.tsx | grep -c SettingsSection`
Expected: `≥1` (before).
Run: `curl -s http://127.0.0.1:8092/frontend/components/user/IntegrationsSection.tsx | grep -c SettingsPage`
Expected: `≥1` (after).
Run: `curl -s -o /dev/null -w "%{http_code}" -X OPTIONS http://127.0.0.1:8001/api/v1/me/connections -H "Origin: http://127.0.0.1:8092" -H "Access-Control-Request-Method: GET"`
Expected: `200`. `DEBUG=true` allows any localhost port. A 400 here means CORS, not an app bug.

- [ ] **Step 4: Fixtures and the unchanged e2e**

Run: `E2E_FRONTEND_URL=http://127.0.0.1:8092 E2E_API_URL=http://127.0.0.1:8001 npx playwright test frontend/e2e/flows/settings-connections.e2e.ts --project=local-api --workers 1`
Expected: `2 passed`. Global setup also provisions the fixture owner that Step 6 logs in as, and the passing run proves `getByRole('heading', {name: 'AI connections'})` still resolves. If every test fails at 0 ms with `Executable doesn't exist`, the Playwright browser is not cached. Ask the user before running `npx playwright install --only-shell chromium` (a ~99 MB download).

- [ ] **Step 5: Write the measurement script**

Create `.superpowers/sdd/2026-09-13-borderless-density-pass-settings/verify/measure.mjs`. Node resolves `@playwright/test` from the worktree's `node_modules`. Credentials are read from `fixture-ids.ts`; never type a password into a browser pane.

```js
// Borderless density pass PR 1: §7 before/after measurement (spec 2026-09-13).
// Usage: node measure.mjs <beforeOrigin> <afterOrigin> <outDir>
import {chromium} from '@playwright/test';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const [BEFORE, AFTER, OUT] = process.argv.slice(2);
if (!BEFORE || !AFTER || !OUT) throw new Error('usage: node measure.mjs <before> <after> <outDir>');
const WT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ids = readFileSync(join(WT, 'frontend/e2e/_fixtures/fixture-ids.ts'), 'utf8');
const pick = (name) => ids.match(new RegExp(`export const ${name} = "([^"]+)"`))[1];
const EMAIL = pick('OWNER_EMAIL');
const PASSWORD = pick('FIXTURE_PASSWORD');
const PID = pick('PROJECT_ID');
mkdirSync(OUT, {recursive: true});

const PAGES = [
  ...['basic', 'review', 'review-question', 'ai-engine', 'team', 'consensus', 'advanced'].map((s) => ({
    name: `project-${s}`, path: `/projects/${PID}?tab=settings&section=${s}`,
  })),
  ...['profile', 'security', 'integrations'].map((s) => ({name: `user-${s}`, path: `/settings?tab=${s}`})),
];
const WIDTHS = [1920, 1280, 768, 390];
const HINT = 'main button[aria-label^="About "]';
const POPPER = '[data-radix-popper-content-wrapper]';

async function login(browser, origin) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await ctx.newPage();
  await page.goto(`${origin}/auth`);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.locator("form button[type='submit']").click();
  await page.waitForURL(/\/$/, {timeout: 30000});
  const file = join(OUT, `state-${new URL(origin).port}.json`);
  await ctx.storageState({path: file});
  await ctx.close();
  return file;
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse, main .animate-spin'), null, {timeout: 20000});
  await page.waitForTimeout(300);
}

// Runs in the page: every §7 number for the current viewport, scoped to the innermost <main>.
const AUDIT = () => {
  const mains = document.querySelectorAll('main');
  const main = mains[mains.length - 1];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 80)}`;
  const EXEMPT = 'input,textarea,select,[role=combobox],[role=switch],[role=checkbox],[role=radio],[role=dialog],[role=alertdialog],[data-radix-popper-content-wrapper],.rounded-full';
  const alpha = (c) => (c === 'transparent' ? 0 : c.startsWith('rgba') ? Number(c.split(',')[3].replace(')', '')) : 1);
  const frames = [];
  for (const el of main.querySelectorAll('*')) {
    if (!visible(el) || el.closest(EXEMPT)) continue;
    const cs = getComputedStyle(el);
    if (['Top', 'Right', 'Bottom', 'Left'].every((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && alpha(cs[`border${s}Color`]) > 0)) {
      frames.push(describe(el));
    }
  }
  const column = main.querySelector('.max-w-3xl');
  const body = main.firstElementChild;
  const bcs = getComputedStyle(body);
  const typeOff = [...main.querySelectorAll('label,input:not([type=hidden]),textarea,[role=combobox]')]
    .filter((el) => visible(el) && !el.closest('.sr-only') && getComputedStyle(el).fontSize !== '13px')
    .map((el) => `${describe(el)} ${getComputedStyle(el).fontSize}`);
  const smallTargets = [...main.querySelectorAll('button,[role=button],a[href],input:not([type=hidden]),select,textarea,[role=switch],[role=combobox]')]
    .filter((el) => visible(el) && !el.matches('input.sr-only'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
    .map((el) => `${el.tagName.toLowerCase()}|${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40)}`);
  return {
    frames,
    columnWidth: column ? Math.round(column.getBoundingClientRect().width) : null,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth || main.scrollWidth > main.clientWidth,
    // Content height without the view's gutter, so a gutter change cannot fake density.
    bodyHeight: Math.round(body.getBoundingClientRect().height - parseFloat(bcs.paddingTop) - parseFloat(bcs.paddingBottom)),
    fields: [...main.querySelectorAll('input:not([type=hidden]),textarea,[role=combobox],[role=switch]')].filter(visible).length,
    typeOff,
    smallTargets,
  };
};

const browser = await chromium.launch();
const states = {before: await login(browser, BEFORE), after: await login(browser, AFTER)};
const results = {};
for (const [side, origin] of [['before', BEFORE], ['after', AFTER]]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({storageState: states[side], viewport: {width, height: 1000}, colorScheme: 'light'});
    await ctx.addInitScript(() => localStorage.removeItem('prumo:theme'));
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(`${origin}${p.path}`);
      await settle(page);
      results[`${side}|${p.name}|${width}`] = await page.evaluate(AUDIT);
      await page.screenshot({path: join(OUT, `${side}-${p.name}-${width}.png`), fullPage: true});
    }
    await ctx.close();
  }
}

for (const [side, origin] of [['before', BEFORE], ['after', AFTER]]) {
  const ctx = await browser.newContext({storageState: states[side], viewport: {width: 1280, height: 1000}, colorScheme: 'dark'});
  await ctx.addInitScript(() => localStorage.removeItem('prumo:theme'));
  const page = await ctx.newPage();
  await page.goto(`${origin}/settings?tab=integrations`);
  await settle(page);
  await page.screenshot({path: join(OUT, `${side}-user-integrations-1280-dark.png`), fullPage: true});
  await ctx.close();
}

{ // After only, 1280, fine pointer: quiet input hover/focus, hint tooltip, focused invalid field.
  const ctx = await browser.newContext({storageState: states.after, viewport: {width: 1280, height: 1000}});
  const page = await ctx.newPage();
  await page.goto(`${AFTER}/projects/${PID}?tab=settings&section=basic`);
  await settle(page);
  const input = page.locator('main input:not([type=hidden])').first();
  await input.hover();
  await page.screenshot({path: join(OUT, 'after-quiet-input-hover.png')});
  await input.focus();
  await page.screenshot({path: join(OUT, 'after-quiet-input-focus.png')});
  await page.locator(HINT).first().hover();
  await page.locator(POPPER).first().waitFor();
  await page.screenshot({path: join(OUT, 'after-hint-tooltip.png')});
  // A one-character password fails client validation, so no request is sent.
  await page.goto(`${AFTER}/settings?tab=security`);
  await settle(page);
  const pw = page.locator('main input[type=password]').first();
  await pw.fill('a');
  await page.locator('main button[type=submit]').click();
  await page.locator('main [aria-invalid=true]').first().waitFor();
  await pw.focus();
  await page.screenshot({path: join(OUT, 'after-invalid-focused.png')});
  await ctx.close();
}

{ // Touch at 390: the hint is a popover opened by tap.
  const ctx = await browser.newContext({storageState: states.after, viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  const page = await ctx.newPage();
  await page.goto(`${AFTER}/projects/${PID}?tab=settings&section=basic`);
  await settle(page);
  results.coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  await page.locator(HINT).first().tap();
  await page.locator(POPPER).first().waitFor();
  await page.screenshot({path: join(OUT, 'after-hint-popover-touch-390.png')});
  await ctx.close();
}
await browser.close();

const verdict = [];
const fail = (msg) => verdict.push(`FAIL ${msg}`);
for (const p of PAGES) {
  const a = (w) => results[`after|${p.name}|${w}`];
  const b = (w) => results[`before|${p.name}|${w}`];
  for (const w of WIDTHS) if (a(w).frames.length) fail(`${p.name}@${w} frames: ${a(w).frames.join(' ; ')}`);
  if (a(1920).columnWidth !== 768) fail(`${p.name}@1920 column ${a(1920).columnWidth}px, want 768`);
  for (const w of [390, 768]) if (a(w).hScroll) fail(`${p.name}@${w} horizontal scroll`);
  // Same field set on both sides: count it once (before) so plain-text rows cannot skew the ratio.
  const n = Math.max(b(1280).fields, 1);
  const dBefore = b(1280).bodyHeight / n;
  const dAfter = a(1280).bodyHeight / n;
  verdict.push(`${p.name} px/field before=${dBefore.toFixed(1)} after=${dAfter.toFixed(1)} (fields=${n})`);
  if (!(dAfter < dBefore)) fail(`${p.name} density not lower`);
  if (a(1280).typeOff.length) fail(`${p.name}@1280 not 13px: ${a(1280).typeOff.join(' ; ')}`);
  const newSmall = a(1280).smallTargets.filter((x) => !b(1280).smallTargets.includes(x));
  if (newSmall.length) fail(`${p.name}@1280 new targets <24px: ${newSmall.join(' ; ')}`);
}
if (results.coarsePointer !== true) fail('touch context did not match (pointer: coarse)');
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, 'verdict.txt'), verdict.join('\n') + '\n');
console.log(verdict.join('\n'));
process.exit(verdict.some((l) => l.startsWith('FAIL')) ? 1 : 0);
```

Run: `node --check .superpowers/sdd/2026-09-13-borderless-density-pass-settings/verify/measure.mjs`
Expected: no output (the syntax is valid).

- [ ] **Step 6: Measure**

Run: `node .superpowers/sdd/2026-09-13-borderless-density-pass-settings/verify/measure.mjs http://127.0.0.1:8091 http://127.0.0.1:8092 .superpowers/sdd/2026-09-13-borderless-density-pass-settings/verify/out`
Expected: exit 0. There are 10 `px/field` lines, each with `after < before`, and no `FAIL` line. The output directory gets 80 page PNGs (2 sides × 10 pages × 4 widths), 2 dark PNGs and 5 state captures.

**Pass criteria (§7), as the script checks them:**
- **Frames:** zero elements in `<main>` with a visible border on all four sides. Exempt: form controls, switches, checkboxes, `rounded-full` (badges, avatars, the switch track), dialogs and poppers. Checked at every width.
- **Width:** the `.max-w-3xl` column is 768px at 1920.
- **Overflow:** no horizontal scroll at 390 and 768.
- **Density:** content height ÷ field count at 1280 is lower than before on every page, with the same count on both sides.
- **Type:** every visible `label`, `input`, `textarea` and select trigger is 13px at 1280.
- **Targets:** no target under 24×24 at 1280 on a fine pointer that did not already exist before.

- [ ] **Step 7: Look at the captures (`design-review`)**

Read with the Read tool:
- `after-user-integrations-1280.png` and `before-user-integrations-1280.png`
- `after-project-team-390.png`
- `after-project-basic-1920.png`
- `after-user-integrations-1280-dark.png`
- `after-quiet-input-hover.png`, `after-quiet-input-focus.png`
- `after-invalid-focused.png` (2px focus ring kept while invalid)
- `after-hint-tooltip.png`, `after-hint-popover-touch-390.png`

Confirm:
- one hairline per group boundary, and none above the first group;
- right-aligned labels at 1280 and stacked labels at 390;
- in dark mode, an empty quiet input still reads as editable on hover and focus (§8);
- Zotero's "User ID" and its value sit in separate columns.

- [ ] **Step 8: Record**

Paste `verify/out/verdict.txt` and the capture list into the ledger (`.superpowers/sdd/2026-09-13-borderless-density-pass-settings/progress.md`) and into your report. No commit: `verify/` is gitignored (`.gitignore:178 .superpowers/`).

- [ ] **Step 9: Only if a criterion fails**

1. Load `debugging`.
2. Reproduce the failure on one page.
3. Write a failing Vitest class-contract test for the offending component.
4. Fix the component, run the task gates (`npm run test:run`, `npm run typecheck`, `npm run lint`, both knip modes, `bash scripts/fitness/run_all.sh`), and commit it as its own commit: `fix(settings): <what the measurement caught>`, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
5. Re-run Step 6.

A false positive is triaged in the script, not the app. For example, an element type the spec exempts but `EXEMPT` misses: extend `EXEMPT` and give the reason in the report.

- [ ] **Step 10: Teardown (only what you started)**

Stop the two Vite servers (ports 8091 and 8092) and the backend (port 8001). Find each PID with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and confirm its cwd with `lsof -a -p <pid> -d cwd` before `kill <pid>`.
Run: `git worktree remove --force SCRATCH/before`
Run: `git worktree list`
Expected: no `SCRATCH/before` entry.
