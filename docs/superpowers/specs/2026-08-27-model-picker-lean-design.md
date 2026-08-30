---
status: approved
last_reviewed: 2026-08-27
owner: '@raphaelfh'
---

# Model picker — lean redesign

> **Status:** Approved · Date: 2026-08-27 · Deciders: @raphaelfh
> **Scope:** split `LlmEngineChip`'s popover so it selects a model and nothing
> else; move engine *policy* into a dedicated settings dialog.
> **Slice:** C of four. **Depends on:** slice B's scale.

## Problem

Measured live on the Configuration tab, popover open (352 × 544px):

| Block | Height | Share |
|---|---|---|
| Fast / Verified toggle | 49px | 9% |
| Alternate engines | 107px | 20% |
| Search + model list | 345px | 63% |
| Manage custom endpoints | 41px | 8% |

Two consequences.

**You scroll past 156px of configuration to reach what you opened it for.**
Mode and alternates sit *above* the search box — 29% of the popover — while
the model list renders **300px of 653px of content**, so fewer than half the
models are visible at once.

**The alternates block spends 107px on an empty state.** Its content today is
a heading, a two-line explanation, an "Add alternate" action, and the line
*"None — policy locked to the default engine."* A fifth of the surface, for a
feature that is switched off.

Underneath, one popover carries seven concerns: mode policy, a retired-model
alert, an attribution line, alternates management (which flips the same list
into an inline multi-select), the searchable catalogue, custom endpoint
groups, and an endpoints-management footer.

## Decision — a picker that picks

### The popover keeps selection only

- Search input at the top.
- Provider groups, then custom-endpoint groups.
- **Each row: model label, and right-aligned `<context> · <cost>`** (e.g.
  `1M · $$`). Nothing else.
- The **canonical id is removed from the row** (`openai:gpt-5.6-luna` is
  developer-facing noise in a chooser).
- The **`best_for` description moves to a hover tooltip**, together with the
  canonical id. This is the house pattern, not a compromise:
  `.claude/rules/frontend.md` already requires every short-label control to
  expose its description on hover via `Tooltip`, with copy through
  `lib/copy/`.
- **The active model is a filled row**, not a small inline check.
- Footer: a single **`Engine settings…`** link.

Estimated result: ~380px tall, and the list no longer scrolls at the current
catalogue size.

### The settings dialog takes the policy

A new dialog opened from that footer link, holding what is configured once per
project rather than chosen per run:

- The **Fast / Verified** toggle.
- The **retired-model alert** (`retiredNote`).
- The **attribution line** (`attribution` / `attributionNoPrevious`).
- **Alternate engines** — the list, add, and remove. Freed from the popover,
  the inline multi-select mode disappears: membership becomes ordinary
  checkboxes against the catalogue, so the same list no longer has two modes.
- **Manage custom endpoints**, which opens the existing `LlmEndpointsDialog`.

`AppDialog` is confirm-oriented (`onConfirm` / `confirmLabel`); these controls
each save on change, so this uses `Dialog` directly rather than `AppDialog`.

### What deliberately stays in the popover

Three things look like policy but govern **whether a row is selectable**, so
they belong with selection:

- **Locked rows** (BYOK provider, no stored key) keep the lock icon and the
  "Add your key" CTA, including the one enabled per-group item that keeps the
  CTA keyboard-reachable — cmdk skips disabled items.
- **Custom endpoint groups** are selectable models.
- **Blocked endpoint rows** stay blocked, see below.

## The coupling this design must not break

The backend **rejects `mode="verified"` on a prompted-only endpoint**. Today
the popover can show that blockage next to the mode toggle that causes it.
Once mode moves into the dialog, the cause is off-screen — a reviewer could
pick an endpoint model that their current mode forbids and only learn on save.

**Requirement:** the blocked row keeps its disabled treatment and its reason
(`endpointPromptedBlocked`), and that copy gains a pointer to where mode is
changed. A dead click into a generic save-error toast is the failure this
prevents, and it is the one regression risk in the slice.

## Out of scope

- Any change to the engine wire format, `toUpdateBody`, or the deploy-window
  guards (`engine.hasAlternates` hiding management against an old backend).
  Those move surface, not behaviour.
- Endpoint creation/validation — `LlmEndpointsDialog` is reused as-is.

## Verification

| Claim | How it is proven |
|---|---|
| The popover selects and nothing else | Vitest: popover renders search + rows + settings link; no mode toggle, no alternates |
| Descriptions survive as tooltips | Vitest: hovering a row exposes `best_for` and the canonical id |
| Locked rows stay reachable | Existing keyboard/CTA tests keep passing |
| A blocked endpoint still explains itself | Vitest: prompted-only endpoint under Verified renders disabled **with** its reason |
| Alternates still write correctly | Existing `toUpdateBody` tests; membership toggles move to the dialog |
| It is actually leaner | `design-review`: popover height and whether the list scrolls, before/after |

## Sequencing

| | Slice | State |
|---|---|---|
| B | Button & density scale | PR1 in prod; PR2 open (#723) |
| A | Template import flow | Spec merged/open (#724) |
| **C** | **Model picker** | **This spec** |
| D | Sections/fields view (visual only) | Not designed — six button heights measured on one screen |
