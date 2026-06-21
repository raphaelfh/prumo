---
name: ui-styling
description: Tailwind + shadcn/ui + Radix mechanics for the prumo frontend (Vite + React 19 + TS strict). Use whenever you are adding or editing a `frontend/components/**/*.tsx` file, installing a new shadcn primitive, writing className strings, building a cva variant, touching `frontend/index.css` / `tailwind.config.ts` / `components.json`, wiring dark mode, fixing a contrast/focus/keyboard a11y bug, or hand-rolling a Radix primitive. Be a little pushy: if you are about to write JSX with classes, read this first — it will stop you from inventing colors, breaking the cn() merge order, or shipping focus-less buttons. For the project's *visual language* (Plane/Linear aesthetic, header height, density, hover affordances) see the sibling `frontend-ux` skill; this skill is the *how* layer underneath.
---

# UI Styling (prumo)

Mechanics of styling prumo's frontend. Pairs with `frontend-ux` (which sets the
visual language). When in doubt: **frontend-ux tells you what it should look
like, this skill tells you how to wire the classes, variables, and primitives so
it ends up that way**.

## Stack snapshot

| Layer            | What we use                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| Bundler / router | Vite + React 19 + TypeScript strict, no Next.js / no RSC               |
| Tailwind         | **v3.4.17**, classic `tailwind.config.ts` + `@tailwind base/...`       |
| Components       | shadcn/ui (`style: default`, `baseColor: slate`, `cssVariables: true`) |
| Primitives       | Radix UI under shadcn, plus direct Radix for custom compositions       |
| Variants         | `class-variance-authority` 0.7.1 + `cn()` (`clsx` + `tailwind-merge`)  |
| Theming          | HSL CSS variables in `:root` + `.dark`, semantic tokens                |
| Forms            | `react-hook-form` + `zod` + shadcn `Form*` wrappers                    |
| State            | TanStack Query v5 (server), Zustand (client)                           |
| i18n             | In-house `frontend/lib/copy/*` — **not** next-i18next                  |

Files you will touch most:

- `/Users/raphael/PycharmProjects/prumo/components.json`
- `/Users/raphael/PycharmProjects/prumo/tailwind.config.ts`
- `/Users/raphael/PycharmProjects/prumo/frontend/index.css`
- `/Users/raphael/PycharmProjects/prumo/frontend/lib/utils.ts` (the `cn` helper)
- `/Users/raphael/PycharmProjects/prumo/frontend/components/ui/*`
- `/Users/raphael/PycharmProjects/prumo/frontend/components/{extraction,hitl,quality,runs,...}/*`

## The hard rules (skim before every edit)

1. **Compose via `cn()`** from `@/lib/utils`. Never concatenate classes with
   string `+`; `tailwind-merge` must see them as separate args so later utilities
   override earlier ones (`cn("px-2", "px-4")` → `"px-4"`, not `"px-2 px-4"`).
   The local `cn()` is built on `extendTailwindMerge` and already knows the
   project's custom shadow utilities (`shadow-elev-card`, `shadow-elev-popover`).
   **Any new custom utility that has to dedupe against built-in size variants
   must be added there too** — otherwise `cn("shadow-sm", "shadow-elev-popover")`
   emits both classes and the cascade silently picks the wrong one.
2. **Use semantic tokens, not raw colors.** `bg-background`, `text-foreground`,
   `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`,
   `bg-destructive`, `bg-success`, `bg-warning`, `bg-info`. Raw `bg-slate-200` or
   `text-gray-500` is a smell — it dies in dark mode.
3. **Pair every fg with its bg.** `bg-primary` always wants
   `text-primary-foreground`; `bg-muted` wants `text-muted-foreground`. The
   tokens are defined that way in `frontend/index.css` and `tailwind.config.ts`.
4. **Always extend the base via the `className` prop**, never override base
   styles in the consuming file by re-declaring layout primitives. Pass a thin
   delta. `cn()` will merge correctly.
