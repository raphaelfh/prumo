# Dark/Light UX tokenization & polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tokenize 5 inline visual patterns (reviewer palette, card/popover shadows, primary-hover), fix a dead `--primary-hover` reference, swap raw color classes in the password meter for semantic tokens, and apply a targeted density audit on 4 extraction surfaces.

**Architecture:** All changes are frontend-only, design-system level. Two token registries get extended (`frontend/index.css` for HSL+shadow vars, `tailwind.config.ts` for Tailwind mapping). Then consumers are migrated one component at a time, with a vitest unit test guarding the reviewer-stack hash determinism.

**Tech Stack:** Tailwind 3.4.17, shadcn/ui, CSS variables, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-22-dark-light-ux-tokenization-design.md`

## Postmortem — utility-class rename after smoke test

The plan below originally proposed Tailwind utilities named `shadow-card`
and `shadow-popover`. In-browser smoke testing revealed that these names
collide with `colors.card` / `colors.popover`: Tailwind compiled
`shadow-popover` as a colour modifier (only `--tw-shadow-color`,
no `box-shadow`), leaving dropdowns and cards visually flat. Two fixes
landed on top of the plan (see commit `29e140b`):

1. **Tailwind `boxShadow` keys renamed** to `elev-card` / `elev-popover`,
   producing utilities `shadow-elev-card` and `shadow-elev-popover`. The
   CSS variables `--shadow-card` / `--shadow-popover` keep their
   descriptive names.
2. **`cn()` extended via `extendTailwindMerge`** so the new utilities are
   recognised as part of the `shadow` class group and dedupe correctly
   against the `<Card>` base `shadow-sm`.

Treat any `shadow-card` / `shadow-popover` reference below as
`shadow-elev-card` / `shadow-elev-popover` in the final state.

---

## Task 1: Add tokens to `frontend/index.css` and `tailwind.config.ts`

**Files:**
- Modify: `frontend/index.css` (`:root` block lines 30–85, `.dark` block lines 87–137)
- Modify: `tailwind.config.ts` (`theme.extend.colors` lines 17–78, add `boxShadow` sibling)

- [ ] **Step 1: Add HSL tokens to `:root` in `frontend/index.css`**

Insert these inside the existing `:root` block, immediately **after** the existing `--ai-foreground` line and **before** `--border`:

```css
    /* Reviewer palette — used by ReviewerAvatarStack to colour avatar
       bubbles deterministically by user_id hash. Same hue intent as the
       legacy sky/emerald/amber/violet/rose 200/800 pair. */
    --reviewer-1: 199 89% 48%;   /* sky    */
    --reviewer-2: 158 64% 40%;   /* emerald */
    --reviewer-3: 38 92% 50%;    /* amber  */
    --reviewer-4: 262 83% 58%;   /* violet */
    --reviewer-5: 350 89% 60%;   /* rose   */

    /* Shadows — soft elevation tokens. `card` for static surfaces,
       `popover` for floating menus / dropdowns. Defined as full
       box-shadow values (not HSL), consumed via Tailwind's
       boxShadow.card / boxShadow.popover mappings. */
    --shadow-card: 0 1px 3px rgb(0 0 0 / 0.05);
    --shadow-popover: 0 8px 30px rgb(0 0 0 / 0.04);

    /* Primary hover — slightly lighter than --primary in light mode
       (since --primary is near-black). Referenced from
       tailwind.config.ts:colors.primary.hover. */
    --primary-hover: 240 5.9% 20%;
```

- [ ] **Step 2: Add the same tokens to `.dark` block**

Insert inside `.dark` immediately **after** the existing `--ai-foreground` line and **before** `--border`:

```css
    /* Reviewer palette — lifted for dark-mode legibility. */
    --reviewer-1: 199 89% 60%;
    --reviewer-2: 158 64% 52%;
    --reviewer-3: 38 92% 60%;
    --reviewer-4: 262 83% 68%;
    --reviewer-5: 350 89% 70%;

    /* Shadows — higher alpha because dark backgrounds swallow low-alpha
       shadows. */
    --shadow-card: 0 1px 3px rgb(0 0 0 / 0.40);
    --shadow-popover: 0 8px 30px rgb(0 0 0 / 0.35);

    /* Primary hover — slightly darker than --primary in dark mode
       (since --primary is near-white). */
    --primary-hover: 0 0% 88%;
