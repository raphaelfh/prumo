# Theming

prumo's theming pipeline is CSS-first (Tailwind v4): raw HSL custom properties in `frontend/index.css` (`:root` and `.dark`, inside `@layer base`) → mapped onto Tailwind namespaces in the same file's `@theme inline` block → consumed in components as `bg-<token>` / `text-<token>`. There is no `tailwind.config.ts`. The wiring rules (`source(none)`, `@theme inline`, `@custom-variant dark`) are in [tailwind-v4.md](tailwind-v4.md).

## The token system

Custom properties hold HSL triples **without** the `hsl()` wrapper; the `@theme inline` mapping adds it:

```css
@layer base {
  :root { --primary: 240 5.9% 10%; }
  .dark { --primary: 0 0% 98%; }
}

@theme inline {
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
}
```

Result: `bg-primary` → `hsl(var(--primary))`, `bg-primary/10` → 10% opacity, `text-primary-foreground` → the paired foreground. **Always pair them.** `bg-primary` without `text-primary-foreground` on the contained text is a bug.

The palette itself (background, card, popover, primary, secondary, muted, accent, the `destructive`/`success`/`warning`/`info` status set, `border`/`input`/`ring`, `sidebar-*`, `reviewer-1..5`) is read from `index.css`, not from here; the file is the source of truth and this doc would only go stale. The `sidebar-*` namespace is still unconsumed: `components/layout/ProjectSidebar.tsx` carries its own values.

## Adding a new token

You almost certainly do not need to. If you must:

1. Add the custom property in **both** `:root` and `.dark` in `frontend/index.css`, as a bare HSL triple.
2. Map it in `@theme inline` under the right namespace: `--color-*` for colors (add the `-foreground` pair), `--shadow-*`, `--radius-*`, `--text-*`. No JS config to touch.
3. Use the new utility in one component and check it in both themes; Vite reloads `index.css` on save.
4. If a new `shadow-*` name must win against shadcn's base `shadow-xs`, add it to the twMerge shadow class group in the `cn` helper (`frontend/lib/utils.ts`), or `cn()` will let the base class survive the merge.

Shadow tokens use the `elev-` prefix (`shadow-elev-card`, `shadow-elev-popover`, `shadow-elev-header`, `shadow-elev-overlay`). Keep the convention so a shadow name never collides with a color name.

## Dark mode

Dark mode is class-based: `@custom-variant dark (&:is(.dark *))` in `index.css`. The class is set by `next-themes` through `frontend/contexts/ThemeContext.tsx`, which wraps its provider with `defaultTheme="system"` and exposes `useTheme()` with a `cycle()` helper (light → dark → system). Don't hand-roll a toggle or write to `localStorage` yourself.

## Radius scale

`--radius: 0.5rem` in `:root`; `@theme inline` derives `--radius-lg`, `--radius-md` (−2px) and `--radius-sm` (−4px). Components use `rounded-md` / `rounded-lg` / `rounded-sm`. Never rename `rounded-sm` to v4's `rounded-xs`: see [tailwind-v4.md](tailwind-v4.md).

## Charts

There are no `--chart-*` tokens in `index.css`. Add them only if a chart primitive is adopted; until then pass HSL via inline style.

## Opacity modifier gotcha

`bg-primary/10` works only while `--primary` is a bare triple (`240 5.9% 10%`). A wrapped value (`--primary: hsl(240 5.9% 10%)`) breaks the modifier silently. Audit any new variable: three numbers and nothing else.

## Verifying

There is no compiled-CSS baseline gate any more (removed in the dead-code sweep, #685). jsdom tests see no stylesheet, so a dropped utility is invisible to vitest. After a theme change, render the screen and look: `/design-review` in light and dark, at 200% zoom, and tab through the interactive elements for focus visibility.
