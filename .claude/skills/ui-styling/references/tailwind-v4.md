# Tailwind v4 — how this repo is wired

prumo migrated to **Tailwind v4.3.3** on 2026-08-21. There is no
`tailwind.config.ts` any more: `frontend/index.css` is the single source of
truth for theme, variants and plugins.

Write v4 patterns. If a search result or an older shadcn snippet hands you
`@tailwind base;`, a JS config, or `focus-visible:outline-none`, it is v3 —
translate it before pasting.

## The toolchain

`postcss.config.js` loads `@tailwindcss/postcss` — **not** `@tailwindcss/vite`.
That is deliberate: the single PostCSS config is auto-discovered by both
`vite.config.ts` and `vitest.config.ts` (neither declares a `css` key), so one
file covers both pipelines. The Vite plugin would have to be wired into both
(or into `vite.shared-plugins.ts`, which exists precisely because those two
drifting once caused a silent gap).

`autoprefixer` is gone — v4 bundles vendor prefixing.

## The shape of index.css

```css
@import "tailwindcss" source(none);
@source "../frontend/**/*.{ts,tsx}";

@plugin "tailwindcss-animate";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@utility z-header { z-index: var(--z-header); }

@theme inline {
  --color-primary: hsl(var(--primary));
  --radius-sm: calc(var(--radius) - 4px);
  --shadow-elev-card: var(--shadow-card);
  --text-header-title: 13px;
  --text-header-title--line-height: 1.2;
}

@layer base {
  :root { --primary: 240 5.9% 10%; --radius: 0.5rem; }
  .dark { --primary: 0 0% 98%; }
}
```

Four things about that block are load-bearing:

- **`source(none)` + explicit `@source`.** Without it v4 auto-detects sources
  and would also scan `backend/`, `docs/` and `scripts/`, emitting utilities for
  stray text matches. The explicit glob reproduces what v3's `content` scanned.
- **`@theme inline`, not `@theme`.** `inline` inlines the value into each
  utility, so `.bg-primary` emits `hsl(var(--primary))` and resolves the raw HSL
  triple at use time. That is what keeps the `.dark` overrides working.
- **The `:root` / `.dark` custom properties stay in `@layer base`.** They are
  *not* restated inside `@theme`; the theme block only maps them onto Tailwind's
  namespaces.
- **`@custom-variant dark`, not `@variant`.** v4 renamed it. Omitting it
  silently reverts every `dark:` utility to a `prefers-color-scheme` query.

## Theme namespaces

| v3 config key           | v4 namespace                              |
| ----------------------- | ----------------------------------------- |
| `theme.extend.colors`   | `--color-*`                               |
| `theme.extend.boxShadow`| `--shadow-*`                              |
| `theme.extend.fontSize` | `--text-*` (+ `--text-x--line-height`)    |
| `theme.extend.borderRadius` | `--radius-*`                          |
| `theme.extend.animation`| `--animate-*`                             |
| `theme.extend.zIndex`   | no namespace — use `@utility`             |
| `darkMode: ["class"]`   | `@custom-variant dark (&:is(.dark *))`    |
| `content: [...]`        | `@source` (or auto-detection)             |
| `plugins: [...]`        | `@plugin "name"`                          |

## Renamed utilities

| v3                  | v4              | Note                                            |
| ------------------- | --------------- | ----------------------------------------------- |
| `outline-none`      | `outline-hidden`| v4 also HAS `outline-none`, and it is different |
| `shadow-sm`         | `shadow-xs`     | The whole shadow scale shifted one step         |
| `shadow`            | `shadow-sm`     |                                                 |
| `flex-shrink`       | `shrink`        |                                                 |
| `!class`            | `class!`        | Important flag moved to a suffix                |

`outline-hidden` keeps the transparent outline that Windows High Contrast Mode
turns back into a visible ring (v4 gates it on `@media (forced-colors:
active)`). v4's `outline-none` removes the outline entirely — do not use it for
focus styling. See `a11y.md`.

## Do NOT rename `rounded-sm`

`@theme inline` sets `--radius-sm: calc(var(--radius) - 4px)` = 4px, carried
over from v3. v4's stock `--radius-xs` is a fixed 2px, so renaming
`rounded-sm` → `rounded-xs` **halves the radius at 21 call sites**.
`npx @tailwindcss/upgrade` applies that rename automatically because it cannot
see the override. If you ever run the codemod, revert that part and check the
CSS baseline.

## Verifying a styling change

`scripts/css_baseline.mjs` compiles `index.css` and snapshots every
`selector -> declarations` pair.

```bash
node scripts/css_baseline.mjs --check   # diff against scripts/css_baseline.txt
node scripts/css_baseline.mjs           # re-record after an intended change
```

It normalises the things v3 and v4 spell differently but mean identically
(cascade-layer wrapper, combinator spacing, `min-width` vs range queries), so
the diff shows semantic change. This is the only mechanism in the repo that
catches a silently dropped utility — vitest asserts class strings in jsdom
(no stylesheet), and the E2E suite makes zero visual assertions.

## Still HSL, not OKLCH

The 93 `:root`/`.dark` custom properties remain raw HSL triples. That is a
deliberate choice, not an oversight: `hsl(var(--x))` works verbatim under v4,
and converting would break the raw-triple consumers in `index.css` that
compose `hsl(var(--background) / var(--header-surface-alpha))`.

When adding a token, follow the existing HSL pattern.
