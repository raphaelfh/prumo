---
description: Run prumo's visual feedback loop on a screen — render it, screenshot it, compare to the Plane/Linear target, list prioritised diffs, and (with --fix) apply + re-verify.
argument-hint: "<route or screen> [--fix] [--dark] [--mobile] [--baseline]"
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash(npm run dev*)
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_screenshot
  - mcp__Claude_Preview__preview_snapshot
  - mcp__Claude_Preview__preview_inspect
  - mcp__Claude_Preview__preview_resize
  - mcp__Claude_Preview__preview_eval
  - mcp__Claude_Preview__preview_console_logs
  - mcp__Claude_Preview__preview_click
  - mcp__Claude_Preview__preview_fill
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

Start the preview with `preview_start` at `http://127.0.0.1:8080<route>` (Vite,
`npm run dev`). It reuses a server already on :8080; if nothing is listening, start
one first (`npm run dev`) and wait for it, then `preview_start`.

**Auth.** Most product routes sit behind `ProtectedRoute` and redirect an
unauthenticated session to `/auth` — so a deep route renders the login form, not
your screen. If you land on `/auth`, sign in with the browser test account:
`preview_fill` email + password (`teste@prumo.local` / `Senha123`), `preview_click`
submit, then go to the target. Confirm via `preview_snapshot` that you're on the
app shell (not `/auth`) before capturing. If sign-in is rejected (`Invalid login
credentials` in the console), the dev build's Supabase has no such account — bring
up the full local stack (`make start` / `make db-seed`) or use known-good creds.

If the screen needs a specific state (empty / loading / a particular run or
reviewer), drive to it with `preview_click` / `preview_eval` and say which state
you captured. Check `preview_console_logs` for errors that would distort the render.

## Phase 4 — Capture

- Desktop light: `preview_screenshot` (always).
- `--dark`: theme is `next-themes` (`storageKey="prumo:theme"`), so force it
  durably — `preview_eval("localStorage.setItem('prumo:theme','dark'); location.reload()")`,
  then `preview_screenshot`; restore with `'system'`/`'light'` + reload.
- `--mobile`: `preview_resize` to ≈390 wide, `preview_screenshot`, restore.
- `preview_snapshot` for structure, and `preview_inspect` on any node whose token
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
