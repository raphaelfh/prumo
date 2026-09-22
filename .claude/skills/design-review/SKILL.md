---
name: design-review
description: "Use before calling any prumo screen or component done, and when asked \"does this look right\", to match Linear/Plane, or to tighten a screen: render it, screenshot desktop and narrow widths, compare against `frontend-ux` and the Linear references, fix the prioritized diffs, re-capture. Also `/design-review <route> [--fix] [--dark] [--baseline]`."
argument-hint: "<route or screen> [--fix] [--dark] [--baseline]"
---

# Design Review: the visual feedback loop

**Never judge a UI from the diff.** A class string that reads correct still ships the wrong screen: a stale token, a missing `min-w-0`, a shadow that resolved to `none`, a dark-mode foreground that vanished. `frontend-ux` is the target, `ui-styling` the mechanics; this loop checks what actually rendered.

## Arguments

When invoked as `/design-review`, parse `$ARGUMENTS`:

- **target** (required): a route (`/projects/:id/extraction/:articleId`) or a description ("extraction list empty state"). Resolve a description to a route from `frontend/pages/` and the router, and say which route; ask when it is ambiguous.
- `--fix`: apply the P0 and P1 fixes and re-verify. Without it, report and stop.
- `--dark`: also capture dark mode (always do so when the change touched theming).
- `--baseline`: once the screen matches, print the Playwright `toHaveScreenshot` line and the file it would live in, and ask before recording anything.

## The loop

```text
1. RENDER      your own dev server, signed in, the exact screen AND state you changed
2. CAPTURE     desktop (~1280) and narrow (~390) every time; a mid width (~700-900) when the
               screen has a priority-track header; dark when theming changed or --dark
3. COMPARE     against the two anchors below
4. DIFF        a prioritized list: P0 breaks the look, P1 is clearly wrong against the
               checklist, P2 is polish
5. FIX         the smallest token or class change per diff (ui-styling mechanics)
6. RE-CAPTURE  the same screen and state
7. CONFIRM     loop from 4 until no P0/P1 remain; note the P2s and stop
```

## Render

Browser pane tools (`mcp__Claude_Browser__*`): `preview_start`, `navigate`, `computer` (screenshot, click, type), `read_page`, `form_input`, `javascript_tool`, `resize_window`, `read_console_messages`.

- **Make sure the server is this tree's.** The dev server is `npm run dev` (Vite, :8080). `preview_start({name})` reads `.claude/launch.json` from the main checkout, and :8080 is often a peer session's server on another branch, so you would review the wrong code and it would look fine. Check the owner: `lsof -nP -iTCP:8080 -sTCP:LISTEN`, then `lsof -a -p <pid> -d cwd`. Two PIDs on 8080 (one `[::1]`, one `*`) means `localhost` hits the other one. If it is not this tree, copy the gitignored `.env` and `backend/.env` from the main checkout, start `npm run dev -- --port <n> --strictPort` in the background, and open `http://127.0.0.1:<n><route>` with `preview_start({url})`.
- **Sign in.** Product routes sit behind `ProtectedRoute` and redirect to `/auth`. There, `form_input` the test account (`teste@prumo.local` / `Senha123`), submit with `computer`, then go to the target, and confirm with `read_page` that you are on the app shell. `Invalid login credentials` means that Supabase has no such account: bring up the local stack (`make start`, `make db-seed`).
- **A page that never reaches ready** in a worktree is a CORS suspect before an app bug: the backend accepts any localhost port only with `DEBUG=true`.
- **Ask the server what it serves before blaming the code.** A backend started before your new endpoint answers 405: restart it, then check `paths['<path>']` in `curl -s localhost:8000/api/v1/openapi.json`. A worktree's `node_modules/.vite` can serve modules transformed on another branch, even across restarts: `rm -rf node_modules/.vite`, then curl the served module and grep for your symbol.
- **A screen gated on the backend or login** renders in a throwaway harness around the real component: a DEV-only route that seeds `queryClient.setQueryData(<key factory>(id), FIXTURE)` before rendering, or a root `harness-<x>.html` + `frontend/__harness_<x>.tsx` served by Vite. Delete the harness files before knip and commit.
- Drive to the exact state (empty, loading, a given run or reviewer) with `computer` or `javascript_tool`, say which state you captured, and check `read_console_messages` for errors that distort the render.
- **Pane input quirks**: send `key: "Enter"`, never `"Return"` (it dispatches `e.key === ""`); select-all is `cmd+a` (with `ctrl+a` the next `type` appends). When a keyboard handler seems broken, attach a keydown listener and read `e.key` before blaming the app.
- **Scroll-driven UI is Playwright's job**: IntersectionObserver callbacks and `behavior:"smooth"` scrolls do not advance in the pane (`document.hidden` is true). A viewport collapsed to 0x0 recovers with `resize_window` at an explicit width and height, not the `desktop` preset.

