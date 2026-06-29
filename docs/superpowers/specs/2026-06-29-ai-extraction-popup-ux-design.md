---
status: draft
last_reviewed: 2026-06-29
owner: '@raphaelfh'
---

# AI-extraction popups: opacity, responsiveness, locate UX, and history fixes — design

> **Status:** Draft · Date: 2026-06-29 · Deciders: @raphaelfh
> **Scope:** Frontend only. No backend, schema, or migration changes.
> **Origin:** User-reported UX defects on the two AI-suggestion popups that
> appear on both the Extraction and QA session screens — they are too
> transparent to read over the document, the history popup "has broken
> things", and finding the cited evidence in the text is hard.

## 1. Problem

Two Radix popovers surface AI-extraction detail on a field. Both are shared by
the Extraction and QA screens because both screens compose the same
`FieldInput` (QA reuses it through `QASectionAccordion`):

1. **Details popover** —
   [`AISuggestionDetailsPopover.tsx`](../../../frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.tsx).
   Opens on clicking the extracted value or the `%` badge. Shows rationale +
   cited evidence ([`AISuggestionEvidence.tsx`](../../../frontend/components/extraction/ai/AISuggestionEvidence.tsx)).
2. **History popover** —
   [`AISuggestionHistoryPopover.tsx`](../../../frontend/components/extraction/ai/AISuggestionHistoryPopover.tsx).
   Past suggestions grouped by run, with accept/reject.

Findings from a design-review pass (rendered the real components over a busy
document via a throwaway harness; measured computed styles):

- **Transparency hurts readability (confirmed with computed values).** The
  popover surface is `frosted-overlay` = `rgba(255,255,255,0.82)` + `blur(12px)`
  ([`popover.tsx:21`](../../../frontend/components/ui/popover.tsx) →
  [`index.css` `.frosted-overlay`](../../../frontend/index.css)). The evidence
  block is `bg-muted/50` = `rgba(244,244,245,0.5)` with **no blur**
  ([`AISuggestionEvidence.tsx:193`](../../../frontend/components/extraction/ai/AISuggestionEvidence.tsx)) —
  the worst offender; sharp document text reads straight through the cited
  quote.
- **History "broken things"**: ships three `console.warn` debug logs to prod;
  Portuguese comments (`// Agrupar por runId`, `// Header do Run`) violating the
  English-only rule; group headers labelled `Extraction Run #N` from **array
  order**, not run identity; values hard-truncated at 50 chars
  (`...very long extra...`) with no way to see the full value;
  `formatValue(value: any)`; a rigid `h-[400px]` scroll box (dead space for a
  single item).
- **Locate is hard to find.** Jumping to the evidence in the document is a tiny,
  ambiguous map-pin icon buried in the action cluster next to Copy, and it
  closes the popup on jump.
- **Responsiveness.** The two popups don't share consistent width / height /
  scroll rules; the history popup's fixed height ignores both content and
  viewport.

## 2. Decisions (locked with the user)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Structure | **Keep two popovers, unify the shell.** No merge into a tabbed popover. |
| D2 | Opacity scope | **All floating menus solid.** Frosted stays on headers only. |
| D3 | Locate UX | **Option A:** clicking the cited passage jumps to it in the reader; the popup **stays open**; the jumped citation gets an **active ring**. |
| D4 | History | Fix the broken bits (see §5). |

## 3. Non-goals

- No merge of the two popovers into one tabbed surface (D1).
- No change to the locate *mechanism* (`useReaderLocate` → viewer store →
  reader highlight/flash). Only the trigger surface and open/close behavior
  change.
- No backend, schema, migration, or API changes.
- No auto-jump-on-open, no per-citation prev/next stepper (explicitly out).

## 4. Design

### 4.1 Shared shell

Introduce one internal building block, `AIPopoverShell`, that both popovers
render inside. It owns the consistent surface, header, sizing, and scroll. This
is the unification from D1 — the two popovers keep their distinct bodies but
stop drifting on chrome.

- **Solid surface (D2).** Change the shared `PopoverContent` default in
  [`popover.tsx`](../../../frontend/components/ui/popover.tsx) and
  [`dropdown-menu.tsx`](../../../frontend/components/ui/dropdown-menu.tsx) from
  `frosted-overlay` to a solid `bg-popover`. Every floating menu app-wide
  becomes opaque; `frosted-header` (Topbar, RunHeader) is untouched. If
  `.frosted-overlay` ends up with no remaining consumers, remove its definition
  in `index.css`; otherwise leave it. (Verify with a grep before deleting.)
- **Header.** Leading icon (`Sparkles` for details, `Clock` for history) +
  title + optional count, `border-b`, consistent padding.
- **Responsive sizing.** Width `min(380px, calc(100vw - 1.5rem))`;
  content-aware height via `max-h-[min(70vh,32rem)]` with natural growth (no
  fixed `h-[400px]`); a single internal scroll region.

