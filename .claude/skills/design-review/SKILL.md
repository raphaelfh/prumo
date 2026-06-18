---
name: design-review
description: prumo's visual feedback loop — render the screen, screenshot it, compare to the Plane/Linear target, list the diffs, fix, re-screenshot, confirm. Use BEFORE claiming any frontend screen or component "done", and whenever the ask is "does this look right", "match Linear/Plane", "tighten this screen", "iterate on the UI", "why does this look off / generic / AI-made", or after any non-trivial layout, density, spacing, or theme change. The `/design-review` command runs this loop on a route. Siblings: `frontend-ux` sets the visual language (what it should look like), `ui-styling` is the Tailwind/shadcn mechanics (how to wire the classes); this skill is the *did it actually end up that way* layer that closes the loop with your eyes, not the diff.
---

# Design Review — the visual feedback loop

The single load-bearing frontend practice: **never judge a UI from the code diff
alone — render it, look at it, and correct against a target.** A class string that
reads correct still ships the wrong screen (a stale token, a missed `min-w-0`, a
shadow that resolved to `none`, a dark-mode foreground that vanished). The check
that closes the loop is visual.

- `frontend-ux` → *what it should look like* (the Plane/Linear/WorkOS language).
- `ui-styling` → *how to wire it* (Tailwind v3 + shadcn + Radix mechanics).
- **this skill** → *what you actually rendered, and how to walk it to the target.*

Read `frontend-ux` first to know the target; run this loop to verify you hit it.

## When to run

- Before claiming **any** frontend screen/component done (this is the UI analogue
  of `verification-before-completion` — a screenshot is your fresh evidence).
- "Does this look right?", "match Linear/Plane", "tighten / polish this screen",
  "this feels generic / AI-made", "iterate on the UI".
- After a non-trivial change to layout, density, spacing, borders, shadows,
  empty/loading states, dark mode, or responsive behaviour.
- Via the `/design-review <route> [--fix] [--dark] [--mobile] [--baseline]`
  command.

## The loop (do not skip a step)

```
1. RENDER     dev server up, log in if the screen is gated, open the exact state
2. CAPTURE    screenshot it (desktop light; add dark + mobile if you touched them)
3. COMPARE    hold it against TWO anchors (rubric below): the frontend-ux
              checklist (objective) and the Linear reference images (vocabulary)
4. DIFF       write a prioritised list — P0 (breaks the look) → P2 (nice-to-have)
5. FIX        apply the smallest class/token change per diff (ui-styling mechanics)
6. RE-CAPTURE screenshot the same screen + state again
7. CONFIRM    diff closed? loop back to 4 until no P0/P1 remain, then stop
```

Stop when there are no P0/P1 diffs left, or the user calls it. Don't loop on P2
cosmetics forever — note them and move on.

## Tooling — what to capture with

| Goal | Tool | Why |
| --- | --- | --- |
| Interactive iteration (the loop above) | **Claude_Preview MCP** — `preview_start`, `preview_screenshot`, `preview_snapshot`, `preview_inspect`, `preview_resize`, `preview_eval`, `preview_fill`, `preview_click` | First-party harness preview; the harness's preview-tools guidance prefers `preview_*` over Bash/Chrome for running the dev server + verifying. |
| A scripted capture or a committed regression baseline | **Playwright** `toHaveScreenshot` | Deterministic, lives in CI. Owned by the `web-testing` skill §7 — read it before adding baselines. |

Mechanics:

- Dev server is `npm run dev` → Vite on **:8080** (`http://127.0.0.1:8080`).
  `preview_start` reuses a server already on :8080; if nothing is listening,
  start it first (`npm run dev`) and wait for it before `preview_start`.
- **Auth.** Most product screens (extraction, HITL, runs, settings) sit behind
  `ProtectedRoute`, which redirects an unauthenticated session to `/auth` — so
  `preview_start` at a deep route lands on the **login form**, not your screen.
  Sign in first: open `/auth`, `preview_fill` the email + password with the
  browser test account (`teste@prumo.local` / `Senha123`), `preview_click` submit,
  then go to the target. Confirm with `preview_snapshot` that you're on the app
  shell (not `/auth`) before you screenshot. If sign-in is rejected (`Invalid login
  credentials` in `preview_console_logs`), the dev build points at a Supabase where
  that account isn't seeded — bring up the full local stack (`make start` /
  `make db-seed`) or use known-good creds before retrying.
- Navigate within the app with `preview_eval` (`window.location.assign('/...')`)
  or by starting the preview at the target URL. There is no `preview_navigate`.
- `preview_screenshot` = the visual; `preview_snapshot` = the DOM/structure;
  `preview_inspect` = computed CSS for a node (use it to confirm a token actually
  resolved, e.g. the header is really `48px`, the border is really
  `hsl(var(--border) / 0.4)`).
- **Dark mode** is driven by `next-themes` (`attribute="class"`,
  `storageKey="prumo:theme"`), so a bare `classList.toggle("dark")` gets re-synced
  out from under you. Force it durably with
  `preview_eval("localStorage.setItem('prumo:theme','dark'); location.reload()")`,
  screenshot, then restore (`'system'` or `'light'`) and reload.
- Responsive: `preview_resize` to a narrow width (≈390) before re-capturing.

## Targets — what "correct" means (two anchors)

**1. The objective rubric — the `frontend-ux` checklist.** Always available,
unambiguous, and the thing to enforce first:

- Header height is exactly `h-12` (48px), `bg-background/80 backdrop-blur-md`,
  `border-b border-border/40`.
