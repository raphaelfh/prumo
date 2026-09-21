---
name: ui-styling
description: "Use when writing className strings or editing JSX styling in prumo's frontend: Tailwind v4, shadcn/ui and Radix primitives, cva variants, tokens and dark mode in `frontend/index.css`, focus and keyboard accessibility. The mechanics layer under `frontend-ux`; it stops invented colors, broken `cn()` merges and focus-less controls."
---

# UI Styling (prumo)

The mechanics of styling prumo. `frontend-ux` says what a screen should look like; this skill says how to wire the classes, tokens and primitives so it ends up that way.

Files you touch most: `frontend/index.css` (theme, tokens, utilities), `components.json`, `frontend/lib/utils.ts` (`cn`), `frontend/components/ui/*` (37 primitives: `ls` before adding one), `frontend/components/patterns/*`.

## Hard rules

1. **Compose with `cn()`** from `@/lib/utils`, never string `+`, so `tailwind-merge` sees separate arguments and the later utility wins. `cn()` is built on `extendTailwindMerge` and knows the `shadow-elev-*` utilities; a new custom utility that must dedupe against a built-in one is registered there too, or both classes ship and the cascade picks.
2. **Semantic tokens, never raw colors.** `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, the status set. `bg-slate-200` or an inline hex dies in dark mode; a genuinely new color gets a token first.
3. **Pair every background with its foreground**: `bg-primary` with `text-primary-foreground`, `bg-muted` with `text-muted-foreground`.
4. **Extend through `className`, caller last**: pass a thin delta and let `cn()` merge. Button height is the exception: pick a named size, never `className="h-8"` (`check_button_scale.py`; the scale is in `frontend-ux` § Buttons).
5. **Icon-only controls are `IconButton`** (`components/patterns/IconButton.tsx`, props `label` and `icon`): the label is the accessible name and the tooltip. `check_ui_primitives.py` bans an icon-sized `<Button>` anywhere else.
6. **No cursor utilities.** `index.css` owns the cursor (arrow everywhere, a hand only on `a[href]`); `cursor-pointer`, `cursor-default` and `cursor-not-allowed` fail `check_ui_primitives.py`.
7. **Focus is never invisible**: interactive elements keep `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden`. Prefer a Radix primitive (Dialog, Popover, Select, DropdownMenu, Tabs) to a `div` with `onClick`.
8. **Dark mode goes through `next-themes`** (`frontend/contexts/ThemeContext.tsx`: `attribute="class"`, `storageKey="prumo:theme"`, `useTheme().cycle`), never by poking the `dark` class, which it re-syncs from storage.
9. **Copy goes through `frontend/lib/copy/`**, never an inline English string.

## Tailwind v4 wiring

Tailwind 4 is CSS-first: `frontend/index.css` is the whole config, and there is no `tailwind.config.ts`. PostCSS loads `@tailwindcss/postcss`, which Vite and Vitest both pick up.

- `@import "tailwindcss" source(none)` plus an explicit `@source "../frontend/**/*.{ts,tsx}"`, so `backend/`, `docs/` and `scripts/` are never scanned.
- Tokens are bare HSL triples in `:root` and `.dark` inside `@layer base`, mapped in `@theme inline` (`--color-primary: hsl(var(--primary))`). `inline` is what keeps `.dark` overrides working, and the bare triple is what keeps `bg-primary/10` working: a value wrapped in `hsl()` silently breaks the opacity modifier.
- `@custom-variant dark (&:is(.dark *))`; without it every `dark:` utility falls back to `prefers-color-scheme`.
- A z-index or other one-off is an `@utility`, not a plugin.
- Translate any v3 snippet before pasting: `outline-none` → `outline-hidden` (v4's `outline-none` removes the outline entirely), `shadow-sm` → `shadow-xs` and `shadow` → `shadow-sm` (the scale shifted), `!class` → `class!`, `flex-shrink` → `shrink`.
- **Never rename `rounded-sm` to `rounded-xs`.** `--radius-sm` is overridden to 4px; v4's `rounded-xs` is 2px. `npx @tailwindcss/upgrade` applies that rename blindly.

## Tokens

| Token | Purpose |
|---|---|
| `background` / `foreground` | page chrome, primary text |
| `card`, `popover` (each with `-foreground`) | surfaces |
| `primary` (+ `-foreground`, `primary-hover`), `secondary`, `accent` | actions, highlights |
| `muted` / `muted-foreground` | secondary text, hover fills |
| `destructive`, `success`, `warning`, `info` (each with `-foreground`) | status |
| `ai` / `ai-foreground` | AI suggestions (`bg-ai/5`, `border-ai/60`) |
| `border`, `input`, `ring` | hairlines, focus ring |
| `sidebar-*` | sidebar palette (`ProjectSidebar.tsx` still hardcodes its own values) |
| `reviewer-1..5` | reviewer avatars and dots |
| `shadow-elev-card`, `-popover`, `-header`, `-overlay` | elevation |

Adding one: the property in **both** `:root` and `.dark`, then its mapping in `@theme inline` under the right namespace (`--color-*` with its `-foreground` pair, `--shadow-*`, `--radius-*`, `--text-*`), then check both themes. Shadow names keep the `elev-` prefix, and a new one joins the twMerge shadow group in `frontend/lib/utils.ts`, or shadcn's base `shadow-xs` wins the merge. There are no chart tokens.

## shadcn: add, then customize

shadcn is copy-paste: `npx shadcn@latest add <name>` writes `frontend/components/ui/<name>.tsx`, and it is ours from then on. Re-running `add` on an existing file overwrites local edits, so edit in place. After adding, read the file, replace any raw color with tokens, and route strings through the copy layer.

Keep `ui/*` close to upstream so future diffs stay clean. Three deliberate divergences are pinned by guard tests that fail if an `add` overwrites them:

- `ui/button.tsx` sizes: `default` (h-10), `sm` (h-7, **the default**), `xs`, `lg`, `icon`, `icon-xs`. Guard: `button.test.tsx`.
- The `quiet` cva variant on `ui/input.tsx`, `ui/textarea.tsx` and `SelectTrigger`: the borderless settings control. It carries `md:text-[13px]` (the base `md:text-sm` would win from 768px), rings on `focus-visible:` only, and `aria-[invalid=true]:focus-visible:ring-2`. Guard: `quiet-controls.test.tsx`.
- `ui/form.tsx`'s `FormControl` joins its description id, its message id and any incoming `aria-describedby`, where upstream let a passed id overwrite both. Guard: `form.describedby.test.tsx`.

Status colors for domain buttons live in the domain component, not in `ui/button.tsx`. Most `ui/*` files still use `forwardRef` (React 19 accepts `ref` as a prop): match the neighboring file.

## cva

`ui/button.tsx` is the reference shape: `variant` + `size`, `defaultVariants`, `VariantProps<typeof x>` on the props, `asChild` through Radix `Slot`, and `cn(variants({...}), className)` with the caller's class last. Name variants by meaning (`tone: "approved"`), not color. Export the variants function only when another module composes it: knip flags an unused export.

## Responsive mechanics

`frontend-ux` § 5 says how a screen should adapt; this is how to wire it. Breakpoints are Tailwind's defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536). Build mobile-first: the unprefixed class is the narrow case, prefixes layer upward, and there are no `max-*` prefixes in the codebase.

- **Container queries** for a component that adapts to its own width (a header in a resizable panel): mark the parent `@container` (or `@container/headerbar`) and prefix children `@md:`. Tailwind 4 supports them natively, which is why `RunHeader` reflows without a viewport breakpoint. Reach for this before a JS width hook.
- **Width hooks** (`frontend/hooks/use-mobile.tsx`: `useIsMobile()` < 768, `useIsNarrow()` < 640) swap components (table → card list, sidebar → `MobileSidebar` sheet); they never toggle classes a prefix could.
- **Priority-track header**: Left/Center/Right tracks, each `min-w-0`, the container `overflow-hidden`, `shrink-0` on the action that must never clip; labels collapse through container queries before anything clips. Reference: `frontend/components/runs/header/RunHeader.tsx`.
- **`min-w-0`** on any flex or grid child holding text that can be long (`min-w-0 truncate`), on every crumb of a breadcrumb: the most common overflow bug here.

## Accessibility

Radix gives focus trap and return, arrow-key navigation, `aria-expanded` and Escape, and hides the page behind a dialog from screen readers. Radix cannot give you:

- `aria-invalid` + `aria-describedby` on inputs in error: the `Form*` wrappers thread them, a raw `<input>` does not.
- Contrast: `text-muted-foreground` on `bg-background` passes AA; on `bg-muted` it does not, so use `text-foreground` there. `text-destructive-foreground` on `bg-destructive` is 3.6:1 in light mode: large or bold text only.
- A tooltip on a disabled control: a disabled button has `pointer-events-none`, so `IconButton` hangs its tooltip on a wrapping span; do the same by hand for a disabled text button that must explain itself.
- One tooltip provider, in `App.tsx`; `Tooltip` renders its own when none is mounted, so a test that asserts tooltip text wraps the render in `<TooltipProvider delayDuration={0}>`.
- Toasts go through `sonner`; both mounted toasters announce, so never nest another live region.
- A new keyframe animation guards `prefers-reduced-motion`, as `field-just-updated` in `index.css` does.
- Lucide icons already set `aria-hidden`.

## prumo patterns

- **Dense data row**: `h-9` row, `py-1.5` cell, `text-[13px]`, `border-border/30` hairline, `hover:bg-muted/40`, `data-[state=selected]:bg-muted/60`, row actions revealed with `group-hover` and always visible on touch.
- **Side-by-side comparison**: `grid grid-cols-1 lg:grid-cols-2 gap-px bg-border` with `bg-card min-w-0` children draws one 1px divider without doubled borders.
- **PDF viewer chrome**: `ResizablePanelGroup`, a `bg-muted/30` backdrop, a sticky `h-10 border-b border-border/40` toolbar; live reference `frontend/components/runs/RunPdfContent.tsx`.
- **Overlays** read their classes from `components/ui/overlay-frame.ts`: centered with `inset-0 m-auto`, never `translate-*` (v4's `translate` property composes with the animation's `transform` and makes the frame jump). Size and height live only in the cva variants; sizes and when to use a dialog are in `frontend-ux` § 8.
- **`field-just-updated`** (in `index.css`): toggle it for about 1.5 s after an AI refresh writes a value; never invent a second highlight.

## Symptoms

| Symptom | Probable cause |
|---|---|
| Hover fill shows through a child | the child has its own `bg-*` |
| Text vanishes on hover in dark mode | a raw color (`hover:bg-gray-100`) instead of a token |
| No focus ring on a Radix trigger | props spread after `className`, or a `div` instead of a `button` |
| `cn()` keeps both `p-2` and `p-4` | one sits inside a template literal or an arbitrary-value bracket |
| Long text forces horizontal scroll | a flex or grid child without `min-w-0` |
| Header reflows on window resize, not on panel resize | a viewport prefix (`md:`) where a container one (`@md:`) was meant |
| A custom `shadow-*` loses to shadcn's `shadow-xs` | missing from the twMerge shadow group in `frontend/lib/utils.ts` |
| A variant prop is typed `any` | `VariantProps<typeof xVariants>` missing from the props |

## Anti-patterns

- Dynamic class names (`` `bg-${color}-500` ``): Tailwind cannot scan them. Use a cva variant or a map of literal strings.
- `class!` to win a fight: the `cn()` order is wrong, or the variant needs editing.
- Re-implementing a Radix primitive "because it is heavy": it is already in the bundle.
- Inline `style={{}}` for layout, except values that cannot be enumerated (a progress width); prefer a CSS variable even then.
