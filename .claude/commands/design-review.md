---
description: Run prumo's visual feedback loop on a screen — render it, screenshot it, compare to the Plane/Linear target, list prioritised diffs, and (with --fix) apply + re-verify.
argument-hint: "<route or screen> [--fix] [--dark] [--mobile] [--baseline]"
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash(npm run dev*)
  - mcp__Claude_Browser__preview_start
  - mcp__Claude_Browser__navigate
  - mcp__Claude_Browser__computer
  - mcp__Claude_Browser__read_page
  - mcp__Claude_Browser__javascript_tool
  - mcp__Claude_Browser__resize_window
  - mcp__Claude_Browser__read_console_messages
  - mcp__Claude_Browser__form_input
---

# /design-review — visual feedback loop

User-supplied arguments: `$ARGUMENTS`

You are running prumo's **design-review loop** against the live frontend. The
governing process is the `design-review` skill — invoke it and follow it. The
target language is the `frontend-ux` skill; class mechanics come from
`ui-styling`. Reproduce the **Plane/Linear** language; do not invent a new one
(`frontend-ux` outranks the `frontend-design` plugin on core product UI).

> Iron law (from `verification-before-completion`): no "looks good" without a
> fresh screenshot you actually captured and compared. A described screen is not
> a verified screen.

---

## Phase 1 — Parse arguments

From `$ARGUMENTS`, extract:

- **target** — the first non-flag token(s): either a route path (`/projects/:id/extraction`)
  or a screen description ("extraction list empty state"). Required. If absent,
  ask the user which screen, then stop.
- `--fix` — apply P0/P1 fixes and re-verify (default: report only, no edits).
- `--dark` — also capture and review dark mode.
- `--mobile` — also capture and review at ≈390px width.
- `--baseline` — after the screen matches, print the Playwright `toHaveScreenshot`
  line + the command for the user to run (recording is `web-testing` §7, and this
  command has no Playwright grant — it reports, it doesn't write baselines).

## Phase 2 — Resolve the route

If **target** is a description, find the route: `Grep`/`Glob` under
`frontend/pages/` and the router for the matching screen, and state the resolved
path. If you cannot resolve it confidently, ask rather than guess.

## Phase 3 — Render

Start the preview with `preview_start({url})` at `http://127.0.0.1:<port><route>`
(Vite, `npm run dev`).

**Confirm the port is yours before you trust a single pixel.** `preview_start({name})`
reads `.claude/launch.json` from the MAIN checkout, so from a worktree it cannot start
that worktree's server, and :8080 is frequently a peer session's server for another
branch — you would review the wrong code and it would look fine. Check the owner with
`lsof -nP -iTCP:8080 -sTCP:LISTEN`, then `lsof -a -p <pid> -d cwd`. If the cwd is not
this tree, start your own: `npm run dev -- --port <n> --strictPort` in the background,
then open that URL.

**Auth.** Most product routes sit behind `ProtectedRoute` and redirect an
unauthenticated session to `/auth` — so a deep route renders the login form, not
your screen. If you land on `/auth`, sign in with the browser test account:
`form_input` email + password (`teste@prumo.local` / `Senha123`), click submit with
`computer`, then go to the target. Confirm via `read_page` that you're on the
app shell (not `/auth`) before capturing. If sign-in is rejected (`Invalid login
credentials` in the console), the dev build's Supabase has no such account — bring
up the full local stack (`make start` / `make db-seed`) or use known-good creds.

If the screen needs a specific state (empty / loading / a particular run or
reviewer), drive to it with `computer` / `javascript_tool` and say which state
you captured. Check `read_console_messages` for errors that would distort the render.

## Phase 4 — Capture

- Desktop light: `computer {action: "screenshot"}` (always).
- `--dark`: theme is `next-themes` (`storageKey="prumo:theme"`), so force it
  durably — `javascript_tool` running
  `localStorage.setItem('prumo:theme','dark'); location.reload()`, then a
  screenshot; restore with `'system'`/`'light'` + reload.
- `--mobile`: `resize_window` to ≈390 wide, screenshot, restore.
- `read_page` for structure, and `javascript_tool` (computed styles) on any node whose token
  you doubt (confirm the header is really 48px, the border really `/0.4`, the
  shadow not `none`).

## Phase 5 — Compare against the two anchors

Load both targets and judge the capture against the `design-review` rubric:

1. **Objective** — the `frontend-ux` checklist: `h-12` header, `text-[13px]` body,
   `border-border/40`, `h-4 w-4` `strokeWidth={1.5}` icons, instant
   `hover:bg-muted/50`, soft `elev-*`/`shadow-[…0.04]` shadows, breadcrumb-first.
2. **Vocabulary** — `Read` the reference images
   `docs/design-references/linear_ux.png` and
   `docs/design-references/linear_project_configuration.png` and compare *feel*:
   density, contrast, chrome, spacing rhythm.

Also sweep the **anti-slop tells** in the skill (oversized centered titles, hard
shadow slabs, gradients, full-opacity borders, `rounded-2xl` everywhere, emoji
icons, missing hover/focus).

## Phase 6 — Report prioritised diffs

Print one Markdown table. Severity: **P0** = breaks the look / off-language, **P1**
= clearly wrong vs the checklist, **P2** = cosmetic polish.

```
| PRI | WHAT'S OFF | frontend-ux RULE | FIX (exact class/token change) | FILE:LINE |
|-----|-----------|------------------|--------------------------------|-----------|
```

Each fix must be a concrete `ui-styling`-correct change (semantic token, `cn()`
order, `border-border/40`, …) — never a raw hex/HSL, never a hardcoded string.

## Phase 7 — Fix + re-verify (only with `--fix`)

If `--fix` was passed, apply the **P0 and P1** rows with `Edit` (smallest change
each; leave P2 as noted follow-ups). Then **re-capture the same screen and state**
(repeat Phases 3–4) and confirm each diff actually closed. Loop Phases 5–7 until no
P0/P1 remain. Respect the React Compiler rule: no `try/finally`/`throw` in
component bodies; all copy through `frontend/lib/copy/`.

Without `--fix`: stop after Phase 6 and let the user decide.

## Phase 8 — Verdict

End with:

- The before screenshot path, and (if `--fix`) the after path.
- One line: `## RESULT: MATCHES TARGET` (no P0/P1 left) or
  `## RESULT: N P0 / M P1 diffs remain` with the table above.
- If `--baseline` and the screen matches: state the exact `toHaveScreenshot` line
  and the file it would live in, and ask before recording it.
