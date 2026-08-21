---
status: draft
last_reviewed: 2026-08-20
owner: '@raphaelfh'
---

# Tailwind CSS v4 migration — design

> **Status:** Draft · Date: 2026-08-20 · Deciders: @raphaelfh
> **Scope:** move the frontend from `tailwindcss` 3.4.19 to 4.3.3 — CSS-first
> `@theme`, the `@tailwindcss/postcss` plugin, and the call-site renames v4
> requires. No visual redesign, no shadcn regeneration, no OKLCH conversion.
> **Supersedes:** dependabot PR #550, which should be closed rather than merged.

## Problem

Dependabot #550 proposes `tailwindcss` 3.4.19 → 4.3.3. It fails four checks
(Frontend Build, Frontend Tests, Frontend E2E, Vercel) with a single root cause:

```text
Error: [postcss] It looks like you're trying to use `tailwindcss` directly as a
PostCSS plugin. The PostCSS plugin has moved to a separate package…
  at frontend/pdf-viewer/primitives/text-layer.css
```

v4 is not a version bump. It moves the PostCSS plugin to its own package,
replaces `tailwind.config.ts` with a CSS-first `@theme` block, changes several
utility names, and alters the semantics of others. A `^`-range bump cannot
express that, so #550 can never go green on its own.

### Why this needed measuring before planning

The obvious way to scope this — grep the renamed utilities and count the hits —
produces a number roughly **ten times** the real one. Raw counts say ~840 call
sites are at risk. The verified figure is **95 mechanical edits and 5 sites
needing judgement**.

The scoping below was therefore done empirically: the exact proposed artifact
(`tailwindcss@4.3.3`) was extracted from the npm cache and this repo's real
class strings were compiled against it. Claims marked **[compiled]** are output
from v4.3.3, not inference from release notes. That distinction matters, because
every one of the three largest feared risks turned out to be a non-issue, and
none of them could have been dismissed by reading docs.

## Constraints verified before designing

- `frontend/index.css:186-190` contains `@layer base { * { @apply border-border; } }`.
- `tailwind.config.ts:105-108` overrides `borderRadius.sm` to `calc(var(--radius) - 4px)`.
- Only 4 CSS files exist under `frontend/`; only `index.css` uses `@tailwind`/`@apply`.
- `postcss.config.js` is the single PostCSS config, auto-discovered by **both**
  `vite.config.ts` and `vitest.config.ts` (neither declares a `css` key).
- 13 of 54 `frontend/components/ui/*.tsx` primitives have no live importer
  (`toggle` is reachable only from `toggle-group`, itself unused).
- `tailwind-merge` is already at 3.6.0, which supports v4.0–v4.3. The repo is
  running a **mismatched** pair today; 4.3.3 sits at the top of its window.

## The three risks that are already dead

These dominated the initial estimate. All three are empirically void, and this
section exists so they are not re-raised in review.

**1. Default border colour → `currentColor`. Neutralized; 0 sites, not 126.**
v4's preflight sets `border: 0 solid` on `*` and pseudo-elements. The repo's own
`* { @apply border-border }` compiles to `* { border-color: hsl(var(--border)) }`
**159 lines later** at identical `(0,0,0)` specificity, so it wins — the same
cascade position it occupies under v3 today **[compiled]**. The theoretical hole
(pseudo-elements, which bare `*` does not match) is empty: the repo has zero
pseudo-element borders. And the failure mode is loud, not silent — if the port
ever drops `--color-border`, `@apply border-border` throws
*"Cannot apply unknown utility class"* at build time.

**2. `tailwindcss-animate` must be replaced with `tw-animate-css`. False.**
Loaded under real v4.3.3 via `@plugin "tailwindcss-animate"`, every token emits
**byte-identical values to v3** — `animate-in`, `fade-in-0`, `zoom-in-95`,
`slide-in-from-top-2`, arbitrary variants, `fill-mode-forwards` **[compiled]**.
All 169 tokens across 16 files need **zero edits**. (Do move the package from
`dependencies` to `devDependencies` — it currently sits inside the blocking
production `npm audit --omit=dev` scope.)