5. **Dark mode is `class`-based**, driven by `next-themes` via `ThemeProvider`
   (`frontend/contexts/ThemeContext.tsx`: `attribute="class"`,
   `defaultTheme="system"`, `storageKey="prumo:theme"`). Switch through it (the
   `useTheme().cycle` helper or `setTheme`), not by hand-poking the `dark` class —
   it re-syncs from storage + system preference. Test every new component in both
   modes; do not assume `dark:` variants.
6. **Focus is never invisible.** Keep `focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none`
   on any interactive element. Radix gives you keyboard nav for free; do not
   `tabIndex={-1}` your way out.
7. **Prefer Radix primitives over div-with-onClick.** Dialog, Popover, Select,
   DropdownMenu, Tabs, Accordion — all already installed in `components/ui/`.
8. **No inline raw HSL or hex** in JSX. If you genuinely need a one-off color,
   add a token in `frontend/index.css` first (e.g. the `success`/`warning`/`info`
   triad we already have).

## The Add → Customize loop

shadcn is **copy-paste**, not a runtime dep. Components live in the repo at
`frontend/components/ui/*.tsx` and we edit them like any other file.

```bash
npx shadcn@latest add <name>      # writes to frontend/components/ui/<name>.tsx
```

The CLI reads `components.json`, drops the file, installs Radix peer deps, and
wires `@/components/ui/<name>` via the path alias.

After adding:

1. **Read the file.** Do not assume defaults match our tokens.
2. **Replace any raw color** (`bg-slate-…`, `text-zinc-…`) with semantic tokens
   if the CLI inserted one.
3. **Confirm the cva config** uses our variant names. We have extra status
   variants on `Badge` and we add `success`/`warning` to buttons in domain UIs —
   not in `ui/button.tsx`. Keep `ui/*` close to upstream shadcn so future
   `shadcn add` diffs stay clean.
4. **Wire copy** through `frontend/lib/copy/*` for any user-visible string.

If the component already exists, **edit it directly** — do not re-run
`shadcn add`; the CLI will overwrite local changes.

## The cva pattern (canonical example)

`frontend/components/ui/button.tsx` is the reference shape — variants split
into `variant` + `size`, `defaultVariants`, `VariantProps<typeof …>` for the
public type, `asChild` via Radix `Slot`.

```tsx
// frontend/components/extraction/StatusPill.tsx
import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "@/lib/utils";

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      tone: {
        proposal: "bg-info/10 text-info ring-info/30",
        review:   "bg-warning/10 text-warning ring-warning/30",
        approved: "bg-success/10 text-success ring-success/30",
        rejected: "bg-destructive/10 text-destructive ring-destructive/30",
      },
      size: {
        sm: "h-5 text-[11px]",
        md: "h-6 text-xs",
      },
    },
    defaultVariants: { tone: "proposal", size: "md" },
  },
);

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {}

export function StatusPill({ className, tone, size, ...rest }: StatusPillProps) {
  return <span className={cn(statusPillVariants({ tone, size }), className)} {...rest} />;
}
```

Why these choices:

- **`ring-1 ring-inset` + `bg-<token>/10`** — keeps pills legible against any
  surface without a heavy border; works in both themes because the tokens flip.
- **Variants on `tone`, not `color`** — semantic name, future-proof against
  re-theming.
- **`className` last** in the `cn(...)` call — caller wins, as always.
- **`ref` is a plain prop in React 19** (we are on `react@19` — no `forwardRef`
  needed to accept a ref). But ~75% of `ui/*` still uses `forwardRef` (pre-19
  shape); match the neighboring file rather than mixing both styles in one
  component.

For compound variants, `cva` `compoundVariants`, ranking rules, and the
"escape hatch" for arbitrary class slots: see `references/cva-patterns.md`.

## Theming + dark mode

The tokens we actually have (see `frontend/index.css`):