```

- [ ] **Step 3: Add reviewer + boxShadow mappings to `tailwind.config.ts`**

In `theme.extend.colors`, after the `ai` block (currently line 67) and before `sidebar` (currently line 68), insert:

```ts
        reviewer: {
          1: "hsl(var(--reviewer-1))",
          2: "hsl(var(--reviewer-2))",
          3: "hsl(var(--reviewer-3))",
          4: "hsl(var(--reviewer-4))",
          5: "hsl(var(--reviewer-5))",
        },
```

In `theme.extend`, after the `colors` block closes (around line 78) and before `borderRadius` (line 79), insert:

```ts
      boxShadow: {
        card: "var(--shadow-card)",
        popover: "var(--shadow-popover)",
      },
```

- [ ] **Step 4: Verify the build still compiles**

Run: `npm run build`
Expected: Build completes without errors. Tailwind picks up the new tokens.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.css tailwind.config.ts
git commit -m "feat(design-system): add reviewer/shadow/primary-hover CSS tokens

- 5-slot reviewer palette (--reviewer-1..5) for deterministic avatar
  colouring, with dark-mode lift.
- --shadow-card and --shadow-popover with higher dark-mode alpha so
  shadows remain visible on dark surfaces.
- Define --primary-hover (was referenced in tailwind.config.ts but
  undefined, resolving to hsl(undefined))."
```

---

## Task 2: Refactor `ReviewerAvatarStack` to use reviewer tokens (TDD)

**Files:**
- Modify: `frontend/components/runs/ReviewerAvatarStack.tsx:40-53`
- Create: `frontend/test/ReviewerAvatarStack.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/test/ReviewerAvatarStack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewerAvatarStack } from "@/components/runs/ReviewerAvatarStack";

describe("ReviewerAvatarStack", () => {
  it("renders nothing when reviewers list is empty", () => {
    const { container } = render(<ReviewerAvatarStack reviewers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses reviewer-* tokens (not raw sky/emerald/amber/violet/rose)", () => {
    render(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-a", name: "Alice" }]}
      />,
    );
    const avatar = screen.getByTitle("Alice");
    const className = avatar.className;
    // Must use a tokenized reviewer-N class.
    expect(className).toMatch(/bg-reviewer-[1-5]/);
    // Must NOT carry the legacy raw-palette classes.
    expect(className).not.toMatch(/bg-(sky|emerald|amber|violet|rose)-\d+/);
  });

  it("assigns the same colour to the same id (deterministic hash)", () => {
    const { rerender } = render(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-abc", name: "Alpha" }]}
        testId="t1"
      />,
    );
    const first = screen.getByTestId("t1-user-abc").className;
    rerender(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-abc", name: "Alpha" }]}
        testId="t1"
      />,
    );
    const second = screen.getByTestId("t1-user-abc").className;
    expect(first).toBe(second);
  });

  it("collapses overflow into a +N pill", () => {
    render(
      <ReviewerAvatarStack
        reviewers={[
          { id: "1", name: "A" },
          { id: "2", name: "B" },
          { id: "3", name: "C" },
          { id: "4", name: "D" },
          { id: "5", name: "E" },
        ]}
        max={3}
      />,
    );
    expect(screen.getByLabelText("+2 more")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/test/ReviewerAvatarStack.test.tsx`
Expected: The "uses reviewer-* tokens" assertion FAILS — current implementation still emits `bg-sky-200 ...`.

- [ ] **Step 3: Replace the PALETTE literal map**

In `frontend/components/runs/ReviewerAvatarStack.tsx`, replace lines 40–46 (the `PALETTE` const) with:

```ts
// Literal lookup map — Tailwind cannot scan dynamic class names, so each
// slot is a full string of class names. Opacity modifier `/20` (or `/30`
// in dark mode) gives the soft tint without needing a separate `200`
// shade per hue.
const PALETTE: readonly string[] = [
  "bg-reviewer-1/20 text-reviewer-1 dark:bg-reviewer-1/30 dark:text-reviewer-1",
  "bg-reviewer-2/20 text-reviewer-2 dark:bg-reviewer-2/30 dark:text-reviewer-2",
  "bg-reviewer-3/20 text-reviewer-3 dark:bg-reviewer-3/30 dark:text-reviewer-3",
  "bg-reviewer-4/20 text-reviewer-4 dark:bg-reviewer-4/30 dark:text-reviewer-4",
  "bg-reviewer-5/20 text-reviewer-5 dark:bg-reviewer-5/30 dark:text-reviewer-5",
] as const;
```