## Capture

- Screenshot with `computer {action: "screenshot"}`; `read_page` for structure; `javascript_tool` for the computed style or `getBoundingClientRect` of any node you doubt (the header really 48px, the border really `/0.4`, the shadow not `none`); a downscaled screenshot is no measurement.
- **Density or target-size changes** are measured twice in one browser session: `git stash push -- <dir>`, reload, run the audit JS, `git stash pop`, reload, run it again. `h-full` does nothing inside a `<td>` (it resolves against the cell's auto height); the floor is `min-h-*`.
- **Dark mode** is `next-themes` (`storageKey="prumo:theme"`), which re-syncs a toggled class: run `localStorage.setItem('prumo:theme','dark'); location.reload()`, capture, then restore `'system'` and reload.
- **Narrow**: `resize_window` to ~390 (below `sm`), capture, restore. Some chrome (`RunHeader`, `ExtractionHeader`) reflows on its own width through container queries, so resize the panel too, not only the window.

## Compare: two anchors

1. **Objective**: the `frontend-ux` § 7 checklist (the `h-12` header, `text-[13px]` body, `border-border/40`, `h-4 w-4` icons at `strokeWidth={1.5}`, instant `hover:bg-muted/50`, soft `shadow-elev-*`, breadcrumb-first, the edge budget, selection vs focus). Enforce it first.
2. **Vocabulary**: read `docs/design-references/linear_ux.png` and `docs/design-references/linear_project_configuration.png` and compare the feel: density, contrast, chrome, spacing rhythm. They are references, not pixel specs.

What to look at in the capture:

- **Density**: rows taller than `h-9`, sparse "webpage" spacing.
- **Hierarchy**: exactly one thing at `text-foreground`, the rest muted. Borderline contrast gets an axe `color-contrast` check, not an eyeball.
- **Chrome**: hairlines that separate rather than decorate; no double borders (use `gap-px bg-border`); no card inside a bordered pane.
- **Interaction**: a hover on every interactive row, a visible keyboard focus ring, hover-only actions reachable on touch (a visible kebab).
- **Empty and loading**: skeletons match real line heights; empty states are intentional.
- **Dark**: nothing vanished; reviewer colors and status colors still read and come from tokens.
- **Narrow**: no overflow; dense tables become card lists (`useIsNarrow`); the sidebar becomes the `MobileSidebar` sheet; header labels collapse before anything clips.
- **Reduced motion**: with `prefers-reduced-motion` forced, the `field-just-updated` flash and transitions do not animate.

### Anti-slop tells

| Tell | prumo-correct |
|---|---|
| 24–32px centered page title | breadcrumb + `text-[13px]` context, content starts high |
| Hard `shadow-md` / `shadow-lg` slabs | soft `shadow-elev-*` |
| Purple gradient, glassy hero | flat semantic surfaces (`bg-background`, `bg-muted`) |
| Full-opacity borders everywhere | `border-border/40`, dividers via `gap-px bg-border` |
| `p-6`/`p-8`, `space-y-6` | dense `py-1`–`py-2`, `h-9` rows |
| `rounded-2xl` on everything | `rounded-md` |
| Emoji icons, mixed icon sizes | lucide `h-4 w-4`, `strokeWidth={1.5}` |
| No hover affordance | `group-hover` reveal + `hover:bg-muted/50` |

## Report

One table, then the verdict:

```text
| PRI | WHAT'S OFF | frontend-ux RULE | FIX (exact class or token change) | FILE:LINE |
```

Each fix is a `ui-styling`-correct change (semantic token, `cn()` order, a named Button size), never a raw color or a hardcoded string. With `--fix`, apply the P0 and P1 rows, respecting the React Compiler rules and routing copy through `frontend/lib/copy/`, then re-capture and loop. End with the before (and after) screenshot, and one line: `RESULT: MATCHES TARGET` or `RESULT: <n> P0 / <m> P1 remain`.

There are no screenshot baselines in the repo. Lock a screen with `toHaveScreenshot` only once it matches and is stable, masking volatile regions (timestamps, avatars, reviewer colors).
