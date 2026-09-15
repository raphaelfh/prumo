---
status: approved
last_reviewed: 2026-09-14
owner: '@raphaelfh'
---

# Extraction Review Table Workspace — Design Spec

**Date:** 2026-09-14
**Status:** Approved from prototype H

## 1. Decision summary

Replace the current low-density extraction form with the interaction model
validated in prototype H: a compact review table, a persistent section guide,
inline AI extraction details, optional question focus, and the document viewer
docked on the right.

The production change keeps the existing **section extraction** scope: one
action generates proposals for every eligible question in that section. It does
not add question-level AI extraction.

Every deliberate AI extraction is an auditable generation. It owns its value,
reasoning, citations, model, timestamp, and generation details even when its
value equals an earlier extraction. Technical retries of the same request remain
idempotent.

This spec replaces the presentation decisions in the 2026-06-19 extraction-view
design for the editable extraction workspace. It preserves that design's section
registry, progress semantics, citation location, autosave, run lifecycle, and
right-side document viewer.

## 2. Problem

The current field layout spreads a question, description, input, AI preview,
history, reasoning, evidence, and actions across tall rows and popovers. This
creates three costs:

- too few questions fit in the working area beside the document;
- reviewing a proposal requires repeated opening and closing of floating UI;
- the relationship between a proposal, its reasoning, its citations, and the
  extraction that produced them is difficult to scan.

The H prototype resolved the interaction direction, but production has one data
contract mismatch. `ExtractionProposalService.record_proposal` currently treats
an equal value as an idempotent replay. A deliberate re-extraction can therefore
reuse the old proposal while new evidence rows are attached to it, even if the
new model, rationale, or citations differ. That cannot represent the card model
approved here.

## 3. Goals and non-goals

### Goals

- Fit more questions beside the document without hiding full content.
- Keep manual entry, proposal review, reasoning, citations, and acceptance in
  one continuous workspace.
- Make section-to-section scanning and question-to-question review efficient
  with pointer and keyboard input.
- Support text, numeric values with units, single choice, multiple choice,
  boolean, date, dispositions, and long text in the same table structure.
- Show multiple AI extractions for one question without mixing their metadata.
- Make each section extraction independently observable and retryable.
- Preserve auditability, blind-review rules, the one-live-run invariant, and
  append-only human decisions.
- Remain usable when the form pane is compressed by the document viewer.

### Non-goals

- Changing consensus, finalization, reviewer visibility, or run-stage rules.
- Changing extraction template authoring or field-type semantics.
- Rebuilding PDF rendering, evidence anchoring, or citation highlighting.
- Adding question-level AI extraction or a field-specific extraction endpoint.
- Letting users reorder table columns.
- Showing raw model confidence as a calibrated probability.
- Keeping prototype variants A–I in production.

## 4. Existing foundations to reuse

| Capability | Existing source | Decision |
| --- | --- | --- |
| Section registry, active section, and progress | `buildSectionRegistry`, `useActiveSection`, `SectionNavLayout` | Extend; do not create a second navigation model. |
| Split workspace and right document pane | current extraction full-screen shell and `RunPdfContent` | Preserve the document on the right by default at desktop widths. |
| Section extraction | `POST /api/v1/extraction/sections`, `SectionExtractionService`, Celery status polling | Reuse as the only AI kickoff scope. |
| Typed field editors | `FieldValueEditor`, `DispositionRow` | Reuse inside table cells and focus mode. |
| Column resizing | `useResizableTableColumns`, `ColumnResizeHandle` | Reuse the Articles interaction and persistence behavior. |
| Proposal history | `AISuggestionReviewPopover`, suggestion-history read service | Replace the popover presentation; retain and adapt its data loading. |
| Per-proposal rationale and provenance | `extraction_proposal_records.rationale` and `.provenance` | Render on the owning extraction card. |
| Multiple citations | `ExtractionEvidence`, capped at three, with rank and position | Render every stored citation with its own locate action. |
| Accepted AI trace | reviewer decision `proposal_record_id` | Use as the persistent selected-card signal. |
| Human decision history | `RunDetailResponse.decisions` | Use to reverse an acceptance without deleting audit history. |

## 5. Alternatives considered

### 5.1 Proposal detail placement

- **Popover per question.** Rejected because it obscures nearby context,
  introduces open/close latency, and constrains long reasoning and citations.
- **One fixed inspector below or beside the table.** Rejected as the primary
  model because question and proposal become spatially separated and the
  inspector competes with the fixed document viewer.
- **Inline disclosure below the owning row. Chosen.** It preserves table
  scanning while opening complete details in the reading flow. Only the active
  disclosure consumes vertical space.

