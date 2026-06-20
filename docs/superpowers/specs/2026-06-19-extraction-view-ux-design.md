---
status: proposed
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

> **Status:** Proposed — design approved in brainstorm 2026-06-19, not yet
> planned/implemented. Next step: `superpowers:writing-plans` to produce a
> phased implementation plan.
>
> **Reconciled 2026-06-19** against `origin/dev` (tip `024285f`, after merges
> #322 structured-PDF ingest, #324 data-path consolidation, #325
> grounded-extraction + reviewer click-to-highlight). Audit result: none of the
> proposed UX changes were pre-implemented, so the design stands; but two
> substantive reconciliations were applied below — (a) **§2**: PDF↔evidence
> *citation-highlight is now shipped* (#325), no longer a non-goal; (b)
> **§3.2 AI strip**: the affordance is now **modal-first**
> (`AISuggestionDetailsPopover`), so the consolidation builds on the shipped
> `AISuggestionEvidence`/`useCitationHighlight` rather than a flat inline link.
> Line numbers were refreshed to the post-merge locations but remain indicative
> — re-confirm at implementation time.

# Design: Extraction View UX — navigation, density, and chrome

**Date:** 2026-06-19
**Branch:** `claude/musing-morse-e2f724`
**Scope owner:** `@raphaelfh`

## 1. Context

The extraction view (`/projects/:projectId/extraction/:articleId`, page
`frontend/pages/ExtractionFullScreen.tsx`) is where a reviewer fills a
template-driven form (CHARMS ≈ 6 sections / 30+ fields plus N prediction-model
sub-forms; also PROBAST, QUADAS-2) against a source PDF, AI proposes values,
multiple reviewers diverge, and a manager reconciles to a finalized consensus.

Run locally on 2026-06-19 against the E2E fixture project (manager role,
REVIEW-stage CHARMS run) the current view shows three concrete UX problems
the project's own Plane/Linear/WorkOS design language is meant to avoid:

1. **No way to navigate a 6-screen form.** `ExtractionFormView.tsx:79-103`
   `.map()`s `SectionAccordion`s into the single `ScrollArea` hosted by
   `ExtractionFormPanel.tsx:48-58`. There is no section index, no jump, no
   at-a-glance "what's left". For a
   reviewer processing dozens of articles against the same template this is the
   single biggest cost.
2. **Very low density.** Field rows are ~80px (`FieldInput.tsx` fixed `py-4` +
   `h-9` + `gap-4`); each section is a large `bg-card border-l-4` card; a
   suggested field renders three separate AI affordances. The form is mostly
   whitespace.
3. **Cramped, cryptic chrome.** A two-row header crams two different "eye"
   metaphors (PDF show/hide *and* a non-interactive blind-mode badge), a bare
   `3%`, and a primary button that explains itself in parentheses
   ("Reconcile (advance to consensus)") and, when gated, fails silently.

This design addresses the three surfaces the product owner prioritized:
**(1) navigation between extraction sections, (2) core form density/editing,
(3) header/chrome/states.**

## 2. Goals & non-goals

**Goals**

- Make a long template form navigable and give a constant "what's left" signal.
- Raise density to the Plane/Linear bar without losing field descriptions /
  CHARMS codes or accessibility.
- Replace cramped, ambiguous chrome with one calm bar that makes the run's
  stage and the next action obvious, and that explains gated actions.
- Fix the field layout so it reflows correctly when the PDF panel is open.

**Non-goals (explicitly out of scope this round)**

- The multi-reviewer **compare** and **consensus** workflow (panel layout,
  divergence resolution, reveal/blind reveal mechanics beyond the header label).
- **Building the PDF↔evidence citation system** — it already shipped in #325
  (`AISuggestionEvidence.tsx`, `useCitationHighlight.ts`,
  `CitationOverlay`/`CitationLiveRegion`: click-to-jump-to-PDF, highlight,
  "couldn't locate in source"). This redesign **builds on** that baseline; it
  does not rebuild it. Out of scope here: paragraph-level anchoring and
  grounded-extraction parser depth (separate PDF-ingestion overhaul).
- Template authoring / schema changes. This is a presentation-layer redesign;
  no `extraction_*` schema, run-state, or API contract changes.

## 3. Design decisions

### 3.0 Shared foundation — a typed section registry

All three surfaces are driven by one new typed structure derived from the
template + live values, e.g.:

```ts
type SectionNavItem = {
  id: string;            // entity-type id / model-child key
  label: string;         // section title
  charmsCode?: string;   // e.g. "2"
  requiredTotal: number; // required fields in existing instances
  requiredFilled: number;
  state: 'complete' | 'in_progress' | 'empty';
  level: 0 | 1;          // 0 = study-level / 1 = model child
};
```

Source of truth: `hooks/extraction/useExtractionProgress.ts:28-51`
(`completedFields/totalFields` required) + `useTemplateEntityTypes`
(per-entity `is_required`). Post-#324, entity types + instances are no longer
loaded in `useExtractionData.ts` (gutted to article/project/template/articles
only, `:1-125`) — they arrive via the server **RunView**
(`GET /api/v1/runs/:id/view`) mapped through
`lib/extraction/runViewAdapters.ts:66-85`. The registry derives from those
adapters + the two hooks, and feeds the rail, the palette, the keyboard nav, the
tab fallback, and the global progress — one model, five consumers.

### 3.1 Section navigation — hybrid (approved)

**Base layer: persistent left outline rail.** A sticky ~184px left column
rendered as a sibling to the form `ScrollArea` inside `ExtractionFormPanel.tsx`.
Each row = tri-state status dot + label + bare `n/m` count; the active section is
tracked by an `IntersectionObserver` scrollspy and highlighted `bg-info/10` with
`aria-current="location"`; clicking smooth-scrolls **and** moves focus to the
section heading. Model sub-forms render as an indented second level under a
"Models" node. A pinned footer holds the global slim `Progress` bar + "required
left: N". The rail is a *lens over the existing single-scroll DOM*, not a router —
it does not touch consensus/PDF plumbing.

**Layer: command palette + keyboard nav.** Feed the same registry to the
installed `cmdk` `Command` primitive: ⌘K opens a "Go to section…" palette,
fuzzy-matchable by label **or** CHARMS code ("2.1"), each item showing
dot + label + code + count. A pinned top action — **"Jump to next
required-empty field"** (`⏎`) — reads required-empty from
`useExtractionProgress` and scrolls+focuses it; this is the keystroke that
collapses the whole what's-left workflow into one action. Always-on
`Cmd/Ctrl+[` / `]` (and `J`/`K`) move prev/next section, scoped to
**not-while-typing**. A faint `⌘K` hint lives in the More menu / shortcuts sheet.

**Responsive fallback: top tabs.** When the PDF panel opens (or the form
container falls below a width threshold) the rail collapses to a 44px **dot
strip** (dots only; label+count in tooltip). The sticky horizontal **section
tab bar** (pills with status dots, overflow into a `⋯` menu, active pill
auto-scrolled into view) is the named-section affordance for that narrow state.
The form column shrinks before the rail does — the rail is never the element
sacrificed to the PDF.

**Rejected as primary:** section-at-a-time **wizard**. It optimizes the
first-time user, punishes the expert repeat user (Next × 6 × dozens of
articles), and fights reading the PDF in source order. Reserve one-section-at-a-
time *only* for editing a single prediction-model child in a drawer/modal.

### 3.2 Core form density & editing

- **Flat sections, not cards.** Replace the `bg-card border-l-4` card +
  `px-6 py-4` header + `px-8 pb-8` body (`SectionAccordion.tsx:159-168, 236`)
  with a flat **sticky section header row** (title `text-[14px] font-medium`,
  the ✨ Extract action, collapse chevron) and hairline dividers inside the
  scroll. The completion **color moves to the rail dot**.
- **Dense row + capped-left labels with container-query reflow (approved).**
  Field row becomes
  `grid grid-cols-1 @md:grid-cols-[minmax(0,232px)_1fr] gap-x-3.5 gap-y-1`,
  `py-2.5`, input `h-8 text-[13px]`. Two fixes in one: caps the label column at
  232px (not `30%` of an ever-widening screen) **and** uses a **container
  query** (`@md`) instead of the current viewport breakpoint
  (`FieldInput.tsx:384` `sm:grid-cols-[30%_1fr]`) so it reflows to stacked when
  the *panel* is narrow, not when the *window* is. Net ≈ 52px vs ≈ 80px per row
  (~one screen less scroll on CHARMS), zero info loss.
- **Consolidate the inline AI affordances (build on the shipped modal-first
  design).** As of #325 the affordance is modal-first: evidence, reasoning, and
  history already live in `AISuggestionDetailsPopover` (which renders the shipped
  `AISuggestionEvidence` — a "Jump to source in PDF" icon button + page badge
  ("p. N") + non-alarming "Couldn't locate in source", wired to
  `useCitationHighlight`). What is still cluttered is the **inline trio**:
  `AISuggestionBadge` right of the input (`FieldInput.tsx:413-418`), an
  always-visible History button (`:421-450`), and the `AISuggestionDisplay` row
  below (`:454-466`). Consolidate *those three* into one compact 24px strip under
  the input — `✨ · suggested value (text-ai) · confidence pill (bg-ai/10) ·
  ✓ accept (text-success) · ✗ reject` — where the value/confidence is the
  trigger that opens the **existing** details popover (evidence + highlight +
  history). Do **not** duplicate an evidence link inline or rebuild citation UI;
  reuse `AISuggestionEvidence`'s "Jump to source in PDF" affordance. Drop the
  always-on inline History button (it's already in the popover) and the standalone
  badge. **Open question (was an assumption):** an accepted+unedited value today
  renders nothing (`shouldShowSuggestion` false, `FieldInput.tsx:373`) — decide
  whether to add a tiny `✨ AI` provenance marker or keep it hidden.
- **Calmer validation.** Move format validation to **blur**, required-empty to
  **finalize-attempt** (today `validateValue` runs inside `handleChange`,
  `FieldInput.tsx:~134-137`, flashing red on keystroke). An empty required field
  pre-submit is **neutral** (asterisk only); `border-destructive` is reserved
  for attempted-and-invalid; once a field has errored, live-revalidate on
  subsequent keystrokes so the user watches it clear.
- **Three-level progress.** Drop the redundant per-section `count + percent`
  (`SectionAccordion.tsx:112-136, 182-184`). Rail = dot + bare count; flat
  section header = one phrase ("2 of 5 required"); global = one slim bar +
  "required left: N". Mark required fields only (asterisk), never optional.
- **Keyboard-first editing.** DOM order = visual order = CHARMS order; pull AI
  accept/reject/history out of tab order (`tabindex=-1`) so Tab never lands on a
  ✓ between two inputs; Enter-to-advance in single-line inputs (Cmd/Ctrl+Enter in
  textareas); Cmd/Ctrl+Enter accepts a pending suggestion, Cmd/Ctrl+Backspace
  rejects.
- **Autosave status chip.** One debounced (~600–800ms) global chip (where the
  reviewer badge sits): Saving… → Saved (timestamp on hover) → Save failed —
  retry; `text-[11px] text-muted-foreground`, only failure gets `text-destructive`
  + a real retry. Flush on blur, section change, `beforeunload`. Move the
  field-just-updated flash keyframe off yellow (`index.css:6`,
  `rgba(253,224,71,…)` reads as a warning) to the AI violet `--ai` at low alpha.

### 3.3 Header / chrome / states

- **One calm bar.** Collapse the conditional reviewer sub-row / HITL banner
  (`ExtractionFullScreen.tsx:1110-1130`) — reviewer count + divergence belong in
  the stage rail and only when `stage !== 'proposal'` (already gated that way).
  The 90% solo-filling case has no second row.
- **Stage rail.** A first-class Proposal → Review → Consensus → Finalized
  indicator (current stage filled) replaces the self-explaining button label;
  the primary button names only the next transition ("Reconcile", no
  parenthetical — the label, computed at `ExtractionFullScreen.tsx:1037-1045`,
  still reads "Reconcile (advance to consensus)" at `:1044`).
- **Self-explaining gated action.** `HeaderFinalizeButton` (today
  `disabled={!isComplete}`, `:34`) gets a tooltip + thin inline helper
  ("Fill N more required fields · X of Y done", from `useExtractionProgress`),
  and clicking the disabled Reconcile lights up rail sections with required-empty
  fields and scrolls to the first — the mute gate becomes a guide. (Today the
  only "why" is a toast fired *after* a dead click.)
- **Fix the two eyes.** Remove the non-interactive, manager-only blind
  `EyeOff` badge (`HeaderStatusBadges.tsx:82-96`); express blind state as a role
  label ("Manager · blind"); surface the actionable reveal in the
  compare/settings affordance where it belongs. Replace the PDF show/hide eye
  (`HeaderPDFControls.tsx:42-67`, Eye/EyeOff) with a single **panel-toggle**
  button (`ti-layout-sidebar-right`) with `aria-pressed` + a pressed state — one
  eye retired, the other replaced by a panel metaphor.
- **Demote ambient status.** Role + completion % are the only always-on chips;
  `SaveStatusBadge` becomes a dot + word; the Compare-view toggle and Reopen
  move into the `⋯` menu (edge/power actions).
- **States.**
  - *Loading:* layout skeleton — render the real header chrome immediately
    (needs no run data) and skeleton only the form body — instead of the centered
    `Loader2` (`ExtractionFullScreen.tsx:901-909`).
  - *PDF error:* panel-scoped error inside the viewer
    (`ExtractionPDFPanel.tsx:37-50` wraps `@prumo/pdf-viewer` with no error UI
    today) — icon + "PDF not available for this article" + Retry — so a 404 PDF
    degrades the **panel** only; the form stays usable. (Observed live: "Failed
    to sign URL for article file: Object not found".)
  - *Finalized:* visibly read-only — disabled inputs + a one-line banner
    "Finalized — values are locked. Reopen to revise." (`isFinalized`,
    `ExtractionFullScreen.tsx:174`); stage rail shows Finalized; primary becomes
    Reopen (manager) or disappears. (Live, a finalized run already shows a
    "Published" badge + "Finalize"/"Reopen for revision" — but fields still look
    editable, which this fixes.)
  - *Page error:* in-place error card with `error.message` (per the API error
    envelope rule — read `error.message`, not `detail`) + Retry + Back, replacing
    redirect-on-toast (`ExtractionFullScreen.tsx:540-544`).
- **Worklist pager (P2).** Turn the bare `1/1` counter into a popover listing
  queue articles with per-article status (not started / in review / finalized) +
  "4 of 28 · 12 remaining"; attach the loose prev/next ghosts into one pill; add
  `J`/`K` article nav in the shortcuts sheet. Drop `hover:scale-[1.02]` on the
  primary (reads toy-ish against the Linear target) for a calm bg/border hover.

### 3.3a Shared `RunHeader` lib — 2026 header redesign (approved 2026-06-20)

Supersedes/expands §3.3 with the full, trend-aligned header. **Key finding:** the
header is **not actually shared today** — extraction renders `ExtractionHeader`
plus an orphaned second "HITL banner" row (`ExtractionFullScreen.tsx:1108-1139`),
while QA hand-rolls a completely different inline header
(`QualityAssessmentFullScreen.tsx:477-580`); they share only leaf primitives. The
redesign builds a real composable lib both kinds compose from. The data layer is
already in place (no backend): `useReviewerSummary` exposes
`reviewers`/`divergentCoords`/`requiredReviewerCount`/`completionRatio`;
`permissions` gives `userRole`/`isBlindMode`/`canResolveConflicts`/`canSeeOthers`.

**New home:** `frontend/components/runs/header/` (beside the leaf primitives it
wraps). shadcn/Radix **compound component** (provider context + slot
subcomponents), kind-discriminated (`'extraction' | 'qa'`):

```tsx
<RunHeader kind stage role isBlind canReveal onReveal progress reviewers
           transition save worklist>
  <RunHeader.Left>  <RunHeader.Breadcrumb/> <RunHeader.StageRail/> </RunHeader.Left>
  <RunHeader.Center><RunHeader.Reviewers/>  <RunHeader.RoleChip/>  </RunHeader.Center>
  <RunHeader.Right>
    <RunHeader.Worklist/>     {/* extraction only */}
    <RunHeader.PanelToggle/>  {/* QA omits — no PDF */}
    <RunHeader.AIActions/> <RunHeader.Save/>
    <RunHeader.PrimaryAction/>{/* driven by a typed StageTransition, NOT finalizeLabel */}
    <RunHeader.Menu/>
  </RunHeader.Right>
</RunHeader>
```

`StageRail / Reviewers / RoleChip / Save / AIActions / PrimaryAction` are identical
for both kinds; only `Breadcrumb / Worklist / PanelToggle / Menu`-items are
kind-discriminated. The linchpin is the typed transition descriptor:

```ts
type StageTransition =
  | { to: ExtractionRunStage; label: string; gate: { ok: true };  onAdvance: () => Promise<void> }
  | { to: ExtractionRunStage; label: string; gate: { ok: false; reason: string; remaining: number }; onAdvance: () => Promise<void> };
```

**Proposals (build ON §3.3):**

- **P0 — Stage spine.** `RunHeader.StageRail`: Proposal → Review → Consensus →
  Finalized; done = `bg-success` dot + check, current = `bg-info` dot in a
  `bg-info/10` pill + a 2px completion underline (kills the bare `%`), future =
  hollow ring, finalized = lock. Each state has a distinct **icon** (never color
  alone). Current node carries the gate chip ("3 left", `text-warning`); a revision
  run prefixes a `bg-ai/10 text-ai` "Revision" tag (absorbs the banner's revision
  pill). Replaces the work the button label does at `:1044`.
- **P0 — Self-explaining gated `PrimaryAction`.** Label = the next verb only (no
  parenthetical). When `gate.ok === false`: stays enabled-looking
  (`aria-disabled` + `aria-describedby`), shows "N of M required" inline *before*
  the click, and on click runs **guide-me** (scroll+focus first required-empty
  field, pulse the rail) instead of a post-click toast. Drop `hover:scale-[1.02]`.
- **P0 — Two eyes resolved.** PDF show/hide → `RunHeader.PanelToggle`
  (`PanelRight`, `aria-pressed`, pressed `bg-muted`); the non-interactive blind
  `EyeOff` badge is deleted and blind moves onto the role chip text
  ("Manager · blind").
- **P0 — Status economy + one bar.** `%` → stage underline; `SaveStatusBadge` →
  ambient dot+word (hidden when finalized, fades after idle); the orphaned banner
  row folds into row one.
- **P0 — Build `<RunHeader>` lib** and re-implement `ExtractionHeader` as a thin
  composition with the **same external props** (zero page change first).
- **P1 — Reviewer presence.** `RunHeader.Reviewers`: overlapping
  `bg-reviewer-1..5` avatars (filled ring = submitted) past Proposal; a
  `text-warning` "⑂ N differ" chip on divergence → jumps to consensus/compare.
  Replaces the numeric `ReviewerProgressBadge` as default.
- **P1 — Honest blind/reveal.** `RunHeader.RoleChip` "Manager · blind" is a
  Popover whose action toggles the per-kind `managers_see_reviewers[kind]`
  (`permissions.canSeeOthers`) → "Manager · revealed". Consensus never shows blind.
- **P1 — AI at the right weight.** `RunHeader.AIActions`: secondary "Extract with
  AI" (violet `text-ai` sparkle) in Proposal, before PrimaryAction; collapses to a
  `bg-ai/10` "AI · N" chip after. Never `bg-primary`.
- **P2 — Worklist peek.** `RunHeader.Worklist` (extraction only): `‹ 4/28 ›` pill
  → Popover `Command` queue with per-article status dots, "12 remaining", `J`/`K`.
- **P2 — Cmd-K long-tail + container-query collapse.** Push Reopen/Compare/Export/
  Reveal/panel-toggle into `cmdk`; collapse the bar by its **own width** (container
  query, not viewport), primary + Cmd-K last to go.

**Migration order (safe):** build `RunHeader.*` wrapping existing leaf primitives →
re-skin `ExtractionHeader` under the same props → fold the banner row into
`StageRail`/`Reviewers` and delete it → swap QA's inline header → replace the
`finalizeLabel` string with the `StageTransition` descriptor end-to-end. Same
constraints as §6 (React Compiler no try/finally; copy via `lib/copy`; read
`error.message`; no schema/API changes).

**Status (2026-06-20):** P0 + the calm-bar P1 slot behaviors shipped on
`claude/musing-morse-e2f724` (lib at `frontend/components/runs/header/`,
`ExtractionHeader` re-skinned, banner folded, AI-extraction re-wired, article
pager preserved; final review: ready to merge). **Plan 2 (same branch) scope —
the QA-migration prerequisites flagged during review, do these when wiring QA:**
(1) the shared slots currently call `t('extraction', …)` and `stage.ts` hardcodes
the four stage labels — move the shared `runHeader*`/stage keys to a `runs`/
`common` namespace (or thread a `copyNs`/label set through `RunHeaderValue`) before
QA composes the slots; (2) widen `StageTransition.to` off `ExtractionRunStage` to a
neutral type in the shared context; (3) consider folding `SaveSlot` into the
shared `SaveStatusBadge` (ambient variant) rather than two save components; (4)
the residual `HITLStatusBadges`/`ReviewerProgressBadge` strip below the bar (a
partial fold) — fully fold into `StageRail`/`Reviewers` or keep deliberately.
Also still P2: `RunHeader.Worklist` peek, Cmd-K long-tail + container-query
collapse (the bar overflows below ~1100px until then), the actionable reveal
(`canReveal`/`onReveal` is stubbed today), and restoring shortcuts/help into Cmd-K.

## 4. Design tokens (reuse — do not invent)

Confirmed against `frontend/index.css` + `tailwind.config.ts` + live components.

- **Surfaces:** page `bg-background`; form scroll area `bg-muted/30`
  (`ExtractionFormPanel.tsx:49`); section `bg-card`; popovers/palette
  `bg-popover text-popover-foreground` + `shadow-elev-popover`. Rail surface:
  `bg-muted/30` (do **not** invent `bg-[#fafafa]`).
- **Borders:** `border-border` (dividers, `divide-y divide-border/40`),
  `border-input` (inputs). Keep the existing state mapping
  (`border-l-success` complete / `border-l-info` partial / `border-l-border`
  empty) but move the signal onto the **rail dot**, not a 4px card border.
- **Text:** `text-foreground` / `text-muted-foreground` /
  `text-destructive` (asterisk + real errors only). Density type scale: body/input
  `text-[13px]`; label `text-[13px] font-medium`; hint `text-[11px]
  text-muted-foreground leading-snug`; CHARMS chip `font-mono text-[10px] px-1
  py-px rounded bg-muted`; headings `font-semibold tracking-tight`.
- **Status/accent:** `bg-primary` (primary action); `bg-success`/`text-success`
  (complete dot, accept ✓); `bg-info`/`text-info` + `bg-info/10` (active rail,
  evidence link); `bg-warning`/`text-warning` (low-confidence < 60% pill);
  `bg-destructive` (real errors). AI language: `text-ai`, `bg-ai/10`,
  `border-ai/60 bg-ai/5` (pending-suggestion field tint — already correct in
  `FieldInput`). Reviewer avatars `bg-reviewer-1..5`.
- **Radii:** `rounded-lg`/`-md`/`-sm` (all derive from `--radius` 0.5rem; never
  hardcode px radii).
- **Spacing/height:** header `h-12` `bg-background/80 backdrop-blur-md border-b
  border-border/40`; control height `h-8` (down from `h-9`/`h-10`); field row
  `py-2.5`; section gaps `gap-4`; rail 184px expanded / 44px collapsed.
- **Focus (a11y, non-negotiable):** `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2`. The olive/khaki focus observed live is the native
  date/number UA highlight — fix per-control with `appearance-none` + this ring,
  **not** a token change.
- **Installed primitives (no new deps):**
  `components/ui/{command,tabs,sidebar,resizable,scroll-area,progress,accordion}.tsx`.

## 5. Phasing

**P0 — highest impact / lowest risk**

- Typed section registry (§3.0).
- Left outline rail with scrollspy, dots+counts, click-to-jump, global progress
  footer (§3.1 base).
- Dense row spec + capped-left labels + container-query reflow (§3.2).
- Flatten section cards → flat sticky headers + dividers (§3.2).
- Consolidate the inline AI trio (badge + History button + display row) into one
  compact strip that opens the existing details popover — build on the shipped
  citation system, don't rebuild it (§3.2).
- Calmer validation timing (§3.2).
- Header: one calm bar; remove dead blind badge → role "· blind"; PDF eye →
  panel toggle; self-explaining gated Reconcile; panel-scoped PDF error (§3.3).

**P1**

- Command palette + `Cmd/Ctrl+[ ]` / `J K` keyboard nav + "next required-empty"
  (§3.1 layer).
- Responsive rail→dot-strip + top-tab fallback when PDF open / narrow (§3.1).
- Three-level progress model (§3.2).
- Keyboard-first editing (tab order, enter-to-advance, accept/reject shortcuts).
- Global autosave chip + on-brand just-updated flash (§3.2).
- Stage rail; demote save-state; move Compare/Reopen into `⋯` (§3.3).
- Loading skeleton; explicit read-only finalized (§3.3).

**P2**

- Finalize-gate "guide me to what's missing" interaction (§3.3).
- Low-confidence amber confidence pill (< 60%) (§3.2). The evidence
  jump-to-PDF + page badge already shipped in #325 — no paragraph (`¶`) anchoring
  in the current citation model; treat that as a later refinement.
- UA focus fix (`appearance-none` + ring) (§3.2/§4).
- Portuguese copy bug: `ModelSelector.tsx:131`
  ("Adicione um modelo manualmente ou extraia automaticamente do artigo.") — a
  PT string **and** a hardcoded-copy violation; route through
  `t('extraction', …)` in `frontend/lib/copy/`.
- Worklist pager popover + `J`/`K` article nav; in-place page error; calmer
  primary hover (§3.3).

## 6. Implementation constraints

- **React Compiler is on at `panicThreshold all_errors`.** The scrollspy
  `IntersectionObserver` hook and any autosave debounce live in `frontend/hooks/`
  with **no `try/finally` in the body** (IO via a `services/` `ErrorResult`
  function). `FieldInput`/`ExtractionFormView` already carry hand-written
  `// kept:` memo comparators — preserve them; run
  `enumerate_compiler_bailouts.mjs` before/after.
- **Container query, not viewport.** The PDF-split reflow fix is specifically a
  `@md` container query swap at `FieldInput.tsx:384`; a `sm:` viewport breakpoint
  will not fix it.
- **Copy discipline.** All user-facing strings via `frontend/lib/copy/`;
  English only.
- **No schema / API / run-state changes.** Presentation layer only; do not touch
  blinding/stage/progress behavior or add mutations.
- **A11y:** rail is a `<nav>` of buttons with roving tabindex + `aria-current`;
  tabs use the `role=tablist` ARIA pattern; panel toggle uses `aria-pressed`;
  decorative icons `aria-hidden`; every control keeps a visible focus ring.

## 7. Testing

- **Vitest (component):** rail renders one row per section with correct
  dot-state and count from a mocked registry; clicking a row calls scroll+focus;
  active-state follows a mocked IntersectionObserver; dense row reflows stacked
  under a narrow container (container-query); AI strip renders value/confidence/
  accept/reject and accept writes the value; validation is neutral pre-submit and
  red only after an invalid attempt.
- **Playwright (E2E, local fixtures):** open the E2E CHARMS review run; rail jump
  scrolls to a section and moves focus; ⌘K → "next required-empty field" lands on
  the first required-empty input; disabled Reconcile shows its reason and the
  guide-to-missing interaction; PDF panel 404 shows a panel-scoped error while the
  form stays interactive; finalized run renders read-only. Include an `axe` pass.
- **Visual:** before/after screenshots of the form (full-width + PDF-open) and
  the header per `design-review`.

## 8. Risks & open questions

- **Scrollspy ambiguity** when two short sections share the viewport — needs
  `scroll-margin-top` + an intersection-ratio heuristic (not naive topmost).
- **Rail vs PDF width** — mitigated by the 44px dot-strip collapse + tab
  fallback; confirm the collapse threshold against the resizable panel's min size.
- **Single-key shortcuts** (`J`/`K`) must be strictly scoped to not-while-typing
  to avoid eating input.
- **Model sub-forms** need the rail's second indent level and a clear count
  rollup; confirm behavior when models are added/removed mid-session.
- Open: should there be an opt-in **wizard mode** toggle for novice/occasional
  reviewers (using the same registry), or is that scope creep? Deferred.

## 9. References

- Brainstorm grounding: prumo design tokens + best-practice survey
  (Linear / Plane / Notion / Stripe / REDCap / Castor), 2026-06-19.
- Canonical schema: `docs/reference/extraction-hitl-architecture.md`.
- Frozen HITL design: `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`.
- Visual language: `frontend-ux` / `ui-styling` skills; loop: `design-review`.
