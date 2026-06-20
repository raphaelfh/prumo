---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Shipped · Last reviewed: 2026-05-24 · Owner: @raphaelfh

# Dark/Light UX tokenization & polish — design

**Status**: design — pending implementation
**Date**: 2026-05-22

## Goal

Resolve a backlog of design-system inconsistencies surfaced during a
dark/light mode audit. The work converges around three themes:

1. **Tokenization** — replace inline literals (palettes, shadows, raw
   color classes) with HSL/CSS variables in `frontend/index.css` and
   their Tailwind mappings.
2. **Fix dead references** — `--primary-hover` is mapped in
   `tailwind.config.ts:26` but never defined, so `hover:bg-primary-hover`
   resolves to `hsl(undefined)`.
3. **Polish** — small comments, eslint cleanup, and a *targeted* density
   sweep to align high-traffic extraction surfaces with the `text-[13px]`
   body rule from the `frontend-ux` skill.

The change is **frontend-only**, design-system level. It does not modify
behaviour, API contracts, or database state.

## Non-goals

- Playwright visual-regression snapshots for dark mode. Deferred to a
  separate PR (~2h of infra, orthogonal to this fix).
- Blanket `text-sm → text-[13px]` sweep across all 127 occurrences in
  `frontend/components/extraction/`. Most are legitimate (form labels,
  buttons, headers). Only body-copy offenders are touched.
- Reworking the `linear-card` component class. Its inline shadow
  (`0 1px 3px rgba(0,0,0,0.05)`) collapses into the new `--shadow-card`.
- Adding `bg-ai` solid surfaces. The `--ai-foreground` token already
  exists; keep it for the first consumer.

## Tokens added or completed

### `frontend/index.css` (both `:root` and `.dark`)

**Reviewer palette** — 5 HSL slots, used by `ReviewerAvatarStack` to
colour avatar bubbles deterministically by user id hash. Hues chosen to
match the existing sky/emerald/amber/violet/rose intent, but adjusted
for dark-mode contrast.

```css
:root {
  --reviewer-1: 199 89% 48%;   /* sky    */
  --reviewer-2: 158 64% 40%;   /* emerald */
  --reviewer-3: 38  92% 50%;   /* amber  */
  --reviewer-4: 262 83% 58%;   /* violet */
  --reviewer-5: 350 89% 60%;   /* rose   */
}
.dark {
  --reviewer-1: 199 89% 60%;
  --reviewer-2: 158 64% 52%;
  --reviewer-3: 38  92% 60%;
  --reviewer-4: 262 83% 68%;
  --reviewer-5: 350 89% 70%;
}
```

**Shadow tokens** — 2 vars. Dark-mode values use higher alpha so the
shadow stays visible on dark surfaces.

```css
:root {
  --shadow-card:    0 1px 3px rgb(0 0 0 / 0.05);
  --shadow-popover: 0 8px 30px rgb(0 0 0 / 0.04);
}
.dark {
  --shadow-card:    0 1px 3px rgb(0 0 0 / 0.40);
  --shadow-popover: 0 8px 30px rgb(0 0 0 / 0.35);
}
```

**`--primary-hover`** — completes the dead reference. Slightly lighter
than `--primary` in light mode (since `--primary` is near-black), slightly
darker in dark mode (since `--primary` is near-white).

```css
:root { --primary-hover: 240 5.9% 20%; }
.dark { --primary-hover: 0 0% 88%; }
```

### `tailwind.config.ts` (`theme.extend`)

```ts
colors: {
  // ... existing
  reviewer: {
    1: "hsl(var(--reviewer-1))",
    2: "hsl(var(--reviewer-2))",
    3: "hsl(var(--reviewer-3))",
    4: "hsl(var(--reviewer-4))",
    5: "hsl(var(--reviewer-5))",
  },
},
// NB: shadow keys must NOT collide with `theme.colors` keys —
// Tailwind treats `shadow-<name>` as a colour modifier
// (--tw-shadow-color) when name matches a colour. `card` and `popover`
// are both colour keys, so the box-shadow keys carry an `elev-` prefix.
boxShadow: {
  "elev-card":    "var(--shadow-card)",
  "elev-popover": "var(--shadow-popover)",
},
```

`primary.hover` mapping at line 26 stays — it just resolves to a real
value now.

### `frontend/lib/utils.ts` (`cn()` helper)

The default `twMerge` does not know that `shadow-elev-card` and
`shadow-elev-popover` are box-shadow utilities, so it cannot dedupe them
against the built-in `shadow-{sm,md,lg,…}` that shadcn primitives
(`<Card>`, etc.) apply at the base. Without the extension below,
`cn("shadow-sm", "shadow-elev-popover")` returns both classes and the
later one in the stylesheet (usually `shadow-sm`) wins via cascade —
silently neutralising the override.

```ts
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: ["shadow-elev-card", "shadow-elev-popover"],
    },
  },
});
```

## Component changes

### `frontend/components/runs/ReviewerAvatarStack.tsx`

Replace the inline `PALETTE` array (lines 40–46) with a **literal lookup
map**. Tailwind cannot scan dynamic class names, so the map must list
each tuple as a full string. The hashing logic (`colorFor`) and the
ring/size class shape stay identical — only the palette values change.