### 5.2 AI extraction granularity

- **Section and question actions.** Rejected for this delivery because the
  question action requires a new public contract, coordinate validation path,
  and overlapping-job rules.
- **Question action only.** Rejected because it removes the already integrated
  batch action and adds repeated clicks for normal section completion.
- **Existing section action only. Chosen.** It reuses the production endpoint,
  queue, polling, engine resolution, prompt assembly, verification, and proposal
  persistence. Question-level extraction can be specified later if real usage
  shows that re-running a complete section is too costly.

### 5.3 Repeated equal-value extractions

- **Continue value-based deduplication.** Rejected because equal values can have
  different reasoning, citations, engines, or verification results.
- **Always append, including transport retries.** Rejected because a timeout or
  Celery retry could manufacture duplicate cards.
- **Deduplicate by extraction-attempt identity. Chosen.** A new user action gets
  a new attempt id and a new proposal card. Replays of that same request reuse
  the proposal created for that attempt and coordinate.

## 6. Workspace structure

```text
Application header
└── Extraction workspace
    ├── Section guide                         shown by default
    ├── Review pane
    │   ├── Minimal quick-action bar
    │   └── Extraction review table
    │       ├── Compact section header
    │       ├── Question row × N
    │       └── Inline proposal disclosure    at most one question open
    └── Document viewer                       docked right by default
```

There is no extraction subheader. Review progress and undo remain in the
existing application header. Focus mode changes only the review pane contents;
it does not replace the page shell or introduce a different background.

### 6.1 Section guide

- Retain the current section guide's position and section-jump behavior.
- Each row contains the section label and `reviewed/total`; remove the leading
  status dot.
- Color only the numeric count: muted at zero, accent while in progress, and
  success when complete. The active row uses the existing restrained selection
  treatment rather than a saturated fill.
- Put the guide toggle at the far-left edge of the quick-action bar. Its icon is
  the inverse-facing section-list icon approved in H.
- Hiding the guide gives its width back to the review pane. Restoring it does
  not alter the document pane.

### 6.2 Section headers

- Use the existing sticky/collapsible extraction-section behavior at a reduced
  height and type scale.
- Header contents are collapse chevron, section name, compact question count,
  and an icon-only **Extract section with AI** action.
- The section action remains visible when collapsed.
- Section descriptions, when present, use the same hint/tooltip pattern as
  field descriptions and do not add a permanent second line.

## 7. Review table

### 7.1 Columns

The fixed semantic order is:

1. **Question**
2. **Extracted value**
3. **AI proposal**

Column reordering is deliberately unavailable. The Question and Extracted value
columns are resizable when the review pane is at least 900 px wide. The AI
proposal column receives the remaining width.

Use `useResizableTableColumns` and `ColumnResizeHandle`, including their pointer
capture and keyboard behavior, rather than a prototype-specific drag handler.
Persist widths under an extraction-workspace key scoped by user and template.
Clamp each adjustable column to a useful minimum and to a maximum that leaves
the proposal column operable. Double-clicking a handle resets that
column; the reset action in the quick bar resets both.

Below 900 px, hide resize handles and use responsive proportions. Below the
table's compact breakpoint, Question, Extracted value, and AI proposal stack in
that order. The row may grow vertically; the document must not gain page-level
horizontal overflow.

### 7.2 Question cell

- Show only the question label in the compact table. Do not reserve a second
  line for its description.
- Let the label wrap to as many lines as its current column requires; never
  ellipsize the question itself.
- Pointer hover and keyboard focus show the complete description in a bounded
  tooltip.
- Focus mode renders the description inline below the question title.

### 7.3 Value cell

- Render the existing type-correct editor, with compact controls appropriate to
  the field type.
- A long-text editor grows with content, keeps a visible vertical resize affordance,
  and has a bounded maximum height before internal scrolling.
- Numeric fields keep the unit adjacent to the number without consuming a
  separate table column.
- Single- and multiple-choice controls preserve human labels and stored codes.
- `DispositionRow` remains available according to each field's schema flags.
- Manual editing never silently accepts or rejects an AI proposal.

### 7.4 AI proposal cell

- Show the latest proposal value as plain preview text; remove the redundant AI
  icon and label.
- A proposal-count badge appears only when more than one extraction exists.
- Hover or keyboard focus shows the full preview in a bounded tooltip.
- Clicking the preview toggles the inline disclosure below the row.
- The preview may clamp visually in the cell because the tooltip and disclosure
  provide the complete text.

### 7.5 Action placement