**3. `@tailwindcss/container-queries` syntax breaks. False.**
v4 core accepts the bare arbitrary form natively: `@[48rem]/headerbar:gap-4`
emits the identical rule to `@min-[48rem]/headerbar:gap-4`, and `@sm/@md/@lg`
resolve to the same 24/28/32rem scale **[compiled]**. Delete the plugin; all 19
sites keep working untouched.

Add the other confirmed no-ops — 624 alpha-modifier sites (`bg-primary/10`
emits an opaque fallback plus a `color-mix` `@supports` pair; measured delta
≤1/255 on one channel in 21 of 1848 sampled combinations), ~60 bare `rounded`,
7 bare-CSS-var widths, 3 `theme()` calls — and roughly **840 flagged call sites
need zero edits**.

## Design

### Phase 0 — pre-migration hygiene

Delete `theme.container` (0 real uses), `fontSize.header-micro`, the 3 dead
`content` globs pointing at non-existent directories, the 3 dead `.linear-*`
classes, `.scrollbar-none`, and the 2 hand-rolled `.line-clamp-*` rules core
already ships. Add `shadow-elev-header` to the twMerge classGroup at
`frontend/lib/utils.ts:14` — a pre-existing bug (7 usages, absent from the
group, so it does not dedupe).

Separate because folding it into the port makes the before/after CSS diff
unreadable, and that diff is the primary verification artifact.

### Phase 1 — record the v3 CSS baseline

Add a script that compiles `frontend/index.css` and emits a sorted
`selector → declarations` snapshot. **Run it on v3 and commit the baseline.**

This is the single most important sequencing decision in the plan. Recording the
baseline *after* the port certifies the migration against itself and destroys
the only real verification mechanism. Validated as practical: compiling today's
stylesheet takes ~1.0s and yields 1147 distinct class selectors / ~143KB.

### Phase 2 — the migration (necessarily one atomic PR)

The toolchain and the theme cannot be split: the moment `@tailwindcss/postcss`
lands, the `@tailwind` directives and the theme port must land with it or the
build is red.

| Change | Detail |
|---|---|
| Add `@tailwindcss/postcss`, drop `autoprefixer` | v4 bundles prefixing; no browserslist config exists |
| `postcss.config.js` | `tailwindcss: {}` → `'@tailwindcss/postcss': {}` — one edit covers Vite **and** Vitest |
| `index.css:23-25` | `@tailwind` ×3 → `@import "tailwindcss";`, hoisted **above** the hand-written `@keyframes` at lines 1-21 |
| Theme port | 41 colors + 3 shadows + fontSize + borderRadius → `@theme inline`. The 93 `:root`/`.dark` custom properties **do not move and are not restated** |
| `darkMode: ["class"]` | → `@custom-variant dark (&:is(.dark *));` — omitting it silently reverts 22 `dark:` utilities to `prefers-color-scheme` |
| `zIndex.header` | → `@utility z-header { z-index: var(--z-header); }` (v4 has no `--z-*` namespace) |
| keyframes/animation | → literal `@keyframes` + `--animate-accordion-*`; sole consumer is `accordion.tsx:43` |
| Plugins | keep `tailwindcss-animate` + `@tailwindcss/typography` as `@plugin`; **delete** `@tailwindcss/container-queries` |
| `content` globs | delete; add explicit `@source "../frontend";` rather than trusting auto-detection |
| `components.json` | `"config": ""` — affects the next `shadcn add`, not the build |

Then the two renames — the entire mechanical surface:

| Token | Count | Note |
|---|---|---|
| `outline-none` → `outline-hidden` | **84 / 55 files** | Variant-prefixed forms rewrite safely; the variant precedes the token |
| `shadow-sm` → `shadow-xs` | **11 / 9 files** | v4 renumbered the scale: v4 `shadow-xs` == v3 `shadow-sm`. Leaving these makes every card visibly heavier |

**Do not rename `rounded-sm` → `rounded-xs`.** `tailwind.config.ts:105-108`
overrides `borderRadius.sm` to `calc(var(--radius) - 4px)` = 4px, which survives
the port unchanged; `rounded-xs` is a fixed 2px. The rename halves the radius at
all 31 sites. `npx @tailwindcss/upgrade` **will** apply it automatically because
it cannot see the override — so run the codemod only for the two renames above,
then diff.

