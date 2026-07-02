---
status: approved
last_reviewed: 2026-07-02
owner: '@raphaelfh'
---

# Run-header declutter: unified status cluster + progressive disclosure — design

> Brainstormed and approved 2026-07-02. Applies to the shared `RunHeader`
> compound used by both run screens (`ExtractionFullScreen` via
> `ExtractionHeader`, and `QualityAssessmentFullScreen` composing directly).
> Supersedes the *visual* sections of
> `2026-06-20-extraction-header-refinement-design.md` and
> `2026-06-21-header-system-responsive-frosted-design.md` (their
> container-query drop-cascade design is replaced by the simpler cascade in
> §7); the frosted `HeaderShell` chrome and the h-12 command-header language
> are unchanged. ADR-0015 transition *semantics* are untouched — this is
> presentation only.

## 1. Problem

The run header packs 12+ simultaneous elements into 48px: sidebar toggle,
back arrow, project crumb, article title, save dot, 3-node StageRail, ‹N/M›
pager, reviewer avatars + count text, role chip, Compare, AI button/badge,
"1 of 33 required" helper, primary action, and the utility cluster. The
responsive drop cascade (7 thresholds) manages *overflow*, but not
*simultaneous information load*: at the widths where everything fits, the
article title is crushed to a few characters while lower-value chrome
(project crumb, stage labels, helper text) stays fully spelled out.

## 2. Decisions (approved in brainstorm)

1. **Stage indicator** → a single current-stage chip; the full 3-phase
   timeline with per-phase explanations moves behind a click (popover).
2. **Project crumb** → removed. The sidebar and the back arrow carry project
   context; the article title is the only identity text and takes the freed
   space.
3. **Reviewers + role** → compact anonymous avatars stay visible as a social
   signal; count, ready state, divergences, and the viewer's role move into
   the same status popover. The standalone RoleChip leaves the bar.
4. **Primary action** → button only. The inline "1 of 33 required" helper
   dies; the count lives in the gated-state tooltip and in the status
   popover.
5. **AI** → one Sparkles button with a pending-count badge; click opens a
   popover menu with fully-named actions.
6. **Architecture** → approach A: a new `RunHeader.RunStatus` leaf replaces
   `StageRail` + `Reviewers` + `RoleChip` (atomic swap, no coexistence).
7. **Docs** → this spec + superseded banners on the two June header specs +
   reference-doc touch-ups; ADR-0015 gets a one-line More-Information note
   only.

## 3. Final layout

```text
| [☰ sidebar] [← back] [Article title … (truncates)]  |‹ 2/4 ›|   →
|   → [● Consensus ⌄][◉◉]  ·  [Compare] [✦12] [Approve & finalize] [🔔 ? ⧉] |
   identity ──────────────  pager      status ──────  actions ─────────────
```

- **Identity** (Left): MobileNav (< lg), SidebarToggle, back arrow, article
  title (single crumb, pure flex-shrink, truncates), SaveSlot. No project
  crumb.
- **Pager**: unchanged protected shrink-0 slot (highest-priority nav).
- **Status**: the new `RunStatus` cluster — stage chip + reviewer avatars —
  in the Center slot.
- **Actions** (Right): CompareToggle, AIActions (rebuilt), PrimaryAction
  (simplified), Utility (bell/feedback/help/menu), PanelToggle. SidebarToggle
  and PanelToggle survive at every width, as today.

## 4. `RunHeader.RunStatus` (new leaf)

Replaces `StageRail.tsx`, `Reviewers.tsx`, `RoleChip.tsx`. Reads everything
from the existing `RunHeaderContext` (`stage`, `isRevision`, `role`,
`isBlind`, `canReveal`, `onReveal`, `progress`, `reviewers`, `transition`,
`onJumpToDivergence`, `kind`) — **zero new props** on either screen.

### Chip