- AI kickoff exists only in the section header.
- Proposal acceptance stays on the owning proposal card and in the quick-action
  bar. Focus exists only in the quick-action bar.
- There is no dedicated Actions column.
- Icons have tooltips with a concise label and shortcut where applicable.
- Selected actions use a subtle circular shadow with no border. Accepted uses a
  persistent success-colored check. Other active actions use a quiet neutral
  fill and shadow.

## 8. Quick-action bar and focus mode

The sticky bar contains, from left to right:

- section-guide toggle at the far left;
- current question label or compact question count;
- accept/unaccept current proposal (`A`);
- enter/leave focus mode (`F`), switching between open and closed focus icons;
- previous question (`Shift+Left`);
- next pending question (`Shift+Right`);
- reset column widths;
- undo latest local decision where the existing header does not already expose
  the same action.

Shortcuts do not fire inside inputs, textareas, selects, contenteditable
elements, dialogs, or menus. Every shortcut has a tooltip and accessible label.

Focus mode displays one question while preserving the section guide state,
quick-action bar, and right document viewer. It shows the full question,
description, complete value editor, and proposal disclosure. Entering and
leaving focus uses the same button. Previous and next navigation update the
focused question without leaving focus.

## 9. Multiple AI extractions

Opening a proposal renders complete extraction cards owned by that question.
Cards are ordered newest first.

Each card contains:

- extraction ordinal and a quiet `latest` label where applicable;
- source count, followed on the same title line by compact model and extraction
  date;
- full proposed value;
- **Why this suggestion** for that extraction;
- all citations stored for that proposal, ordered by rank;
- one minimal icon-only **Locate in document** action per citation;
- collapsible generation details sourced from that proposal's provenance;
- its own accept/unaccept check.

The default view shows one card at a time with previous/next controls and an
`n / total` position. A compare control switches to side-by-side cards. The
side-by-side layout uses as many columns as fit at a readable minimum width and
wraps remaining cards; it does not create horizontal page overflow. Switching
back to the carousel restores the previously selected card.

Locating a citation opens the document pane if needed, selects that citation as
active, moves the viewer to its stored position, and uses the existing
highlight and live-region feedback. Failure to locate keeps the card open and
uses the existing non-alarming unavailable state.

## 10. Acceptance and reversal

Acceptance remains an append-only reviewer decision linked through
`proposal_record_id`; it never mutates a proposal.

- A card is accepted when the current reviewer's latest decision for that
  coordinate links to that proposal and the displayed value still matches it.
- The card and quick-bar check stay green after refresh because this state is
  derived from `RunDetailResponse.decisions`, not transient component state.
- Clicking the green check again appends an `edit` decision restoring the
  current reviewer's last decision before that acceptance. If none exists, it
  appends an unresolved null value. It clears the AI link on the new decision.
- A manual edit after acceptance naturally clears the accepted visual state
  because the latest decision no longer represents adoption of that card.
- There is no separate Dismiss action.

The client derives the restoration candidate from the ordered decisions already
returned in run detail and passes it through the existing autosave decision
path. The backend remains the source of truth and retains both the acceptance
and its reversal in the audit trail.

## 11. Section AI extraction contract

Keep:

```http
POST /api/v1/extraction/sections
```

The request continues to carry project, article, template, active run,
`entityTypeId`, and the relevant `parentInstanceId` where applicable. Add an
optional `requestId` UUID. Current clients that omit it receive a server-generated
id.

An explicit section action extracts every eligible field in that section,
including fields that already have proposals. It does not overwrite reviewer
values. A newly generated proposal remains pending until the reviewer accepts
it. Schema-level exclusions and assessor-owned fields remain excluded exactly
as today.

The response and polling contract remain unchanged: `202 {job_id}` followed by
`GET /api/v1/extraction/sections/status/{jobId}`.

### 11.1 Operation state

The frontend tracks jobs by section key:

```text
section:{entityTypeId}:{parentInstanceId?}
```

Loading one section does not disable extraction actions for other sections.
The active section's action remains disabled until its job reaches a terminal
state.

The initiating icon becomes a spinner in place. Completion refreshes proposals
without moving focus or opening the disclosure. Failure changes the same action
to a retry state with the classified error in its tooltip; retry reuses the same
`requestId` only when resuming an uncertain transport result, and creates a new
one after a confirmed terminal failure.

## 12. Extraction-attempt identity and persistence

Add nullable `extraction_attempt_id UUID` to
`extraction_proposal_records`. Existing rows remain null. Every new proposal
created by section extraction must carry the request's `requestId`.

Add a partial unique index over:

```text
(extraction_attempt_id, instance_id, field_id, source)
WHERE extraction_attempt_id IS NOT NULL
```

Change proposal idempotency for these paths:

- same attempt + same coordinate returns the existing proposal and does not add
  evidence again;
- different attempt appends a new proposal even when the normalized value is
  identical;
- rationale, provenance, and evidence never move from one attempt to another;
- retries may update only the existing server-owned verification annotation
  under the current verified-mode rules.

The proposal creation result must tell the caller whether it inserted or reused
the record. Evidence rows are written only for an inserted proposal, or upserted
by `(proposal_record_id, rank)` if retry recovery requires it. A same-value new
attempt therefore produces a distinct card with truthful model, timestamp,
reasoning, citations, and generation details.

The suggestion-history read contract adds `extractionAttemptId` but continues to
return proposal id, created time, rationale, evidence, and provenance per item.
The frontend treats each proposal history item as one card; it does not group by
the HITL run id because repeated section actions intentionally share the one live
run.

## 13. Accessibility and responsive behavior

- Use semantic table/grid roles consistently; expanded content is associated
  with its row through `aria-expanded` and `aria-controls`.
- Tooltips are supplementary: every action has an accessible name and all full
  proposal content is reachable in the disclosure without hover.
- Column resize handles support pointer and keyboard input with a minimum coarse
  pointer target, even when the visible rule is narrow.
- Focus follows explicit navigation and section jumps; opening a disclosure does
  not steal focus from an editor.
- The document viewer remains on the right by default at desktop widths. Existing
  narrow-layout collapse behavior remains available when both panes cannot keep
  their minimum readable widths.
- Focus mode and expanded cards use the same continuous background as the review
  pane.
- Motion in the horizontal carousel respects `prefers-reduced-motion`.

## 14. States and error handling

- Empty proposal: show quiet `No AI extraction yet` copy; the section-header
  extraction action remains available.
- No information: render the typed `absent_reason` outcome and allow acceptance
  only when that disposition is allowed for the field.
- Loading history: skeleton only inside the disclosure; table input remains
  editable.
- Proposal refresh failure: preserve the existing cards and expose retry.
- Extraction failure: retain field values and existing proposals; show the
  classified failure on the initiating action.
- Partial section completion: refresh successful questions, mark the section
  action with a partial-result state, and expose failed-question count plus retry.
- Read-only stages: hide extraction and decision actions; keep proposal cards,
  provenance, citations, and locate actions readable.

## 15. Acceptance criteria

1. The desktop workspace opens with the section guide on the left and document
   viewer on the right, with no extraction subheader.
2. Question labels wrap; descriptions appear on hover/focus and inline in focus
   mode.
3. Question and value columns resize above 900 px using the shared Articles
   primitive, persist, reset, and never overlap adjacent content.
4. The layout has no page-level horizontal overflow at the supported compact
   widths.
5. Long text inputs can grow and be manually resized vertically.
6. Single choice, multiple choice, numeric-with-unit, long text, date, boolean,
   and disposition controls remain type-correct.
7. Proposal hover shows the complete preview; opening it expands below the row
   without a popover.
8. Multiple extractions render as carousel cards and can be compared side by
   side. Every card owns its reasoning, citations, model, date, and generation
   details.
9. Each citation has its own minimal locate action and selects the correct
   document position.
10. Accepting a card persists a green check after reload; clicking it again
    restores the prior reviewer value through a new auditable decision.
11. Section extraction targets every eligible question in that section.
12. Other section extraction actions remain usable while one section job runs.
13. Two deliberate same-value extractions create two cards; a replay with the
    same `requestId` creates one card and one evidence set.
14. `A`, `F`, `Shift+Left`, and `Shift+Right` work outside editable controls and
    are disclosed in tooltips.
15. Read-only runs expose the audit trail without editable or AI kickoff actions.

## 16. Verification boundaries

Production verification must cover:

- existing section scope/BOLA tests for foreign entity type, parent instance,
  template, article, and run coordinates;
- unit and integration tests that section extraction covers every eligible
  field and preserves excluded-field rules;
- attempt-id idempotency, same-value new-attempt append, and evidence isolation;
- independent section loading state and terminal retry behavior;
- acceptance reversal across reload using reviewer decision history;
- table resizing by pointer and keyboard, persisted width clamping, and compact
  responsive layout;
- keyboard shortcut typing guards;
- carousel, comparison, multi-citation location, and read-only states;
- visual review with the document pane open at wide, compressed desktop, and
  narrow widths.

The throwaway H fixtures and their simulated 650 ms extraction are design
evidence only. They are not accepted as production verification.