| Token                  | Purpose                            |
| ---------------------- | ---------------------------------- |
| `background` / `foreground`  | Page chrome, primary text    |
| `card` / `card-foreground`   | Card surfaces                |
| `popover` / `popover-foreground` | Floating surfaces        |
| `primary` / `primary-foreground` | Buttons, focus rings     |
| `secondary` / `secondary-foreground` | Subdued buttons      |
| `muted` / `muted-foreground` | Secondary text, hover bg     |
| `accent` / `accent-foreground` | Hover/active highlight     |
| `destructive` + `success` + `warning` + `info` (each with `-foreground`) | Status tokens |
| `border` / `input` / `ring` | Hairlines + focus ring         |
| `sidebar-*`                | Sidebar-only palette           |
| `reviewer-1..5`            | Avatar palette (ReviewerAvatarStack) |
| `--shadow-card` / `--shadow-popover` (CSS-only) | Box-shadow elevation, consumed via `shadow-elev-card` / `shadow-elev-popover` utilities |

Adding a token: add it in **both** `:root` and `.dark` in
`frontend/index.css`, then add the mapping in `tailwind.config.ts` under
`theme.extend.colors`. Use HSL **without** the `hsl()` wrapper so opacity
modifiers (`bg-primary/10`) keep working.

### Box-shadow tokens — name them out of the colour namespace

Tailwind's `shadow-*` plugin matches against both `theme.boxShadow` **and**
`theme.colors`. When a `boxShadow` key shares a name with a colour key
(e.g. `card`, `popover`), Tailwind generates `shadow-{name}` as a colour
modifier (`--tw-shadow-color: hsl(var(--{name}))`) instead of an actual
box-shadow — so the resulting `box-shadow` resolves to `none`. The
in-tree convention is to prefix shadow keys with `elev-`:

```ts
// tailwind.config.ts
boxShadow: {
  "elev-card":    "var(--shadow-card)",
  "elev-popover": "var(--shadow-popover)",
}
```

If you add another shadow level, pick a name that is **not** also in
`theme.colors` and **add it to the `extendTailwindMerge` shadow group**
in `frontend/lib/utils.ts` so `cn()` correctly dedupes it against the
built-in `shadow-{size}` utilities (otherwise the shadcn `<Card>` base
`shadow-sm` will silently win the cascade).

Forward-looking note: **Tailwind v4** moves theme into `@theme { --color-…:
oklch(…) }` in CSS and makes `tailwind.config.ts` optional. We are still on
v3.4.17; do not migrate as a side effect of unrelated work. Migration notes
sit in `references/tailwind-v4.md`.

Full theming patterns (multi-theme via `data-theme`, radius scale,
prefers-color-scheme bootstrap, charts): `references/theming.md`.

## Responsive mechanics

`frontend-ux` §5 sets *how it should adapt*; this is *how to wire it*. Treat
narrow widths as part of the build, not a later pass — `design-review` captures
every screen at ~390 regardless of what you changed.

**Breakpoint scale.** Tailwind defaults — `sm` 640, `md` 768, `lg` 1024, `xl`
1280 — with `2xl` overridden to **1400px** in `tailwind.config.ts`. Mobile-first:
unprefixed = base, prefixes layer *upward* (`grid-cols-1 lg:grid-cols-2`), so
build the narrow case first and add the wide case on top. There are no `max-*`
prefixes in the codebase — don't introduce them; restructure mobile-first instead.

**Container queries — for component-internal reflow.** `@tailwindcss/container-queries`
is installed and in use. When a component must adapt to *its own* width (a header
in a resizable panel, a card in a grid cell) rather than the viewport, mark the
parent `@container` (or a named `@container/headerbar`) and prefix children with
`@md:` / `@[48rem]:`. This is why `RunHeader` / `ExtractionHeader` reflow correctly
even when the window hasn't crossed a viewport breakpoint. Reach for this before a
JS width hook.