Keep `colorFor`, `initials`, and the rest of the component unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/test/ReviewerAvatarStack.test.tsx`
Expected: All 4 tests PASS.

- [ ] **Step 5: Verify legibility of `text-reviewer-N` on `bg-reviewer-N/20`**

Manual check: open the app, navigate to a Run with ≥3 reviewers, inspect the avatar stack in light and dark mode. If text reads correctly, proceed. If a hue (likely amber) fails AA contrast, fall back to `text-foreground` on that slot and re-run tests (the regex still passes because the test only requires `bg-reviewer-N`, but consider tightening if you change the contract).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/ReviewerAvatarStack.tsx \
        frontend/test/ReviewerAvatarStack.test.tsx
git commit -m "refactor(runs): use reviewer-* tokens in ReviewerAvatarStack

Replaces inline sky/emerald/amber/violet/rose 200/800 palette with the
new --reviewer-1..5 token-backed classes via a literal lookup map
(Tailwind cannot scan dynamic class strings).

Adds a vitest unit test guarding the deterministic-hash contract and
asserting no raw palette classes leak."
```

---

## Task 3: Migrate `shadow-popover` consumers

**Files:**
- Modify (replace `shadow-[0_8px_30px_rgb(0,0,0,0.04)]` → `shadow-popover`):
  - `frontend/components/articles/ArticleForm.tsx:1181`
  - `frontend/components/extraction/ArticleExtractionTable.tsx:880`
  - `frontend/components/extraction/ExtractionInterface.tsx` (lines 221, 232, 251, 310, 330, 451)
  - `frontend/components/extraction/FullAIExtractionProgress.tsx:48, 86`
  - `frontend/components/extraction/config/ConfigureTemplateFirst.tsx:25`
  - `frontend/components/layout/SidebarHeader.tsx:87`
  - `frontend/components/layout/UserMenu.tsx:60`
  - `frontend/components/quality/QualityAssessmentInterface.tsx:121, 135, 149`
  - `frontend/components/settings/SettingsCard.tsx:32`
  - `frontend/components/shared/list/FilterButtonWithPopover.tsx:52`
  - `frontend/components/shared/list/ListDisplaySortPopover.tsx:73`
  - `frontend/components/ui/dropdown-menu.tsx:64`

- [ ] **Step 1: Apply the search-and-replace**

Run (from repo root):

```bash
grep -rl "shadow-\[0_8px_30px_rgb(0,0,0,0\.04)\]" frontend/ \
  --include="*.tsx" --include="*.ts" \
  | xargs sed -i.bak 's|shadow-\[0_8px_30px_rgb(0,0,0,0\.04)\]|shadow-popover|g'
find frontend -name "*.bak" -delete
```

- [ ] **Step 2: Verify all literals are gone**

Run:

```bash
grep -rn "shadow-\[0_8px_30px_rgb(0,0,0,0\.04)\]" frontend/ \
  --include="*.tsx" --include="*.ts"
```

Expected: no output (zero remaining occurrences).

- [ ] **Step 3: Verify build still passes**

Run: `npm run build`
Expected: Tailwind compiles `shadow-popover` to `box-shadow: var(--shadow-popover)`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: No new warnings from these files.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "refactor(design-system): consume shadow-popover token

Replaces 19 inline shadow-[0_8px_30px_rgb(0,0,0,0.04)] occurrences
across articles, extraction, layout, quality, settings, shared, and
ui/dropdown-menu with the new shadow-popover token. Same visual in
light mode; better visibility in dark mode (higher alpha)."
```

---

## Task 4: Migrate `shadow-card` consumers

**Files:**
- Modify: `frontend/components/extraction/InstanceCard.tsx:94` — replace `shadow-[0_1px_2px_rgb(0,0,0,0.03)]` → `shadow-card`
- Modify: `frontend/components/extraction/hierarchy/ModelSelector.tsx:171` — replace `shadow-[0_1px_3px_rgb(0,0,0,0.04)]` → `shadow-card`
- Modify: `frontend/index.css:160` — replace `shadow-[0_1px_3px_rgba(0,0,0,0.05)]` (inside `linear-card`) → `shadow-card`. **Keep** the hover variant `shadow-[0_2px_8px_rgba(0,0,0,0.08)]` untouched (out of scope per spec).

- [ ] **Step 1: Edit `InstanceCard.tsx`**

In `frontend/components/extraction/InstanceCard.tsx:94`, replace the className string. The line currently reads:

```tsx
    <div className="bg-muted/30 rounded-lg border border-border/60 shadow-[0_1px_2px_rgb(0,0,0,0.03)]">
