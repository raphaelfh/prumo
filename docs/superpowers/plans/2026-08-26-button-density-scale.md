---
status: in_progress
last_reviewed: 2026-08-26
owner: '@raphaelfh'
---

# Button & Density Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dense heights the `frontend-ux` language demands into
first-class named button sizes, migrate the extraction call sites off their
ad-hoc height overrides, and gate the drift so it cannot return.

**Architecture:** Split into two PRs. **PR1** lands the ratchet with zero
runtime change. **PR2** retunes the scale and migrates call sites, reviewed
visually. The split exists because an adversarial panel proved the single-PR
version both mis-measured its own scope and could not be reviewed by diff.

**Tech Stack:** React 19 + TypeScript strict, `class-variance-authority`,
Tailwind v4, Vitest + Testing Library, Python 3.11 fitness checkers + pytest.

## Global Constraints

- **English only** for code, comments, commits, docs, and copy keys.
- All user-facing copy goes through `frontend/lib/copy/`.
- No dead code ships: `npm run deadcode` and `npm run deadcode:production`
  both at zero. (Not bare `npx knip` — the npm scripts pin `--no-tag-hints`.)
- React Compiler: no `try`/`finally`/`throw` in component bodies.
- Frontend tooling runs from the **repo root**.
- **Type-checking is `npm run typecheck`.** `npx tsc --noEmit` compiles zero
  files here — the root tsconfig is solution-style (`scripts/verify_all.sh:187`).
- Conventional commits; PR targets `dev`.

---

## PR1 — the ratchet (zero runtime change) — ✅ COMPLETE

Landed the gate without touching a single rendered pixel, so it is reviewable
by reading the diff.

- [x] **`scripts/fitness/check_button_scale.py`** — a depth-aware JSX parser,
      deliberately not a regex. Walks each `<Button>` opening tag past braces,
      parens and every string flavour, so a `>` inside `() =>` or `a >= b` does
      not end the tag early; reads `className` as a literal (single/double
      quoted) **or** a braced expression, extracting every string inside, so
      `className={cn("h-8")}` and template literals are both covered. Strips
      comments first. `min-h-*`/`max-h-*` are not overrides; `[&_svg]:h-3.5`
      targets a descendant; `sm:h-8` is an override. Supports `--repo-root`,
      `--baseline`, `--update-baseline`, `--jsonl-out`, `--emit-telemetry`
      per the `scripts/fitness/README.md` harness contract.
- [x] **`check_button_scale.baseline`** — seeded at ground truth: **151
      overrides across 62 files**.
- [x] **`test_check_button_scale_canary.py`** — 18 cases. Six encode the forms
      the naive regex missed (`cn()`, arrow before className, `>=` before
      className, single quotes, template literal, multiline tag); five encode
      what must *not* be flagged (child icon height, `min-h`/`max-h`,
      `[&_svg]:`, comments, `<ButtonGroup`).
- [x] **`test_check_button_scale.py`** — green path with **no flags**, so it
      exercises the default `--repo-root`/`--baseline` wiring the canary never
      touches. Asserts the baseline is non-empty and that scanning the real
      tree with `--baseline /dev/null` exits 1 — without that, a checker whose
      paths silently resolve to nothing would exit 0 forever and the gate
      would lie green.
- [x] **`run_all.sh`** registration as `check_button_scale.py` (filename
      label, matching all ten siblings). Runs in 123 ms.
- [x] **`fitness-functions.md`** paragraph — step 6 of the README's
      "Adding a new check", which the first draft skipped.
- [x] **`frontend/components/ui/button.test.tsx`** — characterization tests
      pinning the CURRENT scale (`sm`=h-9, `icon`=h-10, `header`=h-8), so
      PR2's retune surfaces as a readable test diff. Assertions read the
      rendered `className`, never `buttonVariants()`'s raw output — the raw
      string can hold two conflicting classes and only `cn()` picks a winner,
      so a raw-string assertion passes whether or not the class applies.

**Evidence:** 109 passed in `backend/tests/unit/scripts/`; 9 passed in
`button.test.tsx`; `run_all.sh` all-OK with the new check.

---

## PR2 — the scale retune (visual, needs review) — NOT STARTED

Every item below is a panel finding. None may be re-discovered at
implementation time.

### Task 1: Retune the scale

**Files:** `frontend/components/ui/button.tsx`,
`frontend/components/ui/button.test.tsx`,
`frontend/components/navigation/SectionViewSwitcher.tsx:62,77`,
`frontend/components/layout/HeaderIconButton.tsx:20`

- [ ] **Step 1: Update the characterization tests to the target scale**

