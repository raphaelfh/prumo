---
status: approved
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Configuration as views — review question, template instruction, linkable settings

Sub-project 2 of 3 in the "less friction, fewer elements" train. Sub-project 1
(interaction primitives, `docs/superpowers/specs/2026-09-12-interaction-primitives-design.md`,
PR #887) fixed the frame every popup shares and set the boundary this spec
applies: *anything with tabs, sections, a list or its own save lifecycle is a
view*. Sub-project 3 (borderless density pass) follows.

## 1. Problem

Survey of `dev` at `75fedbce`, after PR #889 (LLM connections, slice 2)
retired the engine chip, the engine-settings dialog and the endpoints dialog.
Every overlay was inventoried (36 content elements) and the config surfaces
were rendered at 1280 and 390 px.

| Surface | State |
|---|---|
| Review question (PICOTS, project-wide, 6 parts + "Send to the AI") | A dialog opened from an "Edit review question" button inside Project → Configuration → Review details: a popup on top of a settings view. Also a tab of the QA ✨ dialog. |
| Template general AI instruction (per template, part of the draft, ships on Publish) | QA: the ✨ button on each enabled tool opens `AiConfigDialog` on its Instruction tab. **Extraction: unreachable.** Before #889, `LlmEngineChip` was the extraction config bar's only entry into `AiConfigDialog`; #889 removed the chip and nothing replaced it. |
| Project → Configuration rail | Section is component state (`ProjectSettings.tsx:54`), not in the URL: no section can be linked. "Review details" stacks methodology, the review-question card, the AI engine card and shared keys. The rail hardcodes `bg-[#fafafa] dark:bg-[#0c0c0c]`. |
| `lg` dialogs | Fixed `h-[85dvh]` (`overlay-frame.ts`): short content leaves dead space. |

Everything else classifies as a legitimate popup under the sub-project 1
boundary: confirms, add/rename entry, feedback, import/export flows (HITL,
articles, RIS, Zotero, template import), the publish-diff and version-history
sheets. `AddSectionDialog` is deliberately out of scope (§8).

## 2. Goals and non-goals

Goals:

1. No configuration lives in a popup: the review question and the template
   instruction are edited inline, where their owner is.
2. The extraction template instruction is reachable again.
3. Every Project → Configuration section has a URL.
4. `lg` dialogs hug their content up to the cap.

Non-goals:

- Inline section creation (reverses B-8, needs `is_required` on the section
  PATCH) — its own follow-up spec (§8).
- Card and border removal on the settings pages and the article form
  (sub-project 3). This spec moves content; it does not restyle it beyond the
  new surfaces.
- Guarding navigation *away from* `?tab=settings` with unsaved edits (sidebar,
  browser back). Only the in-page section switch is guarded, like the article
  side panel.

## 3. Decisions (settled in brainstorming, 2026-09-13)

| Decision | Choice | Why |
|---|---|---|
| Where the AI context lives | Split by owner: review question → Project → Configuration section; template instruction → the template editor it ships with | The instruction is part of the template draft and ships on Publish; editing it far from Publish blurs that lifecycle. `AiConfigDialog` is deleted. |
| Review question save model | Section-owned Save / Cancel, visible only while dirty; discard confirm on section switch | Keeps the single manager-gated typed PUT that fixed the silent-RLS-loss bug (`PicotsPane` header); joining the batched header save would put two writes behind one button. |
| Extra scope | Linkable settings sections (+ AI engine as its own rail item) | Deep links replace popups as the way other surfaces point at settings. |
| Inline section creation | Deferred to its own spec | Reverses a documented decision (B-8) and needs a backend PATCH change. |
| `lg` dialog height | Hug content, cap 85dvh; a loading body reserves a min height | Removes dead space; the reserve stops the frame jumping while a list loads. |
| View gutter | Every project tab follows Articles: full-bleed, one `p-2` inset owned by the view (user request, 2026-09-13) | Extraction sat inside ProjectView's `px-4 py-3 lg:px-6` + `max-w-[1800px]`; QA added its own `p-4 lg:p-6` on top of it (doubled padding). Articles' 8px inset is the density the user picked; `frontend-ux` §6 moves to it. |
| Shortcut guard | Merged as PR #892 (`fix(shortcuts): gate chords on open AlertDialogs`) | The new discard confirm is an `AlertDialog`; without #892, app chords fire under it. |

## 4. Design

### 4.1 Project → Configuration: sections in the URL

`ProjectSettings.tsx` derives the active section from the URL instead of
`useState`:

- Param: `section`, alongside the existing `tab=settings`.
  `SectionId = 'basic' | 'review' | 'review-question' | 'ai-engine' | 'team' | 'consensus' | 'advanced'`.
  A missing or unknown value renders `basic`. The value is read, never mirrored
  into state.
- Selecting a rail item writes `section` with `{replace: true}` and keeps every
  other param (the `UserSettings` `?tab=` precedent).
- Rail order: Basic info, Review details, **Review question**, **AI engine**,
  Team, Review consensus, Advanced. New copy keys for the two labels and their
  header descriptions in `lib/copy/project.ts`.
- `review` renders `ReviewDetailsSection` only. `ai-engine` renders
  `AiEngineSection` unchanged. `review-question` renders the new section (§4.2).
- The rail's hardcoded `bg-[#fafafa] dark:bg-[#0c0c0c]` is dropped: the
  `UserSettings` rail paints no background of its own and keeps only its
  `border-r border-border/40` hairline (no raw colour — `ui-styling` rule 2).
- **Unsaved guard.** While the review-question section reports dirty,
  selecting another rail item opens an `AlertDialog` ("Discard unsaved
  changes?", Cancel / Discard, `variant="destructive"` on Discard). Discard
  switches; Cancel stays. Same shape as the articles split shell's discard
  dialog, with its own keys (`project.settingsDiscardTitle`, `…Body`,
  `…Cancel`, `…Confirm`) rather than reaching into the `articles` namespace.

### 4.2 Review question section

New `frontend/components/project/settings/ReviewQuestionSection.tsx`:
`SettingsSection` header (existing `aiContext` title/description copy) around
`PicotsPane`, mounted inline.

`PicotsPane` changes (it is already a pane, not a dialog):

- Drops `onClose` (a dialog concept). Adds `onDirtyChange(dirty: boolean)`.
- Natural height: no fixed-panel `flex-1 min-h-0 overflow-hidden` assumptions;
  the page scrolls.
- Footer: Cancel (`outline`, `sm`) + Save (`default`, `sm`), right-aligned,
  rendered only while the form differs from the server read, `sticky bottom-0`
  inside the settings scroll region with one `border-t border-border/40`
  hairline and `bg-background`. Cancel resets to the last server read. Save
  keeps the section open and resets dirty from the PUT's re-read.
- Non-manager: the fields render read-only and the footer never shows; one
  muted line states the reason (existing `aiContext.managerOnly`). The API is
  manager-gated either way.

`ReviewDetailsSection.tsx` loses the review-question `SettingsCard`, the
`AiConfigDialog` mount, `useAiContext` and the tooltip-wrapped Edit button; its
header comment is rewritten to say where the review question lives now.

### 4.3 Template instruction — one pane, two hosts

`TemplateInstructionPane` becomes host-agnostic:

- Drops `onClose`. The draft stays host-owned (`draft` / `onDraftChange`), so
  collapsing or re-selecting never destroys typed text.
- Natural height: the textarea has a minimum height (`min-h-40`) and grows with
  the host; no fill-the-fixed-panel flex contract.
- Cancel renders only while a draft differs from the saved value and discards
  the draft. Save behaviour, the 4000-char cap, the `[customize:]` warning,
  reset-to-origin and insert-suggested are unchanged.

`TemplateInstructionControl` (the ✨ trigger) stops mounting a dialog. Props
become `{projectId, templateId, draft, expanded, onToggle}`; it keeps its
accessible-name contract (label + empty state + customize count + unsaved dot,
never an `aria-label`) and adds `aria-expanded`.

**Extraction host** (`TemplateConfigEditor` → `TemplateConfigGridPanel` →
`TemplateInspector`):

- `TemplateConfigEditor` owns `instructionDraft` (reset when the active
  template id changes) and mounts `TemplateInstructionControl` on the config
  bar, in the command track before Export.
- Pressing ✨ bumps a `templateFocus` sequence number passed to
  `TemplateConfigGridPanel`. The panel, on a new sequence (compared in render
  against the last one it handled — the `focusGroup.seq` pattern, no effect),
  clears the selection and opens the inspector: the docked pane at wide
  container widths, the existing narrow sheet below `INSPECTOR_NARROW_PX`.
  `expanded` on the trigger is true while nothing is selected and the
  inspector is open.
- `TemplateInspector` with no field and no section renders a new
  `TemplateInspectorTemplatePane.tsx`: a "Template" kind badge row, an
  "AI instruction" label, the scope hint (`extraction.instructionScopeHint`),
  `TemplateInstructionPane`, and the existing empty hint as one muted line
  below. It replaces the "Nothing selected" block.

**QA host** (`QualityAssessmentConfiguration`):

- The component owns `drafts: Record<templateId, string | null>` and
  `instructionOpenFor: string | null` (one expander open at a time).
- ✨ toggles the expander. Expanded, the tool row renders
  `TemplateInstructionPane` directly below its control row, indented to the
  row's content column (`pl-7`), with no extra card or border.

`frontend/components/project/AiConfigDialog.tsx` and
`frontend/test/AiConfigDialog.test.tsx` are deleted, with the copy keys only
they used (`check_copy_keys.py` baseline shrinks, never grows).

### 4.4 `lg` dialogs hug their content

`overlay-frame.ts`: `lg` becomes `sm:h-fit sm:max-h-[85dvh] sm:max-w-[800px]`,
the same contract as `sm`/`md`. A caller whose body loads a list reserves
height on its loading body only (`min-h-[50dvh]` on the skeleton wrapper inside
`DialogBody`), never on the content. Callers after this spec:
`ArticleFileUploadDialogNew`, `ZoteroImportDialog`, `ImportTemplateDialog`.
The `frontend-ux` §8 table, the `ui-styling` "Frame mechanics" paragraph and
the overlay-frame test move from "fixed 85dvh" to "content, ≤85dvh".

### 4.5 One view gutter: the Articles pattern

Measured on `dev` (1280 px): the Articles list starts 8px from the sidebar
edge (`ArticlesSplitShell` list pane `p-2`, tab full-bleed); Data extraction
starts 24px in (ProjectView's non-full-bleed wrapper `px-4 py-3 lg:px-6`,
capped at `max-w-[1800px]`); Quality assessment starts 48px in at `lg`
(that wrapper plus its own `p-4 lg:p-6` — the doubled-padding violation of
`frontend-ux` §6 rule 2).

- `ProjectView` renders every tab full-bleed; `FULL_BLEED_TABS` and the
  padded wrapper branch are deleted (no tab uses them any more).
- `ExtractionInterface` owns one `p-2` inset on its content column;
  `QualityAssessmentInterface` replaces each `p-4 lg:p-6` with `p-2`.
- `frontend-ux` §6 page-gutter row and `.claude/rules/frontend.md` edge-budget
  line change from `px-4 py-3 lg:px-6` to `p-2`, citing Articles.
- Project settings keeps its form gutter here; sub-project 3's density pass
  takes it (it is a prose form, not a list view).

## 5. States and errors

| Surface | loading | error | read-only |
|---|---|---|---|
| Review question section | skeleton rows in place of the fields | existing load-error line + retry from `useAiContext`; save failure toasts and keeps the draft | non-manager: fields disabled, reason line, no footer |
| Extraction template pane | pane skeleton (existing) | save failure toasts, draft kept | editor hidden for non-managers — the Configuration tab is manager-only already |
| QA expander | pane skeleton | same as above | QA configuration is manager-only already |

A template switch on extraction resets `instructionDraft`. A section switch
with a dirty review question is the only confirm this spec adds.

## 6. Testing

Vitest (repo root, `npm run test:run`):

- `ProjectSettings`: `?section=review-question` renders that section; an unknown
  value renders basic; clicking a rail item writes `section` with replace and
  keeps `tab`; with a dirty review question, a rail click opens the discard
  confirm, Cancel stays, Discard switches.
- `ReviewQuestionSection` / `PicotsPane`: footer absent until an edit, present
  after, Cancel restores the server read, Save calls the PUT and hides the
  footer; non-manager renders read-only with no footer.
- `TemplateInspector`: no selection renders the template pane with the
  instruction editor; a field selection still renders the field form.
- `TemplateConfigGridPanel`: a new `templateFocus` sequence clears the
  selection and opens the inspector (docked and narrow-sheet branches).
- `TemplateInstructionControl`: toggles instead of opening a dialog; keeps the
  composed accessible name (customize count, unsaved dot) and `aria-expanded`.
- `QualityAssessmentConfiguration`: ✨ expands the pane under that tool only; a
  draft survives collapse and re-expand.
- `overlay-frame`: `lg` carries `h-fit` and `max-h-[85dvh]`, never `h-[85dvh]`.
- Existing tests that referenced `AiConfigDialog` or the review-question card
  are rewritten against the new surfaces, not deleted blind.

Gates: `npm run typecheck`, `npm run lint`, both knip modes at zero,
`scripts/fitness/run_all.sh` (copy keys, UI primitives, button scale, file
size).

Visual (`design-review`, one browser session, 1280 and 390 px): Configuration →
Review question (clean, dirty, non-manager), Configuration → AI engine,
extraction Configuration with the template pane docked and in the narrow sheet,
QA Configuration with an expanded instruction, the Zotero import dialog
hugging a short state. Carried from sub-project 1: confirm the hover fill on
`AllowedUnitsList` cmdk items.

## 7. Risks

- **Inspector width.** The docked inspector is 280–420 px; a 4000-char
  instruction in it is tall. Accepted: the pane scrolls with the inspector,
  and the textarea grows rather than scrolling inside a scroll.
- **Two hosts for one pane.** Draft ownership differs per host by design (the
  editor on extraction, the configuration list on QA); the pane's props make
  that explicit, and each host has its own test.
- **Deep links to removed sections.** None exist today (no inbound
  `?tab=settings` links outside the sidebar), so the URL contract starts clean.

## 8. Amendments from planning

Recorded while writing `docs/superpowers/plans/2026-09-13-configuration-as-views.md`,
after reading the code this spec surveyed. Where they disagree, this section wins.

1. **Non-manager review question.** `PICOTSItemEditor` has no disabled mode,
   so a non-manager sees the server preview (`aiContext.preview`, or
   `previewEmpty`) and the `managerOnly` line instead of disabled fields.
2. **Extraction ✨ trigger has no `aria-expanded`.** The editor cannot see the
   panel's selection, so on extraction the trigger is a reveal button (it
   clears the selection and opens the inspector). QA keeps `aria-expanded`
   because its host owns the expander state. `expanded` is optional on
   `TemplateInstructionControl`.
3. **Grid panel line budget.** `TemplateConfigGridPanel.tsx` sits at exactly
   the 800-line cap (`check_file_size.py` fails on `> 800`). Inspector
   visibility (`dockedOpen`, `sheetOpen`, open/toggle/close) moves into
   `template-config/useInspectorHost.ts` before the template-focus logic is
   added, and the panel must stay ≤ 800 lines.
4. **"Nothing selected" goes.** The inspector's no-selection state becomes the
   template pane; `extraction.inspectorEmptyTitle` is deleted and
   `inspectorEmptyHint` stays as the one muted line.

## 9. Follow-ups recorded

- **Inline section creation** — reverses the B-8 decision
  (`docs/superpowers/plans/2026-08-08-template-config-b8-entry-label.md`,
  "AddSectionDialog is the permanent create surface"). Since 0069 the
  inspector edits Repeats, entry noun and description after creation, which
  removes B-8's main reason; `is_required` is still create-only
  (`SectionUpdateRequest`), so the spec needs the section PATCH and inspector
  to gain it, and groups post the default noun for renaming.
- **Sub-project 3** — borderless density pass starting with the article edit
  form and Settings → Integrations.