**JS width hooks — only when CSS can't express it.** `frontend/hooks/use-mobile.tsx`
exports `useIsMobile()` (<768) and `useIsNarrow()` (<640). Use them to *swap
components* (data table → card list, sidebar → `MobileSidebar`/`Sheet`), not to
toggle classes a breakpoint prefix already covers. They read `matchMedia` via
`useSyncExternalStore`, so they re-render on resize without a mount-effect.

**Priority-track header (the "never overflow" pattern).** A flex row of
Left/Center/Right tracks, each `min-w-0`, the container `overflow-hidden` as a
backstop, with shrink priorities — `shrink-0` on the action you must never clip,
`shrink` on the mid-priority track that yields room first. Labels collapse via
container queries *before* anything clips. Reference:
`frontend/components/runs/header/RunHeader.tsx`.

**The `min-w-0` rule.** Any flex/grid child holding text that can be long needs
`min-w-0` (usually `min-w-0 truncate`) or it forces horizontal scroll — the single
most common responsive bug here. On a breadcrumb, *every* crumb needs it, not just
the last.

## Accessibility (the rules Radix already gives you, plus the ones it does not)

Radix Dialog/Popover/Select/DropdownMenu give you focus trap, focus return,
arrow-key nav, `aria-expanded`, `aria-controls`, and Escape-to-close. Do not
fight them. Things Radix cannot do for you:

- **Icon-only buttons need `aria-label`** or an `sr-only` span — `<Button
  variant="ghost" size="icon"><X /></Button>` is unlabelled otherwise.
- **`aria-invalid` + `aria-describedby`** on form inputs in error state. Our
  `Form*` wrappers in `ui/form.tsx` thread these, but only if you use them —
  raw `<input>` skips them.
- **Live regions for async state.** Extraction streaming, HITL decision
  changes, and toast updates use `aria-live="polite"` (toast component
  already wraps a live region; trust it).
- **Color contrast.** `text-muted-foreground` on `bg-background` is WCAG AA.
  `text-muted-foreground` on `bg-muted` is *not* — pick `text-foreground` for
  copy that lands on muted surfaces.
- **`prefers-reduced-motion`** — see `field-just-updated` in `index.css` for
  the pattern; any new keyframe animation must guard the same way.

Deep dive: `references/a11y.md`.

## prumo-specific patterns

These are the shapes that recur across `extraction/`, `hitl/`, `quality/`,
`runs/`. Use the same classes so the UI feels like one product.

### Data-dense table row (extraction lists)

```tsx
<TableRow
  className="
    group h-9 cursor-pointer border-b border-border/30
    text-[13px] hover:bg-muted/40
    data-[state=selected]:bg-muted/60
  "
  data-state={isSelected ? "selected" : undefined}
>
  <TableCell className="py-1.5 font-medium text-foreground">{title}</TableCell>
  <TableCell className="py-1.5 text-muted-foreground">{authors}</TableCell>
  <TableCell className="py-1.5">
    {/* Row actions only visible on hover — Plane/Linear pattern */}
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button variant="ghost" size="icon" aria-label="Edit row"><Pencil /></Button>
    </div>
  </TableCell>
</TableRow>
```

Anchor numbers: `h-9` row, `py-1.5` cell, `text-[13px]` body (matches
frontend-ux), `border-border/30` hairline, `hover:bg-muted/40` silent hover.

### Side-by-side comparison view (HITL reviewer)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border rounded-md overflow-hidden">
  <section className="bg-card p-4 min-w-0">{/* AI proposal */}</section>
  <section className="bg-card p-4 min-w-0">{/* Reviewer decision */}</section>