- Pill: status dot + current-stage label + chevron-down. `text-[13px]`,
  hairline border, ghost hover. Never drops; below ~36rem it collapses to
  the dot only (full `aria-label` retained).
- Dot color by state: extract/consensus current = info; finalized = success;
  cancelled = destructive; pending = muted.
- Stage label is **kind-aware**: extraction runs show *Extraction /
  Consensus / Finalized*; quality-assessment runs show *Assessment /
  Consensus / Finalized*.
- `data-testid="run-stage-current"` moves onto the chip with
  `data-state`/`data-stage` attributes (E2E continuity).

### Avatars

- Up to 3 stacked anonymous 18px dots + `+N`, only when
  `reviewers.count > 0`. Rendered as a button opening the same popover.
- Amber corner dot when `reviewers.divergent > 0` **and** the viewer is an
  arbitrator (see role gating). Drops below 48rem.

### Status popover (single, shared by chip + avatars)

Content, top to bottom:

1. **Timeline** — the 3 stages via the kept `stageNodeStates()` helper, each
   with icon (done ✓ / current dot / future ○ / finalized-future lock /
   cancelled), name, state suffix, and a one-line explanation. Explanations
   come in **two voices** keyed by role: reviewer ("Extract your data
   independently…") vs arbitrator ("Resolve divergences, then approve…").
2. **Progress** — "N of M required fields".
3. **Reviewers** — avatar stack + "X of Y reviewers · Z ready" (when the
   ready hint is available).
4. **Divergences** — "N fields differ" + a `View` button that calls
   `onJumpToDivergence`. Rendered **only** for arbitrators.
5. **Role** — "You review as {role}" + blind qualifier; the blind-mode
   `Reveal` button (absorbing today's RoleChip popover) when `canReveal`.
6. **Revision** — a line when `isRevision` (the inline Revision chip dies).

### Role gating (in the component, not just by data absence)

| Viewer            | Sees                                                        |
|-------------------|-------------------------------------------------------------|
| Reviewer (blind)  | Timeline (reviewer voice), progress, anonymous reviewer count. No divergence row, no amber dot, no reveal. |
| Manager/Consensus | Timeline (arbitrator voice), progress, reviewers + ready, divergences + View, Reveal when blind. |
| Viewer            | Read-only status (timeline + progress + count). No actions; PrimaryAction already renders null. |

Divergence UI keys off the arbitrator capability derived from the context
`role` (manager/consensus — the same distinction `buildExtractionTransition`
receives as `canResolveConflicts`) — not off divergence data merely arriving
empty. No new context field.

## 5. AI actions (rebuilt `AIActions.tsx`)

- One ghost icon button (Sparkles, `text-ai`) with a small numeric badge
  when `pendingCount > 0`. Hidden entirely when there is no available
  action (as today).
- Click opens a popover menu (reuse the AIPopoverShell pattern):
  - **Extract with AI** — when `canExtract`; shows "Extracting…" + spinner
    state while running.
  - **Review N pending suggestions** — when `pendingCount > 0`; calls
    `onOpenSuggestions`.
- Menu opens even with a single item (one predictable behavior; the named
  item explains the click).

## 6. Primary action (simplified `PrimaryAction.tsx`)

- Button only; same three ADR-0015 transitions, relabeled (§8).
- Gated state: attenuated style + tooltip carrying the reason and the count
  ("N of M required fields remaining"); click still opens the completeness
  guide (unchanged `onGuide` routing). The visible inline helper is removed;
  an `sr-only` node keeps `aria-describedby` resolving.

## 7. Responsive cascade (replaces the 7-threshold map)

1. Article title truncates (flex cushion) — never drops.
2. Reviewer avatars drop `< 48rem`.
3. Back arrow drops `< 42rem` (unchanged).
4. Stage chip collapses to dot-only `< 36rem` — never drops.

AI is already icon-only; Compare, Utility, PanelToggle keep today's
behavior. The RunHeader.tsx cascade comment is rewritten to this list.

## 8. Terminology

| Surface                      | Today               | New                  |
|------------------------------|---------------------|----------------------|
| Reviewer button (extract)    | Mark ready          | **Finish extraction** |
| Reviewer button (done state) | Marked ready        | **Extraction finished** |
| Manager button (extract)     | Open consensus      | **Start consensus**   |
| Manager button (consensus)   | Approve & finalize  | Approve & finalize    |
| Stage node/chip (extraction) | Extract             | **Extraction**        |
| Stage node/chip (QA runs)    | Extract             | **Assessment**        |

Copy stays English (project hard rule). Long-form explanations live in
tooltips and the popover ("Signals you're done extracting — the manager can
then start consensus"), not in labels.

## 9. Accessibility & keyboard

- Chip and avatar cluster are `button`s with `aria-haspopup` +
  `aria-expanded`; Radix Popover default focus management.
- Timeline keeps StageRail's sr-only state suffixes (done/current/upcoming/
  locked/cancelled).
- Dot-only chip and avatar cluster carry full `aria-label`s.
- Cmd-K palette gains a "View run status" action (opens the popover).

## 10. Component inventory

| File | Change |
|------|--------|
| `runs/header/RunStatus.tsx` | **New** — chip + avatars + status popover. |
| `runs/header/StageRail.tsx`, `Reviewers.tsx`, `RoleChip.tsx` | **Deleted** (tests replaced by RunStatus tests). |
| `runs/header/stage.ts` | Kept — `stageNodeStates()` feeds the timeline. |
| `runs/header/AIActions.tsx` | Rewritten as popover menu. |
| `runs/header/PrimaryAction.tsx` | Inline helper removed. |
| `runs/header/Breadcrumb.tsx` | `crumbs[]` → single `title` prop + `onBack`. |
| `runs/header/RunHeader.tsx` | Compound exports swap; cascade comment rewritten. |
| `extraction/ExtractionHeader.tsx` | Swap slots; drop `projectName` prop (clean both callers, no grandfathering). |
| `pages/QualityAssessmentFullScreen.tsx` | Same slot swap. |
| `lib/extraction/stageTransition.ts`, `lib/qa/qaTransition.ts` | Label keys only (semantics untouched). |
| `lib/copy/runs.ts`, `lib/copy/extraction.ts` | New keys (timeline explainers ×2 voices, AI menu, popover labels, relabels); dead keys pruned in the same PR. |

## 11. Docs

- This spec (new).
- `2026-06-20-extraction-header-refinement-design.md` +
  `2026-06-21-header-system-responsive-frosted-design.md`: superseded-visual
  banner pointing here.
- `docs/reference/extraction-hitl-architecture.md`: update header mentions
  (StageRail → RunStatus; relabels).
- ADR-0015: one More-Information line — "header labels renamed 2026-07-02
  (Finish extraction / Start consensus), presentation only, see this spec".
  The historical record is not rewritten.

## 12. Testing & verification

- **Unit**: RunStatus stage × role matrix (chip label incl. kind-aware,
  popover row gating, Reveal, divergence View); AIActions (0/1/2 actions,
  extracting state); PrimaryAction (gated tooltip + sr-only + guide
  routing); Breadcrumb single-title.
- **E2E**: update `run-stage-current` usage (now the chip), reviewers
  testids, and the qa-flow / extraction-navigation / reopen flows.
- **Visual**: `/design-review` on both run routes; verify at container
  widths (throwaway dev harness route pattern, deleted after).
- Full frontend suite + lint before push.

## 13. Non-goals

- No backend or API changes; no changes to transition semantics, gates, or
  the reviewer-ready flag (ADR-0015 stands).
- No changes to HeaderShell chrome, Topbar, or non-run headers.
- No JS measured priority-overflow (the deferred idea becomes unnecessary —
  the new cascade has 3 rules).