- Body/UI font is `text-[13px]`; titles `text-foreground`, everything else
  `text-muted-foreground`.
- Borders use `border-border/40` for chrome/dividers (`border-border/50` for
  menus & dropdowns, per frontend-ux §3) — never full-opacity 1px slabs.
- Icons are `h-4 w-4` with `strokeWidth={1.5}`, consistent across the screen.
- List hover is instant (`duration-0`/`duration-75`) and `hover:bg-muted/50`.
- Shadows are soft and large (`shadow-[0_8px_30px_rgb(0,0,0,0.04)]` / the
  `shadow-elev-*` tokens), never a hard `shadow-md` slab.
- Navigation is breadcrumb-first, not a 24px page title.

**2. The vocabulary anchor — the Linear reference images.** Open them and compare
*feel* (density, contrast, chrome, spacing rhythm):

- `docs/design-references/linear_ux.png` — list density, hover affordances,
  command-palette feel.
- `docs/design-references/linear_project_configuration.png` — configuration /
  settings surfaces.

These are references, not pixel specs (see `docs/design-references/README.md`).
Use them to answer "does this *feel* like the same family of tool?"

## The rubric — what to actually look at in the screenshot

- **Density & rhythm** — too much vertical padding? rows taller than `h-9`? Is the
  information-per-screen close to the Linear reference, or sparse and "webpage-y"?
- **Hierarchy & contrast** — is exactly one thing the title (`text-foreground`)
  and the rest muted? Or is everything competing at full contrast? Borderline
  contrast → don't eyeball it, run the `web-testing` §6 axe `color-contrast` check.
- **Chrome & borders** — borders subtle (`/40` chrome, `/50` menus) and used to
  separate, not decorate? Any double borders (use `gap-px bg-border`)? Header thin?
- **Hover & interaction** — every interactive row/button has a hover state? Focus
  ring visible on keyboard (`focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2`)? Hover is instant?
- **Empty & loading** — skeletons match real line-height/width (no layout shift)?
  Empty states intentional, not a bare "No data"?
- **Dark mode** — any text that vanished (raw color instead of a token)? Do the
  `reviewer-1..5` dots/avatars and status/severity colors still read on the dark
  surface and come from tokens (`text-reviewer-N`), not hardcoded hex/HSL? Shadows
  still read on the dark surface?
- **Responsive** — overflow on flex/grid (missing `min-w-0`)? Does it degrade
  cleanly at ≈390px?
- **Reduced motion** — with `prefers-reduced-motion` forced, do the
  field-just-updated flash and any transitions degrade to no-motion (not animate)?
  Hover stays instant per `frontend-ux` either way.

## Anti-slop tells (catch generic-AI output before the user does)

| Slop tell | prumo-correct |
| --- | --- |
| 24–32px centered page title | breadcrumb + `text-[13px]` context, content starts high |
| Hard `shadow-md`/`shadow-lg` slabs | soft `shadow-[0_8px_30px_rgb(0,0,0,0.04)]` / `elev-*` |
| Purple/indigo gradient, glassy hero | flat semantic surfaces (`bg-background`, `bg-muted`) |
| Full-opacity borders everywhere | `border-border/40`, dividers via `gap-px bg-border` |
| Generous `p-6`/`p-8`, `space-y-6` | dense `py-1`–`py-2`, `text-[13px]`, `h-9` rows |
| `rounded-2xl` on everything | `rounded-md` (8px) per the menu/dropdown spec |
| Emoji as icons, mismatched icon sizes | `lucide` `h-4 w-4` `strokeWidth={1.5}` |
| No hover affordance on rows/actions | `group-hover` reveal + `hover:bg-muted/50` |

## Precedence: `frontend-ux` wins; `frontend-design` is greenfield-only

The enabled `frontend-design@claude-plugins-official` plugin optimises for
*distinctive novelty* — it pushes bold, one-of-a-kind directions and bans common
defaults (e.g. Inter / system fonts). That is **the wrong objective for a fixed
Plane/Linear benchmark**: it pulls core product UI *away* from the consistent
language we are matching. So:

- **Core product UI** (extraction, HITL, runs, settings, layout) → this loop +
  `frontend-ux` + `ui-styling` govern. Reproduce the existing language; do not
  invent a new one.
- **Greenfield / marketing / illustrative** surfaces with no existing pattern to
  match → `frontend-design` is fair game for exploration.

When the two conflict on a core screen, `frontend-ux` is authoritative.

## Recording a regression baseline (optional)

Once a screen matches the target and is stable, you can lock it with a Playwright
snapshot so cosmetic regressions get caught in CI:

```ts
await expect(page).toHaveScreenshot('extraction-list.png', { maxDiffPixels: 200 });
```

Baselines live alongside the test; diffs land in `test-results/`. Use **sparingly**
— snapshots are heavy and break on legit refactors. This is `web-testing` §7
territory; read it before adding one, and `mask:` volatile regions (timestamps,
avatars, reviewer colors).

## Checklist (make these TodoWrite items)

- [ ] Rendered the exact screen **and state** I changed (not just the happy path).
- [ ] Captured desktop-light; added dark + mobile if I touched them.
- [ ] Compared against the `frontend-ux` checklist (objective) and the Linear
      reference images (vocabulary).
- [ ] Wrote a prioritised diff list (P0 → P2).
- [ ] Fixed every P0/P1 with the smallest token/class change.
- [ ] Re-captured and confirmed each diff actually closed.
- [ ] No raw colors, no full-opacity border slabs, no AI-slop tells remain.