### Phase 3 — the five judgement calls

Design decisions, not migration mechanics; they want an eye, not a green build.

1. `ExtractionInterface.tsx:231` — a wrapping 2-col grid with `divide-x divide-y`.
   Broken in *both* versions (v3 paints spurious rules left/top, v4 right/bottom);
   needs a different technique, not a rename.
2. `QASectionAccordion.tsx:220,275` — `space-y-1 divide-y` with `pt-1` children;
   every divider moves 4px up. A HITL review surface where scan density matters.
3. `TemplateGridFieldRow.tsx:225-226` — the only element combining
   `focus-visible:outline-none` with a real visible outline; selected and focus
   states interact and twMerge will not collapse them.
4. `ring-offset-*` — 17 of 48 class strings set a width with no explicit offset
   colour. One look, likely no change.
5. The 29 bare `outline-none` sites — see Open questions.

### Phase 4 — dead-code cleanup (independent)

Delete the 13 unused `ui/` primitives. Orthogonal; do not entangle it with the
port. They hold 63 of the 169 animate tokens, so doing this first shrinks the
Phase-2 diff.

## Verification

**Primary gate: a compiled-CSS diff.** Snapshot `(selector → declarations)`
before, recompile after, diff. It converts an unbounded "look at every screen"
problem into a text diff a human can read, and it is the only mechanism that
catches a changed source-detection root or a silently dropped utility — the one
real hazard of v4 replacing explicit `content` with auto-detection.

Expected shape of a *clean* diff, so reviewers know what good looks like:

- ~624 `hsl(var(--x) / .N)` rules gain an opaque fallback + `color-mix` `@supports` pair
- ~259 `hover:*` rules wrapped in `@media (hover: hover)`
- ~314 `space-y/x-*` selectors `> * + *` → `:where(… > :not(:last-child))`, logical margins
- `.outline-none` → `.outline-hidden` with a `forced-colors` block
- 11 `shadow-sm` → `shadow-xs`
- **`.rounded`, `.rounded-sm`, `.rounded-md`, `.rounded-lg` byte-identical.** If
  `rounded-sm` changed, the codemod ran the rename — revert it.

**Secondary gate: `/design-review` on four surfaces**, which between them cover
every confirmed risk: Dashboard (card `shadow-sm`), any Dialog/Popover (animate +
`shadow-elev-*`), QASectionAccordion (the divider shift), and ExtractionInterface's
stat grid **below 640px** — which no existing test exercises, since
`playwright.config.ts` declares only Desktop Chrome projects and no
`setViewportSize` anywhere. Force dark via
`localStorage.setItem('prumo:theme','dark')`; next-themes re-syncs a bare
classList toggle.

**What must not be relied on.** None of these would catch a v4 regression:

- vitest — asserts class *strings* in jsdom, which applies no stylesheet. Its ~44
  pinned-class assertions are useful codemod tripwires, but **none asserts
  `outline-none` or `shadow-sm`**, i.e. exactly the two renames being made.
- the E2E suite — behaviour only; zero `toHaveScreenshot`, zero `toHaveCSS`,
  zero geometry assertions. No visual-regression capability exists in this repo.
- `npm run typecheck` — `tailwind.config.ts` is in no tsconfig project.
- `npm run lint` and the fitness checkers — neither reads any styling file.
- `make quality-scan` — it never runs `npm run build`; the build gate is CI-only.

## Risks

| Risk | Mitigation |
|---|---|
| Baseline recorded after the port | Phase 1 is a separate, earlier PR. Top risk and purely procedural |
| `@tailwindcss/upgrade` run unsupervised | Halves the radius at 31 sites. Use it for the two renames only, then diff |
| Scope creep into OKLCH conversion | **Optional.** `hsl(var(--x))` works verbatim under v4 [compiled]. Converting 82 tokens would break the raw-triple consumers at `index.css:217/224/230` and turn 1 day into several with an uncheckable diff |
| Scope creep into "just re-run `shadcn add`" | The `ui/` surface has diverged on four axes (156 `forwardRef` vs `data-slot`, 27 individual Radix deps vs unified, two custom button sizes, retuned values) and 11 of 54 files are not in the registry at all. That is a redesign, not this project |
| `vercel.json` uses `npm install`, CI uses `npm ci` | With `^4.3.3`, production can float to a newer 4.x than CI proved. See Open questions |