`AIPopoverShell` is a presentational wrapper (header slot + body slot +
sizing). It does not own open state — each popover keeps its own `Popover`
root and trigger.

### 4.2 Details popover + evidence + locate (D3)

- **Evidence surface.** `AISuggestionEvidence` container `bg-muted/50` →
  solid `bg-muted`. The per-citation page chip currently `bg-background` stays;
  re-check contrast on the now-solid surface during design-review.
- **Locate = click the passage (D3, option A).**
  - The cited passage (`blockquote`) becomes the jump target: a `button`-role
    element, full-width, with a hover affordance (`cursor-pointer`, subtle
    `hover:bg`, and an inline "Show in document →" hint). The standalone
    map-pin icon button is removed; Copy stays.
  - On click it calls the existing per-citation `onLocate(rank)` →
    `useReaderLocate().locate(...)`.
  - **The popup no longer closes on locate.** Remove the `onClose()` call from
    the locate path in `AISuggestionDetailsPopover`'s `EvidenceSection`.
  - The clicked citation gets a persistent **active ring** + a small
    "Highlighted in the reader" confirmation; clicking another passage moves the
    ring and re-locates. The active citation rank is local popover state.
  - When `useReaderLocate().isAvailable` is false (outside a `ViewerProvider`),
    the passage is not a jump target (plain blockquote, today's behavior).
- Reasoning/rationale section unchanged except for inheriting the shared shell.

### 4.3 History popover (D4)

- Render inside `AIPopoverShell` (solid surface, `Clock` header + count).
- **Remove** the three `console.warn` calls; keep the `console.error` on the
  `getHistory` rejection path.
- **Translate** the Portuguese comments to English.
- **Run identity, not array order.** Drop `Extraction Run #N`. Each group header
  shows the run's **relative time** ("Today 14:30", "9 days ago") with the
  absolute timestamp on hover (`title`); the group containing
  `currentSuggestionId` gets a `Current` pill. (Uses `runId` + `timestamp`,
  which is all we have.)
- **No hard truncation.** Values wrap with `line-clamp-2` and expose the full
  value on hover (`title`). Remove the 50-char substring cut.
- **Type** `formatValue(value: unknown)` (object → JSON, null/undefined → empty
  label, else `String`).
- **Content-aware height** from the shell; no `h-[400px]`.

### 4.4 Copy

New keys in [`frontend/lib/copy/extraction.ts`](../../../frontend/lib/copy/extraction.ts),
English only: `evidenceShowInDocument` ("Show in document"),
`evidenceLocatedInReader` ("Highlighted in the reader"),
`historyCurrentRun` ("Current"), plus any relative-time labels not already
present. Reuse existing keys where they exist (e.g. `evidenceLocate`).

## 5. Components touched

| File | Change |
|------|--------|
| `frontend/components/ui/popover.tsx` | `frosted-overlay` → solid `bg-popover` (D2). |
| `frontend/components/ui/dropdown-menu.tsx` | same (D2). |
| `frontend/index.css` | remove `.frosted-overlay` if unused after the above. |
| `frontend/components/extraction/ai/shared/AIPopoverShell.tsx` | **new** shared shell. |
| `frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.tsx` | use shell; keep-open on locate; active-ring state. |
| `frontend/components/extraction/ai/AISuggestionEvidence.tsx` | solid evidence bg; clickable passage + "Show in document →"; drop map-pin icon; active-ring prop. |
| `frontend/components/extraction/ai/AISuggestionHistoryPopover.tsx` | use shell; remove debug logs; English comments; run-relative-time + `Current`; no truncation; typed `formatValue`; content-aware height. |
| `frontend/lib/copy/extraction.ts` | new copy keys. |

## 6. Testing & verification

- **Vitest unit** (import `useReaderLocate` from `@/pdf-viewer/core` — engine-free,
  jsdom-safe; the `@prumo/pdf-viewer` barrel crashes jsdom):
  - Details: renders solid surface; clicking the passage calls `onLocate` and
    does **not** close the popover; active ring appears on the clicked citation.
  - History: groups by run; `Current` pill on the live run; relative-time
    header; long value wraps with full value in `title` (no `...`).
- **design-review loop** after implementation: solid surface over the real
  reader, narrow (~390) and dark mode; confirm no text bleed-through and no
  overflow/clipping.
- **Lint/typecheck**: `npm run lint`, `tsc` clean (React Compiler:
  `panicThreshold: all_errors` — no `try/finally` in component bodies).

## 7. Rollout

- Frontend-only PR → `dev`, squash-merge. Both screens inherit the fixes via the
  shared `FieldInput`.
- **Delete the throwaway harness before merge**: `frontend/pages/_DevAiPopupReview.tsx`
  and its DEV-only route + lazy import in `frontend/App.tsx`.