Change the `it.each` table in `button.test.tsx` to the new heights, add the
`xs` and `icon-xs` rows, and flip the "does NOT yet carry a coarse bump" test
to assert it now does. Run it: it must FAIL before the implementation.

- [ ] **Step 2: Write the scale**

```ts
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-7 rounded-md px-2.5 text-[13px] [@media(pointer:coarse)]:h-11",
        xs: "h-6 rounded-md px-2 text-xs [&_svg]:size-3.5 [@media(pointer:coarse)]:h-11",
        lg: "h-11 rounded-md px-8 text-sm",
        icon: "h-7 w-7 text-[13px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "icon-xs": "h-6 w-6 text-xs [&_svg]:size-3.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
```

Remove `text-sm` from the cva base string. Note `icon`/`icon-xs` keep an
explicit `text-` class — `AllowedUnitsList.tsx` renders literal `↑`/`↓`/`×`
glyphs as button text children, which would otherwise inherit ambient size.

**`icon-lg` is deliberately absent** — zero call sites, and knip cannot see
cva variant keys, so nothing would flag it as dead.

- [ ] **Step 3: Migrate the two orphaned sizes**

`SectionViewSwitcher.tsx:77` `size="header"` → `size="sm"`; **and line 62**,
which hand-rolls the sibling tab at `h-7 text-header-meta` — migrate both or
the control carries two type sizes. `HeaderIconButton.tsx:20`
`size="header-icon"` → `size="icon"`; update its JSDoc at line 7, which says
"a 32px ghost icon button". Delete `header`/`header-icon` from the cva.

- [ ] **Step 4: Verify**

```bash
npx vitest run frontend/components/ui/button.test.tsx
npm run typecheck
```

`typecheck` is what proves no call site still names a deleted size.

### Task 2: Migrate the 60 extraction overrides across 23 files

Regenerate the exact list — do not reuse the first draft's, which was the blind
regex's output:

```bash
python3 scripts/fitness/check_button_scale.py --baseline /dev/null \
  | grep 'components/extraction'
```

**Mapping rule — height AND width together:**

| Current | Becomes |
|---|---|
| `size="icon"` + `h-7 w-7` / `h-8 w-8` | `size="icon"`, drop **both** classes |
| `size="icon"` + `h-6 w-6` / `h-5 w-5` / `h-4 w-4` | `size="icon-xs"`, drop **both** |
| text button + `h-8` / `h-7` | `size="sm"`, drop the class |
| text button + `h-6` | `size="xs"`, drop the class |

**32 of the 60 carry a paired `w-N`.** Dropping only the `h-` leaves the width
fighting the scale — a 28×32 rectangle that no unit test would catch and the
gate would pass.

- [ ] Migrate, then `npm run test:run`, `npm run typecheck`, `npm run lint`.
- [ ] `python3 scripts/fitness/check_button_scale.py --update-baseline` and
      read `git diff` on the baseline: all 23 `extraction/**` entries gone.
      **Do not treat the shrink alone as proof** — wrapping a class in `cn()`
      also shrinks it. Pair it with `git diff -U0 frontend/components/extraction | grep -c 'h-'`.

### Task 3: Reconcile both skills

- [ ] `.claude/skills/frontend-ux/SKILL.md` §3 — the scale table, the rule
      "never write a height into a Button's className", and the gate pointer.
      §6 checklist line. Also update "Icons are `h-4 w-4`" — `xs`/`icon-xs`
      introduce 14px icons.
- [ ] `.claude/skills/ui-styling/SKILL.md:92` — it currently says keep `ui/*`
      close to upstream shadcn so `shadcn add` diffs stay clean, and hard rule
      4 says "always extend the base via `className`". Both now have an
      explicit exception for height. Reconcile or the skills contradict.

### Task 4: Visual verification

- [ ] `preview_start` (never `npm run dev` via Bash). Worktree traps: `.env`
      resolves from the parent, port 8080 may be held by the main checkout.
- [ ] Extraction surfaces: Configuration with and without an active template,
      the sections/fields grid, the model-picker popover, a run view.
- [ ] Collateral: runs, articles, project settings, user settings, feedback,
      dashboard, **and `frontend/pdf-viewer/`** (a separate package, 10
      overrides, whose `NavigationControls`/`ZoomControls` are where a 12px
      icon-button shrink is most likely to break an overlay).
- [ ] **Touch:** `resize_window` preset `mobile`, then **reload**. A desktop
      browser narrowed to 375px still reports `pointer: fine`, so a plain
      resize verifies nothing. Confirm the 10 square `h-N w-N` sites outside
      `extraction/` are not 44×24 rectangles.
- [ ] Attach screenshots to the PR. A screen not looked at is not verified.