</div>
```

`gap-px` + container `bg-border` is how you get a 1px divider between two
cards without doubling borders. `min-w-0` on flex/grid children lets long
strings ellipsize instead of forcing horizontal scroll.

### PDF viewer chrome

Two-pane layout via `ResizablePanelGroup` (`ui/resizable.tsx`). PDF gets a
`bg-muted/30` backdrop and rounded inner container; toolbar sits in a
sticky `h-10 border-b border-border/40` strip — see
`frontend/components/extraction/ExtractionPDFPanel.tsx` for the live
reference. Match the chrome dimensions in any new viewer.

### Instance editor (Dialog vs Sheet)

- **Dialog** for short, atomic edits (≤1 screen of content, no sub-navigation).
- **Sheet** (`ui/sheet.tsx`) for multi-section editors, especially when the
  user needs to keep the underlying list visible.
- Both close on `Esc` and outside click — do **not** disable that without a
  destructive-change confirmation in `AlertDialog`.

### `field-just-updated` flash

Already wired in `index.css`. Toggle the class for ~1.5s after an AI refresh
writes a value; respects `prefers-reduced-motion`. Reuse it; do not invent a
second highlight scheme.

## Common bugs and how to spot them

| Symptom                                       | Probable cause                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Hover-bg shows through child element          | Child element has its own `bg-*` that is not `transparent` or `bg-inherit`.       |
| Dark-mode text invisible on hover             | You used `hover:bg-gray-100` instead of `hover:bg-muted/50` — raw color, no flip. |
| Focus ring missing on Radix trigger           | You spread props *before* setting `className` or used a `<div>` not `<button>`.   |
| `cn()` does not strip earlier `p-2` for `p-4` | One of them is hidden inside a template literal or arbitrary value bracket.       |
| Long string in flex/grid causes overflow      | Child needs `min-w-0` (flex) or `min-w-0 truncate`.                               |
| Layout fine on desktop, cramped/overflowing on mobile | Built desktop-first with `max-*` thinking; rebuild mobile-first (base = narrow, add `sm:`/`lg:` upward). |
| Header reflows on window resize but not when the panel resizes | Used `md:`/`lg:` (viewport) where you wanted `@md:`/`@container` (element width). |
| Variant prop is typed `any`                   | Missing `VariantProps<typeof xxxVariants>` on the props interface.                |
| Toast not announced                           | You bypassed `useToast` and rendered a `<div>` yourself.                          |
| Custom `shadow-*` utility resolves to `box-shadow: none` | Key collides with a `theme.colors` key — Tailwind treats it as a shadow-colour modifier. Rename the `boxShadow` key (e.g. prefix `elev-`). |
| Custom `shadow-*` utility is overridden by shadcn `<Card>` `shadow-sm` | Missing entry in `extendTailwindMerge` shadow group in `frontend/lib/utils.ts`. |

## When to reach for a reference

- `references/shadcn-cli.md` — `components.json` schema, alias setup,
  adding new components without clobbering local edits, custom registries.
- `references/cva-patterns.md` — compound variants, default + size +
  asChild composition, typing tricks, escape hatches.
- `references/theming.md` — adding tokens, multi-theme via `data-theme`,
  radius scale, charts, the `sidebar-*` namespace.
- `references/tailwind-v4.md` — what changes if/when we migrate; do not
  apply v4 patterns to v3 code.
- `references/a11y.md` — patterns for the bits Radix does not give you;
  testing flow, live-region examples specific to extraction streaming.

## Anti-patterns (do not do these)

- `className={`bg-${color}-500`}` — Tailwind cannot scan dynamic class names.
  Use a `cva` variant or a lookup map of literal class strings.
- Reaching for `!important` (`!bg-red-500`). Almost always means the
  `cn()` arg order is wrong, or you are trying to override a token in a
  consuming file instead of editing the variant.
- Re-implementing a Radix primitive because "Radix is too heavy". The
  primitive is already in the bundle if you imported a sibling from
  `components/ui`.
- Adding a `tailwind.config.ts` plugin for a one-off effect — usually a
  custom utility in `@layer utilities` in `index.css` is enough.
- Inline `style={{}}` for layout. The exceptions are dynamic values that
  truly cannot be enumerated (e.g. `style={{ width: pct + "%" }}` for a
  progress bar driven by a number); even then prefer CSS variables.
- Writing English strings inline. Route through `frontend/lib/copy/*` —
  this is project-wide policy (see `.claude/CLAUDE.md` §1).