## Open questions

1. **`@tailwindcss/postcss` or `@tailwindcss/vite`?** Recommend **postcss**: one
   config file already covers Vite and Vitest, whereas the Vite route needs
   wiring into both (or into `vite.shared-plugins.ts`, which exists precisely
   because those two drifting once caused a silent gap). Note this contradicts
   `.claude/skills/ui-styling/references/tailwind-v4.md:86`, which is stale.
2. **The 29 bare `outline-none` sites.** `outline-hidden` preserves today's
   always-on transparent outline; v4's `outline-none` removes it. The latter is
   arguably correct but diverges from `a11y.md:191-192`. Blanket-rename, or split
   55 variant-prefixed → `outline-hidden` and leave 29 bare as `outline-none`?
3. **`z-header`: keep as `@utility`, or collapse to `z-[var(--z-header)]`?** The
   latter also fixes a verified twMerge blind spot — `cn()` registers no z-index
   classGroup, so `twMerge("z-header z-50")` returns *both* today.
4. **Switch `vercel.json` to `npm ci`?** One line, but it changes deploy
   behaviour for every future PR.
5. **Update the three stale `ui-styling` skill files in the same PR?**
   `SKILL.md:63`, `a11y.md:181,191-192` and `shadcn-cli.md:60` teach
   `focus-visible:outline-none` and `shadow-sm` as house style; left stale, every
   future agent reintroduces the v3 spellings.

## Explicitly out of scope

- Visual redesign of any surface; the goal is a byte-justifiable CSS diff.
- Regenerating or re-styling `frontend/components/ui/**` against the shadcn v4 registry.
- Converting the 93 HSL custom properties to OKLCH.
- Adding visual-regression tooling. Worth doing, but it must not gate this migration.

## Effort

**~1 focused day, plus a second day of slack for the design pass.**

| Phase | Work | Est. |
|---|---|---|
| 0 | 6 dead-code deletions + 1 twMerge line | 0.5 h |
| 1 | CSS baseline script (~40 lines, validated at 1.0s / 1147 selectors) | 0.5 h |
| 2 | toolchain swap | 0.5 h |
| 2 | theme port (~50 lines, every construct compiled-verified) | 2 h |
| 2 | 95 renames across 62 files, one supervised codemod pass | 0.5 h |
| 2 | **CSS diff review — the real cost** | 2 h |
| 3 | 5 judgement calls + design review, 4 surfaces × 2 widths × 2 themes | 2–3 h |

The dominant remaining cost is reading the CSS diff; the dominant remaining risk
is procedural (baseline ordering, codemod supervision), not technical.

## Definition of done

- `tailwindcss` 4.x installed; `tailwind.config.ts` deleted; `@tailwindcss/container-queries`
  and `autoprefixer` removed; `tailwindcss-animate` moved to `devDependencies`.
- Frontend Build, Frontend Tests, Frontend E2E, Vercel and `npm audit --omit=dev
  --audit-level=high` all green on `dev`.
- The Phase-1 CSS diff reviewed line by line, with `.rounded*` confirmed byte-identical.
- `/design-review` clean on the four named surfaces at 1280 and 390, light and dark.
- PR #550 closed as superseded, referencing this spec.
- The stale `ui-styling` skill references updated (or a follow-up issue opened).

## References

- Dependabot PR #550 (superseded by this spec)
- `.claude/skills/ui-styling/references/tailwind-v4.md` — stale; says 3.4.17,
  recommends `@variant` where v4 uses `@custom-variant`, omits the PostCSS package
- `docs/superpowers/specs/2026-07-25-react-router-v8-migration-design.md` — the
  prior "dependency bump that is actually a migration" precedent
