# Theming

prumo theming pipeline: HSL CSS variables in `frontend/index.css` → mapped to
Tailwind tokens in `tailwind.config.ts` → consumed in components via
`bg-<token>` / `text-<token>` / etc.

## The token system

All tokens are HSL **without the `hsl()` wrapper**, so opacity modifiers work:

```css
:root {
  --primary: 240 5.9% 10%;   /* h s% l% */
}
```

In `tailwind.config.ts`:

```ts
colors: {
  primary: {
    DEFAULT: "hsl(var(--primary))",
    foreground: "hsl(var(--primary-foreground))",
  },
}
```

Result:
- `bg-primary` → `background-color: hsl(var(--primary))`
- `bg-primary/10` → `background-color: hsl(var(--primary) / 0.1)` (10% opacity)
- `text-primary-foreground` → the paired foreground

Always pair them. Never use `bg-primary` without ensuring the contained text
gets `text-primary-foreground` (or inherits from a parent that did).

## Current palette

| Pair                            | Light                  | Dark                   | Use                       |
| ------------------------------- | ---------------------- | ---------------------- | ------------------------- |
| `background` / `foreground`     | white / near-black     | near-black / white     | Page chrome + body text   |
| `card` / `card-foreground`      | white                  | near-black             | Card surface              |
| `popover` / `popover-foreground`| white                  | near-black             | Floating surface          |
| `primary` / `primary-foreground`| near-black / white     | white / near-black     | CTAs, focus               |
| `secondary` / `secondary-fg`    | light gray / near-black| dark gray / white      | Subdued buttons           |
| `muted` / `muted-foreground`    | light gray / mid gray  | dark gray / light gray | Hover bg, secondary copy  |
| `accent` / `accent-foreground`  | light gray / near-black| dark gray / white      | Hover/active highlights   |
| `destructive` / `destructive-fg`| red / white            | dark red / white       | Delete actions, errors    |
| `success` / `success-foreground`| green / white          | (same in dark)         | Approved, success toasts  |
| `warning` / `warning-foreground`| amber / white          | (same in dark)         | Review, warnings          |
| `info` / `info-foreground`      | sky / white            | (same in dark)         | Info, proposals           |
| `border` / `input` / `ring`     | light gray             | dark gray              | Hairlines, focus ring     |
| `sidebar-*`                     | own palette            | own palette            | Sidebar only              |

The `sidebar-*` namespace is separate so the sidebar can drift from the page
chrome without polluting the global tokens. See `frontend/components/ui/sidebar.tsx`.

## Adding a new token

You almost certainly do not need to. If you must:

1. **Edit `frontend/index.css`.** Add the variable in **both** `:root` and `.dark`.
   Use HSL without `hsl()`.

   ```css
   :root {
     --brand: 271 68% 56%;
     --brand-foreground: 0 0% 100%;
   }
   .dark {
     --brand: 271 58% 66%;
     --brand-foreground: 0 0% 100%;
   }
   ```

2. **Edit `tailwind.config.ts`.** Add the color under `theme.extend.colors`.

   ```ts
   colors: {
     brand: {
       DEFAULT: "hsl(var(--brand))",
       foreground: "hsl(var(--brand-foreground))",
     },
   }
   ```

3. **Restart `npm run dev`.** Tailwind regenerates from config on save, but
   `index.css` changes for variables need an HMR push.

4. **Test both themes.** Toggle `dark` on `<html>` in DevTools.

## Multi-theme via `data-theme`

If we ever need user-selectable themes beyond light/dark (e.g. a high-contrast
mode), use data attributes:

```css
[data-theme="high-contrast"] {
  --foreground: 0 0% 0%;
  --background: 0 0% 100%;
  --border: 0 0% 0%;
  --ring: 0 0% 0%;
}
.dark[data-theme="high-contrast"] {
  --foreground: 0 0% 100%;
  --background: 0 0% 0%;
  --border: 0 0% 100%;
  --ring: 0 0% 100%;
}
```

```tsx
<html className={isDark ? "dark" : ""} data-theme={preference}>
```

## Dark mode toggle

We do not use `next-themes` (it is Next-only). The pattern lives in
`frontend/contexts/ThemeProvider` (or `ThemeContext` — check). A minimal
implementation looks like:

```tsx
// frontend/contexts/ThemeContext.tsx (illustrative)
const root = document.documentElement;
const apply = (theme: "light" | "dark" | "system") => {
  const resolved = theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : theme;
  root.classList.toggle("dark", resolved === "dark");
  localStorage.setItem("theme", theme);
};
```

Then a toggle component reads `useTheme()` and calls `setTheme()`. The shadcn
`Sun`/`Moon` icon pattern with `rotate-0` / `-rotate-90` transitions is fine.

## Radius scale

```css
:root { --radius: 0.5rem; }   /* 8px */
```

```ts
borderRadius: {
  lg: "var(--radius)",                    // 0.5rem
  md: "calc(var(--radius) - 2px)",        // 0.375rem
  sm: "calc(var(--radius) - 4px)",        // 0.25rem
}
```

Components use semantic class names: `rounded-md`, `rounded-lg`. Change the
single variable to re-skin the whole app (sharp corners: `0rem`, pillow:
`1rem`).

## Charts

Charts use a separate `--chart-1` ... `--chart-5` token series in shadcn's
default registry. We do not currently have them in `index.css` — add only if
we adopt the `chart.tsx` color set seriously. Otherwise pass HSL via inline
style.

## Opacity modifier gotchas

`bg-primary/10` only works if `--primary` is **bare HSL components** (`240
5.9% 10%`). If anyone writes `--primary: hsl(240 5.9% 10%);` (with the
wrapper), `bg-primary/10` breaks silently because the resulting `hsl(...) /
0.1` is invalid.

Audit any new variable: it should be three numbers (and optional commas) and
nothing else.

## Verifying

```bash
# After theme changes, smoke-test:
# - light/dark toggle
# - high-zoom (browser zoom to 200%)
# - prefers-color-scheme alignment (DevTools → Rendering → Emulate CSS media)
# - focus visibility (Tab through key interactive elements)
```