```ts
const PALETTE: readonly string[] = [
  "bg-reviewer-1/20 text-reviewer-1 dark:bg-reviewer-1/30 dark:text-reviewer-1",
  "bg-reviewer-2/20 text-reviewer-2 dark:bg-reviewer-2/30 dark:text-reviewer-2",
  "bg-reviewer-3/20 text-reviewer-3 dark:bg-reviewer-3/30 dark:text-reviewer-3",
  "bg-reviewer-4/20 text-reviewer-4 dark:bg-reviewer-4/30 dark:text-reviewer-4",
  "bg-reviewer-5/20 text-reviewer-5 dark:bg-reviewer-5/30 dark:text-reviewer-5",
] as const;
```

Why `/20` not `/200`: opacity modifier on a token-based color gives
the same soft-tint effect as the old `bg-sky-200` while flipping
correctly between modes.

### Shadow consolidation

Find-and-replace literal `shadow-[0_8px_30px_rgb(0,0,0,0.04)]` →
`shadow-elev-popover` across ~19 files (popovers, dropdowns, dropdown
menus, card overlays). Replace literal `shadow-[0_1px_3px_rgba(0,0,0,0.05)]`
(in the `linear-card` component class) and
`shadow-[0_1px_2px_rgb(0,0,0,0.03)]` (in `InstanceCard.tsx`) →
`shadow-elev-card`.

The `elev-` prefix is required to keep these utility names out of
Tailwind's colour-shadow namespace (see "Tailwind config" above).

Out of scope: `shadow-[0_2px_8px_rgba(0,0,0,0.08)]` (the `linear-card`
hover variant), `shadow-[0_4px_20px_rgba(0,0,0,0.08)]` (single use in
`ProjectView.tsx`), `shadow-[0_0_0_1px_…]` patterns (these are 1px
borders implemented as shadows, not the same use-case),
`shadow-[0_0_8px_rgba(…)]` patterns (glow effects).

### Password strength meter

`frontend/pages/Auth.tsx:72-74` and `frontend/pages/ResetPassword.tsx:31-33`
return raw `bg-red-500` / `bg-yellow-500` / `bg-green-500`. Replace with
semantic tokens: `bg-destructive` / `bg-warning` / `bg-success`. The text
labels in `ResetPassword.tsx:45` (and any equivalent in `Auth.tsx`) use
the matching `text-destructive` / `text-warning` / `text-success`.

### PDF viewer `bg-white` (one comment)

`frontend/pdf-viewer/primitives/Viewer.tsx:177` keeps `bg-white` (PDF
pages are physical white paper, theme-independent). Add an inline
comment explaining the intent.

### `mock` engine eslint-disable

`frontend/pdf-viewer/engines/mock/index.ts:177` has a
`// eslint-disable-next-line @typescript-eslint/no-unused-vars` above a
function whose params already start with `_`. Verify the project's
`no-unused-vars` rule honours the `_` prefix; if so, remove the disable.
If not, leave it (we don't change the lint config in this PR).

### Density spot-fix (targeted)

Inspect the top body-copy offenders in `frontend/components/extraction/`:
`InstanceCard.tsx`, `InstanceEditor.tsx`, `FieldInput.tsx`,
`AISuggestionsPanel.tsx`. Replace `text-sm` with `text-[13px]` **only**
where the class applies to body / value text. Leave it on form labels,
button-style elements, header rows, and FormDescription / error helpers.

If a file has ≤2 body-copy occurrences, fix in place. If a file has
zero, skip and document in the PR body.

## Validation

After implementation:

- `npm run lint` — must pass clean.
- `npm test` — vitest unit/component, including any `ReviewerAvatarStack`
  test if present.
- Manual smoke: toggle dark mode in the app, open a dropdown menu
  (sidebar header), open the ImportTemplateDialog, look at the reviewer
  avatar stack on a Run row, render a password strength bar. No flash,
  no wrong contrast, focus rings intact.

## Risks

- **Shadow alpha tuning** — dark-mode shadow values (0.35–0.40) are an
  educated guess. The first PR pass may need a follow-up if the shadows
  read as muddy. Verification step covers this.
- **Reviewer palette legibility** — the `/20` tint may be too soft in
  light mode for some hues. If `text-reviewer-N` fails WCAG AA on
  `bg-reviewer-N/20`, fall back to `text-foreground` for the initials
  and keep the colour as the surface only.
- **`--primary-hover` cascade** — the token is currently `hsl(undefined)`
  in production. Defining it changes the hover state of any element
  using `hover:bg-primary-hover`. Grep before merge to confirm the set
  of consumers is small.

## Out of scope (tracked for follow-up)

- Playwright visual-regression snapshots for dark mode across
  ExtractionFullScreen, ImportTemplateDialog, HITL session,
  ConsensusPanel, extraction list.
- Adding tonal variants to the reviewer palette (`bg-reviewer-1/30`,
  `/40`) — defer until a consumer needs them.
- Reviewer palette over 5 reviewers — `colorFor()` cycles through the
  same 5 hues; collisions are acceptable for the avatar-stack use case.