```

Change to:

```tsx
    <div className="bg-muted/30 rounded-lg border border-border/60 shadow-card">
```

- [ ] **Step 2: Edit `ModelSelector.tsx`**

In `frontend/components/extraction/hierarchy/ModelSelector.tsx:171`, replace:

```tsx
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-4 shadow-[0_1px_3px_rgb(0,0,0,0.04)]">
```

Change to:

```tsx
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-4 shadow-card">
```

- [ ] **Step 3: Edit `linear-card` in `frontend/index.css`**

The current `linear-card` block (lines 159–161) is:

```css
    .linear-card {
        @apply rounded-md border border-border/50 bg-card/30 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all hover:border-border hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)];
    }
```

Change to (keep hover variant untouched per spec):

```css
    .linear-card {
        @apply rounded-md border border-border/50 bg-card/30 shadow-card transition-all hover:border-border hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)];
    }
```

- [ ] **Step 4: Verify nothing else still uses these literals**

Run:

```bash
grep -rn "shadow-\[0_1px_3px_rgba(0,0,0,0\.05)\]\|shadow-\[0_1px_2px_rgb(0,0,0,0\.03)\]\|shadow-\[0_1px_3px_rgb(0,0,0,0\.04)\]" \
  frontend/ --include="*.tsx" --include="*.ts" --include="*.css"
```

Expected: no output.

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/InstanceCard.tsx \
        frontend/components/extraction/hierarchy/ModelSelector.tsx \
        frontend/index.css
git commit -m "refactor(design-system): consume shadow-card token

Collapses three near-identical card-shadow literals (linear-card,
InstanceCard, ModelSelector) into the new shadow-card token. Hover
variant on linear-card stays inline (out of scope)."
```

---

## Task 5: Password strength meter — semantic tokens

**Files:**
- Modify: `frontend/pages/Auth.tsx:60-75` (function `getPasswordStrength`) plus the JSX consumer of the colour (search for the bar render below this function)
- Modify: `frontend/pages/ResetPassword.tsx:20-34` (function `getPasswordStrength`) and `:44-46` (label colour)

- [ ] **Step 1: Update `getPasswordStrength` in `Auth.tsx`**

In `frontend/pages/Auth.tsx`, change lines 72–74:

```tsx
    if (strength <= 2) return {strength, labelKey: "strengthWeak", color: "bg-destructive"};
    if (strength <= 4) return {strength, labelKey: "strengthMedium", color: "bg-warning"};
    return {strength, labelKey: "strengthStrong", color: "bg-success"};
```

- [ ] **Step 2: Find the label-text equivalent in `Auth.tsx`**

Run: `grep -n "text-red-500\|text-yellow-500\|text-green-500\|strengthWeak\|strengthMedium\|strengthStrong" frontend/pages/Auth.tsx`

If the file contains a ternary mirroring the one in `ResetPassword.tsx:45` (`labelKey === "strengthWeak" ? "text-red-500" : ...`), replace those literals with `text-destructive` / `text-warning` / `text-success` to match.

If no such ternary exists in `Auth.tsx` (the colour might come entirely from `color` on the bar), leave the file unchanged beyond Step 1.

- [ ] **Step 3: Update `getPasswordStrength` in `ResetPassword.tsx`**

In `frontend/pages/ResetPassword.tsx`, change lines 31–33:

```tsx
    if (strength <= 2) return {strength, labelKey: "strengthWeak", color: "bg-destructive"};
    if (strength <= 4) return {strength, labelKey: "strengthMedium", color: "bg-warning"};
    return {strength, labelKey: "strengthStrong", color: "bg-success"};
```

- [ ] **Step 4: Update label colour in `ResetPassword.tsx:44-46`**

The current ternary at line 44–46 reads:

```tsx
                <span className={`font-medium ${
                    labelKey === "strengthWeak" ? "text-red-500" : labelKey === "strengthMedium" ? "text-yellow-500" : "text-green-500"
                }`}>{label}</span>
```

Change to:

```tsx
                <span className={`font-medium ${
                    labelKey === "strengthWeak" ? "text-destructive" : labelKey === "strengthMedium" ? "text-warning" : "text-success"
                }`}>{label}</span>
```

- [ ] **Step 5: Verify no raw red/yellow/green-500 remain in these two files**

Run: `grep -n "bg-red-500\|bg-yellow-500\|bg-green-500\|text-red-500\|text-yellow-500\|text-green-500" frontend/pages/Auth.tsx frontend/pages/ResetPassword.tsx`
Expected: no output.

- [ ] **Step 6: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 7: Manual smoke**

Open the app on `/auth` (signup mode) or trigger the reset-password flow, type a password, watch the strength bar cycle through `bg-destructive` (red) → `bg-warning` (orange) → `bg-success` (green). Toggle dark mode; verify the colours still read as red/orange/green and contrast remains OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/pages/Auth.tsx frontend/pages/ResetPassword.tsx
git commit -m "refactor(auth): semantic tokens in password strength meter

Replaces raw bg-red-500/bg-yellow-500/bg-green-500 with
bg-destructive/bg-warning/bg-success in Auth and ResetPassword.
Matching text-* labels updated where present."
```

---

## Task 6: PDF viewer `bg-white` — explanatory comment

**Files:**
- Modify: `frontend/pdf-viewer/primitives/Viewer.tsx:175-180`

- [ ] **Step 1: Add the inline comment**

In `frontend/pdf-viewer/primitives/Viewer.tsx`, lines 175–180 currently read:

```tsx
  return (
    <div data-page-number={pageNumber} className="relative shadow-md bg-white">
      {children}
    </div>
  );
}
```

Change to:

```tsx
  return (
    // bg-white is intentional, not a missed token: a PDF page is a
    // physical sheet of white paper. It must stay white in both light
    // and dark themes so the page contents render with the contrast
    // and colour the document author intended.
    <div data-page-number={pageNumber} className="relative shadow-md bg-white">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/pdf-viewer/primitives/Viewer.tsx
git commit -m "docs(pdf-viewer): explain why PDF page surface stays bg-white"
```

---

## Task 7: Remove unnecessary `eslint-disable` in mock engine

**Files:**
- Modify: `frontend/pdf-viewer/engines/mock/index.ts:177`

**Verification:** `eslint.config.js:28-32` sets `argsIgnorePattern: "^_"`, so params named `_source` and `_opts` are already exempt from the unused-vars rule. The disable directive is dead code.

- [ ] **Step 1: Remove the disable directive**

Lines 177–180 currently read:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async load(_source: PDFSource, _opts?: LoadOptions): Promise<PDFDocumentHandle> {
    return new MockDocumentHandle(this.cfg);
  }
```

Change to:

```ts
  async load(_source: PDFSource, _opts?: LoadOptions): Promise<PDFDocumentHandle> {
    return new MockDocumentHandle(this.cfg);
  }
```

- [ ] **Step 2: Verify lint passes**

Run: `npx eslint frontend/pdf-viewer/engines/mock/index.ts`
Expected: no warning, no error.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/engines/mock/index.ts
git commit -m "chore(pdf-viewer): drop unnecessary eslint-disable on mock engine

argsIgnorePattern: \"^_\" in eslint.config.js already exempts _source
and _opts. The disable directive was dead."
```

---

## Task 8: Density spot-fix — `text-sm` → `text-[13px]` on body copy

**Files (read and edit in order; skip a file if it has no body-copy hit):**
- `frontend/components/extraction/InstanceCard.tsx`
- `frontend/components/extraction/InstanceEditor.tsx`
- `frontend/components/extraction/FieldInput.tsx`
- `frontend/components/extraction/AISuggestionsPanel.tsx`

**Decision rule per occurrence:**

| `text-sm` on… | Action |
|---|---|
| `<p>`, `<span>`, `<div>` rendering article/field VALUE text | Replace with `text-[13px]` |
| `<Label>`, `<FormLabel>`, header row, button text, `<FormDescription>`, error helper | **Leave alone** |
| Empty-state hint copy ("No fields yet…", inline help) | Replace with `text-[13px]` |
| Tooltip / sr-only / aria-related text | Leave alone |

- [ ] **Step 1: Audit `InstanceCard.tsx`**

Run: `grep -n "text-sm" frontend/components/extraction/InstanceCard.tsx`

For each hit, read 3 lines of context (`grep -n -A 3 "text-sm" …`). Apply the decision rule. Replace only the qualifying occurrences with `text-[13px]`.

- [ ] **Step 2: Audit `InstanceEditor.tsx`**

Run: `grep -n "text-sm" frontend/components/extraction/InstanceEditor.tsx`

Same rule. Replace only qualifying body-copy occurrences.

- [ ] **Step 3: Audit `FieldInput.tsx`**

Run: `grep -n "text-sm" frontend/components/extraction/FieldInput.tsx`

Same rule. The bulk of `text-sm` here may be on `<Label>` and form helpers — expect few qualifying changes (possibly zero).

- [ ] **Step 4: Audit `AISuggestionsPanel.tsx`**

Run: `grep -n "text-sm" frontend/components/extraction/AISuggestionsPanel.tsx`

Same rule.

- [ ] **Step 5: Document the diff**

After all four files are audited, run:

```bash
git diff --stat frontend/components/extraction/InstanceCard.tsx \
                frontend/components/extraction/InstanceEditor.tsx \
                frontend/components/extraction/FieldInput.tsx \
                frontend/components/extraction/AISuggestionsPanel.tsx
```

Expected: a small number of line changes (single-digit per file). If a file shows zero changes, that is the legitimate "no qualifying body-copy `text-sm`" outcome.

- [ ] **Step 6: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 7: Manual smoke**

Open one extraction screen with an InstanceCard, an editor, a FieldInput, and an AI-suggestions panel visible. Compare body copy against neighbouring `text-[13px]` rows (e.g. the `linear-list-item` rows). Ensure no visual jank.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/extraction/
git commit -m "style(extraction): align body-copy density with frontend-ux 13px rule

Spot-fix audit on InstanceCard, InstanceEditor, FieldInput, and
AISuggestionsPanel. Replaces text-sm with text-[13px] only on body /
value text — labels, headers, buttons and form helpers unchanged."
```

---

## Task 9: Final verification

**Files:** none modified — this is a verification-only task.

- [ ] **Step 1: Full lint**

Run: `npm run lint`
Expected: no new warnings or errors. Pre-existing warnings (if any) unchanged.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: production build completes.

- [ ] **Step 3: Full vitest run**

Run: `npm test`
Expected: all tests pass, including the new `ReviewerAvatarStack.test.tsx`.

- [ ] **Step 4: Manual smoke — light mode**

Open the app (`make start` if not running). Toggle to light mode. Visit:
  1. Sidebar header (dropdown menu shadow → `shadow-popover`)
  2. `/articles` filter popover (shadow + density)
  3. A Run with ≥3 reviewers (`ReviewerAvatarStack` colours)
  4. Extraction screen (InstanceCard shadow + density)
  5. `/auth` signup (password meter colours)

Verify no obvious regressions.

- [ ] **Step 5: Manual smoke — dark mode**

Toggle dark mode. Re-walk the same 5 surfaces. Specifically check:
  - Shadows are visible (not invisible-on-dark)
  - Reviewer avatar text reads against the `/30` bg
  - Password meter colours read correctly
  - Primary hover state on buttons (any element using `hover:bg-primary-hover`) actually changes colour now

- [ ] **Step 6: Final summary commit (only if anything tweaked during smoke)**

If manual smoke revealed an alpha or hue that needs adjusting, fix in `frontend/index.css` and commit:

```bash
git add frontend/index.css
git commit -m "fix(design-system): tune dark-mode shadow alpha after smoke test"
```

Otherwise, no commit. Plan is complete.

---

## Files touched (summary)

**Created:**
- `frontend/test/ReviewerAvatarStack.test.tsx`
- `docs/superpowers/specs/2026-05-22-dark-light-ux-tokenization-design.md` (already created in brainstorming step)
- `docs/superpowers/plans/2026-05-22-dark-light-ux-tokenization.md` (this file)

**Modified:**
- `frontend/index.css`
- `tailwind.config.ts`
- `frontend/components/runs/ReviewerAvatarStack.tsx`
- 12 files in Task 3 (shadow-popover migration)
- `frontend/components/extraction/InstanceCard.tsx`
- `frontend/components/extraction/hierarchy/ModelSelector.tsx`
- `frontend/pages/Auth.tsx`
- `frontend/pages/ResetPassword.tsx`
- `frontend/pdf-viewer/primitives/Viewer.tsx`
- `frontend/pdf-viewer/engines/mock/index.ts`
- 4 files in Task 8 (density spot-fix; some may end with zero diff)
