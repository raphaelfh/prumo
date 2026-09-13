---
status: draft
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Borderless density pass — flat label grid for settings and the article panel

Sub-project 3 of 3 in the "less friction, fewer elements" train.
- Sub-project 1 (interaction primitives, `docs/superpowers/specs/2026-09-12-interaction-primitives-design.md`, PR #887) set the cursor, tooltip, `IconButton` and overlay frame.
- Sub-project 2 (configuration as views, `docs/superpowers/specs/2026-09-13-configuration-as-views-design.md`, PR #896) moved configuration out of popups and gave every project tab the Articles `p-2` gutter.

This spec removes the frames, redundant text and bordered controls that remain on the settings pages and the article edit panel.

Design decisions were made with the user in brainstorming on 2026-09-13 (sections 1–3 below approved). Status is `draft` only until the user reviews this written document.

File references are to `claude/config-as-views` (PR #896) at `538aafb7`, which this work builds on.

## 1. Problem

Survey of `dev` plus PR #896 at 1280 and 390 px, done in one browser session, with a read-only code inventory.

| Surface | Noise |
|---|---|
| Every settings page | **Three heading layers, each with its own description.** (1) The `PageHeader` strip: "Project settings · Members and permissions" on project settings (title plus the active section's description); the tab's description alone on user settings, where the breadcrumb names the page. (2) The section heading and its description (`SettingsSection`). (3) A title and description on every group card (`SettingsCard`). Nearly every field also has a hint line (`SettingsField`). |
| Project → Configuration | **Nested frames.** A bordered box inside a `SettingsCard` (`BasicInfoSection.tsx:100`, `AiEngineSection.tsx:263`), a callout box and a dashed empty-state box on Review consensus (`ReviewConsensusSection.tsx:143,166`), a bordered box per template override (`TemplateConsensusOverride.tsx:115`), and a card per group everywhere. The page gutter is `max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8` (`ProjectSettings.tsx:173`), and content is unbounded (a 1352px-wide column at 1920). |
| Team | "Add member", "Current members" and "Roles and permissions" are three cards. The two lines of hint text under the invite form duplicate the role description. The empty member list is a callout box. |
| Security | A lock callout box repeats the password rules, which the field hint then says a third time. |
| Settings → Integrations | **Zotero** (`project/settings/ZoteroIntegrationSection.tsx`, rendered by `user/IntegrationsSection.tsx`). Label and value run together (`:97-108`: "User ID130...353", "Library typeuser"). A bordered status box and a bordered credentials box sit in one section. **Buttons.** Test connection, Disconnect and Add connection are `variant="outline"` in row positions, where frontend-ux says ghost. |
| Article edit panel | **Authors.** One bordered box per author row, with uppercase LAST NAME / FIRST NAME micro-labels that are not associated with their inputs (`ArticleAuthorsField.tsx:74-121`). **Files.** The only panel section wrapped in a `Card`, with a second heading ("Article files" under the section's "Files") and bordered or dashed file rows (`ArticleFilesSection.tsx:72,99,135`). **Keywords.** A bordered box with its own header strip and a divided list, followed by a hint line (`ArticleKeywordsField.tsx:56-57`, `sections/AdditionalInfoSection.tsx:36`). **Chrome.** Cancel is `outline` (`ArticleFormHeader.tsx:36`). |
| Form controls | `Input`, `Textarea` and `SelectTrigger` are `border border-input h-10` at rest everywhere; "borderless" has no shared expression. `TagInput` adds bordered chips and an unlabelled icon-only `outline` add button. |

`SettingsCard` is used in 8 files (`project/settings/{AdvancedSettingsSection,AiEngineSection,BasicInfoSection,ReviewConsensusSection,ReviewDetailsSection,TeamMembersSection}.tsx`, `user/{ProfileSection,SecuritySection}.tsx`).

`SettingsField` is used in `project/settings/{BasicInfoSection,ReviewDetailsSection,ConsensusConfigForm}.tsx` and `user/{ProfileSection,SecuritySection}.tsx`.

`SettingsSection` is used by the settings sections above, `user/IntegrationsSection.tsx`, `project/settings/ReviewQuestionSection.tsx`, and all five `articles/sections/*.tsx` headings.

`@/components/ui/alert` callouts are used in `project/settings/{ReviewConsensusSection,ConsensusConfigForm,TeamMembersSection}.tsx` and `user/SecuritySection.tsx`.

## 2. Goals and non-goals

Goals:

1. One heading layer per settings page, and no card, callout box or nested frame on any in-scope surface.
2. Settings fields read as a label/value grid with borderless, always-editable controls.
3. Guidance moves out of the way: field hints become ⓘ tooltips, and each section keeps at most one intro line.
4. Settings content sits in a readable column on large screens.
5. `SettingsCard`, `SettingsField` and `SettingsSection` are deleted, and a fitness gate keeps cards and callouts from coming back on these surfaces.

Non-goals:

- **Behaviour or data changes.** Save models stay as they are: the batched project-settings save, the review question's section-owned save, save-on-change for the AI engine, and immediate commits in the article panel. So do endpoints, permissions and copy meaning.
- **Other screens.** The extraction/QA worklists, QA Configuration, the template grid, the run views, dialogs and headers are untouched (sub-projects 1 and 2 own those).
- **The article panel's field rows.** They keep their click-to-edit `ArticleFieldRow` behaviour. Only the section headings, the authors block, the files section, the keywords block and the Cancel button change there.
- **Inline section creation.** That is a separate follow-up spec, recorded in sub-project 2 §9.

## 3. Decisions (brainstorming, 2026-09-13)

| Decision | Choice | Why |
|---|---|---|
| Border principle | **Fully flat label grid**: no cards on in-scope screens; forms are two-column label/value rows; sections are separated by a heading and whitespace | The user picked the most minimal option, a Linear-style settings layout. |
| Scope | Article edit panel, Settings → Integrations, every Project → Configuration section, user Profile and Security | Gives every `SettingsCard` / `SettingsField` / `SettingsSection` caller a migration, so all three components can be deleted. |
| Helper text | Field hints go into an ⓘ tooltip beside the label; a section keeps at most one short intro line; descriptions that restate the heading are deleted; placeholders stay as the inline example | Less text at rest. The guidance stays one hover away, through the shared tooltip from sub-project 1. |
| Edit model | Borderless inputs that are always editable: hover fill at rest, focus ring while typing; selects, textareas and switches match | One click to edit; keeps the page's existing save models and tab order. |
| Architecture | New `SettingsRow` + `SettingsGroup` (+ `SettingsPage`) primitives; a `quiet` variant on `Input`/`Textarea`/`SelectTrigger`; migrate every caller; delete `SettingsCard`, `SettingsField` and `SettingsSection` | Honest names and one place to change the look. Restyling the old components in place would leave a `Card` component that renders no card. |
| Page structure | One heading layer; groups separated by a single hairline; full-width flush lists (members, keys, connections, overrides); ghost row and chrome actions; a group's single primary action is filled, `sm`, under the value column | Approved as Section 1. |
| Content width | A readable column, `max-w-3xl` (~720px), left-aligned inside the view's `p-2` inset | Approved: inputs and text stay a readable length at 1920. |

## 4. Design

### 4.1 Primitives (`frontend/components/settings/`)

**`SettingsPage`** is the one wrapper per settings section body.
- Props: `intro?: string`, `children`.
- Renders an optional intro line (`text-[13px] text-muted-foreground`), then the children, inside `mx-0 w-full max-w-3xl`.
- Each section component (`BasicInfoSection`, `SecuritySection`, `IntegrationsSection`, …) renders its own `SettingsPage`, because the intro belongs to the section. `ProjectSettings.tsx` and `pages/UserSettings.tsx` own only the gutter.
- `PageHeader` is unchanged: "Project settings" plus the active section's description on project settings, the tab description on user settings. Section headings rendered by the old `SettingsSection` are deleted, so the header strip is the only page-level heading and group titles are the only heading inside the body.

**`SettingsGroup`**
- Props: `title?: string`, `hint?: string` (ⓘ tooltip next to the title), `tone?: 'default' | 'danger'`, `children`.
- The title is `text-[13px] font-medium` (`text-destructive` for `danger`). It has no description prop.
- A group draws `border-t border-border/40 pt-4 mt-4` unless it is the first child of its parent (`first:border-t-0 first:pt-0 first:mt-0`): one hairline per boundary, drawn by the group that follows (frontend-ux §6). In the article panel each group is the only child of its `<section>`, so the panel draws no hairlines and keeps its existing `space-y-8` between sections.
- The body stacks `SettingsRow`s or full-width content (lists) with `space-y-1`.

**`SettingsRow`**
- Props: `label: string`, `htmlFor?: string`, `hint?: string`, `required?: boolean`, `error?: string`, `align?: 'center' | 'start'` (default `center`; `start` for textareas and tag lists), `children` (the control and anything that belongs under it).
- Layout: `grid gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)]`.
- The label cell is right-aligned at `sm:` and above, `text-[13px] text-muted-foreground`, and carries `required` as a `*` in `text-destructive`.
- The hint is an `IconButton` (`size="icon-xs"`, `Info` icon) beside the label. Its accessible name is `common.fieldHintAria` ("About {{label}}"), and its `tooltip` is the hint text.
- The hint text also reaches the control's accessible description: the row renders a visually hidden `<span id>` with the hint.
  - The implementation plan picks a render-prop or `cloneElement` to hand that id to the control; both keep one text source.
  - **The id is merged, never overwritten.** Profile and Security wrap their inputs in react-hook-form's `FormControl`, which sets its own `aria-describedby` (description and message ids). The control's final `aria-describedby` must contain the hint id and the form message id.
- `error` renders under the control in `text-xs text-destructive` with its own id, appended to `aria-describedby`. Forms driven by react-hook-form keep `FormMessage` instead of `error`.
- Content that must stay visible and is not a hint stays under the control, inside the value column. This covers live feedback (Security's strength meter and match line) and links, since a tooltip cannot hold an interactive element (the provider docs link, Zotero's "How to find" link).
- Below `sm`, the label stacks above the control and aligns left.
- Rows are `py-1`, and there are no per-row hint lines.

**`TagInput`** stays, restyled for the flat grid: its input is `quiet`, and the add button becomes an `IconButton` whose label is the input's placeholder. Chips and list items drop their `border`; the list's inclusion/exclusion tints move from raw `green-500`/`red-500` to the `success`/`destructive` tokens.

**Deleted:** `SettingsCard.tsx`, `SettingsField.tsx`, `SettingsSection.tsx`, and their exports from `settings/index.ts`.

### 4.2 Quiet controls (`frontend/components/ui/`)

`Input`, `Textarea` and `SelectTrigger` gain `variant?: 'default' | 'quiet'`, via a cva in each file. `default` is unchanged.

`quiet`:
- `border-transparent bg-transparent shadow-none hover:bg-muted/60 h-8 px-2 text-[13px]`;
- focus keeps the file's existing focus ring (`focus-visible:ring-2` on `Input`/`Textarea`, `focus:ring-2` on `SelectTrigger`) and adds a `bg-background` fill in the same focus state;
- `aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive`;
- `disabled:hover:bg-transparent`;
- the textarea keeps `min-h` and drops `h-8`;
- the select trigger keeps its chevron.

`Switch` needs no variant: it has no border.

Read-only values, such as Profile's email, render as plain text in the row (`text-[13px]`), not as a disabled input.

### 4.3 Surface mapping (approved as Section 2; completed in the written review)

| Surface | Becomes |
|---|---|
| Basic info | Rows: Project name, Description (textarea), Review type (select). The Review type `hint` is the selected type's description. For a predictive-model review, the PICOTS notice box is removed and its sentence is appended to that hint; the "PICOTS" badge already shows in the selected value. |
| Review details | Two groups: *General* (Review title, Condition studied, Review context, Review rationale) and *Search strategy* (one monospace textarea row). |
| Review question | "Send to the AI" is a switch row (its hint line becomes the row `hint`). "What the AI is sent" stays a full-width disclosure; its preview block keeps the muted fill and drops its border. Each PICOTS slot is a row whose label is the server's wording, with a quiet description textarea (`align="start"`). The timing slot's help tooltip becomes that row's `hint`. Where a slot shows criteria, the inclusion/exclusion `TagInput`s sit under the description in the value column, with their small "(optional)" labels and no separator. The non-manager view keeps its "managers only" line and preview. The sticky dirty-only Save/Cancel footer and the discard guard from sub-project 2 are unchanged. |
| AI engine | Rows: Project default (select), Mode (select), Lock members (switch, managers only; "Managers are never bound" becomes its `hint`). Non-managers see plain-text values. *Shared keys* group (managers only): a flush list (label · provider · serves badge · remove `IconButton`) with a ghost "Add shared key". The add form opens as rows under the list (Provider, Label, Key) with a primary Save and a ghost Cancel, with no bordered box. |
| Team | *Invite* row: email input, role select and a primary Add. "The user must be registered" becomes the row's `hint`, and each role's description shows as a muted second line in the role select's items. *Members* group: flush list rows (avatar · name/email · role badge · edit/remove `IconButton`s revealed on hover or focus, always visible below `sm`), with no separators. The inline role editor keeps its select (quiet) and save/cancel `IconButton`s. An empty member list is one muted line. *Roles* group (its old description becomes the title `hint`): a compact two-column list. |
| Review consensus | Page intro line: "These settings only affect articles started from now on" (the callout's title; its body sentence is deleted). *Project default* group: a *Current* row (muted value "System default (1 reviewer, unanimous)", replacing the dashed box), shown only while the project has no default of its own; a Rule select row and, for the arbitrator rule, an Arbitrator row (an empty eligible list becomes a muted line in its value cell; "arbitrator required" is the row `error`). "Save project default" (primary) and "Reset to system default" (ghost, when customized) sit under the value column. *Manager review visibility*: the shared `ManagerReviewVisibilityToggle` renders unchanged as the full-width body of an untitled group. It is shared with QA Configuration, which is out of scope, so it keeps its own label and hint line there and here. *Per-template overrides* group: a flush list of rows (chevron · name · framework · Inherits/Overridden badge) with a hover fill. An expanded row shows the Rule/Arbitrator rows beneath it with "Remove override" (ghost) and Save (primary) under the value column, with no border box and no inner rule. |
| Advanced | Untitled first group: Keywords (`TagInput`, `align="start"`). *Eligibility* group: Inclusion criteria and Exclusion criteria (`TagInput`), Additional notes (textarea). *Study design* group: Included study types (`TagInput`), Design notes (textarea). *PDF parsing* group: a High-quality parsing switch row whose `hint` is the existing key-present or needs-key sentence (`HighQualityParsingToggle` renders the row). *Danger zone* group (`tone="danger"`): a Delete project row whose `hint` is the existing warning, with the existing destructive `sm` button and its `AlertDialog`. |
| Profile | Rows: Picture (avatar + muted "Upload coming soon"), Email (plain read-only text, with "Managed by the authentication system" as `hint`), Full name (quiet input). "Save changes" (primary, `sm`) sits under the value column. |
| Security | The password rules become the page intro line; the lock callout and the duplicate new-password hint are deleted. Rows: New password (strength meter under the input), Confirm new password (its hint becomes the row `hint`; the match line stays under the input). Both are quiet inputs; the icon-only reveal toggles become `IconButton`s. "Change password" (primary, `sm`) sits under the value column. |
| Settings → Integrations | *AI connections* group: a flush list (label · provider · host tag · status badge · Verify/Remove `IconButton`s). Empty state is one muted line plus a ghost "Add connection". The add form is rows: Provider (the "prumo provides a key" note as `hint`; the docs link under the select), Label, Host (only when the provider needs one; its note as `hint`) and Key, with a primary Save and a ghost Cancel. *Zotero* group, connected: rows User ID (masked, with the Connected badge inline), Library type, and Last sync when present (fixing the run-together labels), plus ghost "Test connection" and "Disconnect" (keeping its `AlertDialog`) under the value column. Not connected: one muted intro line with the "Generate API key" link, then rows User ID (hint; the "How to find" link under the input), API key (quiet password input with its Show/Hide button; the permissions note as `hint`) and Library type, plus a primary Connect. |
| Article edit panel | **Section headings** (`articles/sections/*`): `SettingsGroup` titles. **Authors:** flush rows (drag handle · last-name quiet input · first-name quiet input), or one quiet name input across both columns in single-name mode. The row actions (switch mode, remove, add below) are `IconButton`s in a horizontal strip revealed on hover or focus, always visible below `sm`. The uppercase column labels are removed: the placeholders carry the meaning, and each input gets an `aria-label` from the old label keys. The block header is normal-case "Authors" with a ghost "Add author". **Files:** no `Card` and no second heading. File rows are flush with a hover fill. A staged (not yet uploaded) row keeps its existing muted "Not uploaded yet" marker and loses the dashed border. A ghost "Add files" follows the list. The empty state is one muted line plus that button. **Keywords:** a label/value row on the article label column (`w-32`, right-aligned, "Keywords"). The value is the keyword list, each with a remove `IconButton` revealed on hover, followed by a quiet draft input. The bordered box, the count header strip and the hint line below go away, and the hint becomes the ⓘ `hint`. **Cancel:** `ghost`, with the `h-8` overrides on both buttons removed. |

`ProjectSettings.tsx`'s `<main>` inner wrapper replaces `max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8` with the view's `p-2` inset, matching the frontend-ux §6 row set in sub-project 2. `pages/UserSettings.tsx` drops its `max-w-3xl lg:max-w-4xl` wrapper, since `SettingsPage` owns the width, and keeps its own gutter: it is not a project view.

### 4.4 Copy

- Field hint strings are reused as `hint` props, with the same keys.
- Section and card description keys that only restated a heading are deleted in the same change, and `check_copy_keys.py` shrinks. The same goes for keys whose element is removed (e.g. the consensus banner body, `projectDefaultUsingSystem`, `articleFiles`, `articleFilesDesc`, `keywordsHeaderOne`/`Plural`, `picotsHelpAria`), each only after a grep proves no other reference.
- Callout copy that becomes an intro line keeps its key.
- New keys are only: `common.fieldHintAria` ("About {{label}}", the ⓘ trigger's name), `consensus.currentDefaultLabel` ("Current") and `consensus.currentSystemDefault` ("System default (1 reviewer, unanimous)").

## 5. States

- Loading, empty and error states keep their current behaviour and move into rows or lists. Skeletons match row height (`h-8`).
- Read-only (non-manager) settings render values as plain text in the value column wherever a section already disables its inputs for non-managers. The review question keeps sub-project 2's preview.

## 6. Enforcement

`scripts/fitness/check_ui_primitives.py` gains a rule, `settings-frame`:
- no import of `@/components/ui/card` or `@/components/ui/alert` in `frontend/components/project/settings/`, `frontend/components/user/`, `frontend/components/articles/sections/`, `frontend/components/project/PicotsPane.tsx`, or `frontend/components/articles/{ArticleFilesSection,ArticleAuthorsField,ArticleKeywordsField}.tsx`;
- no import of `SettingsCard`, `SettingsField` or `SettingsSection` anywhere, since the files are deleted.

The rule starts at zero findings.

## 7. Testing and verification

**Vitest:**
- `SettingsRow`:
  - label ↔ control association via `htmlFor`;
  - `hint` renders an ⓘ `IconButton` named "About {label}" whose tooltip text equals the hint, and the control's `aria-describedby` includes the hint id;
  - with a react-hook-form `FormControl` child, `aria-describedby` holds both the hint id and the form message id (merge, not overwrite);
  - `error` is appended to `aria-describedby` and rendered;
  - the grid classes stack below `sm` (class contract — jsdom sees no layout).
- `SettingsGroup`: the hairline classes are suppressed for a first child; `tone="danger"` colours the title.
- `Input`/`Textarea`/`SelectTrigger` `quiet`: the class contract (transparent border, hover fill, focus ring kept) and `aria-invalid` ring.
- `TagInput`: the add control is named by its placeholder.
- Every migrated section: its existing tests stay green unchanged in behaviour. Tests that asserted on removed card titles or descriptions are updated to assert the same information via row labels, intro lines or hint tooltips, never deleted blind.
- Zotero: a test pins that label and value render as separate row cells (a regression test for the run-together text).
- Authors: each name input has an accessible name.

**Gates:** `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh` (copy keys, UI primitives with the new rule, button scale, file size).

**Browser, one session (`design-review`; the density before/after recipe):** every in-scope page at 1280 and 390 px, before and after.
- Measure: vertical pixels per field (page height ÷ field count), the number of elements with a visible border per page, the content column width at 1920, and no horizontal scroll at 390.
- Capture: screenshots of each page, dark mode for one settings page and the article panel, hover and focus states of a quiet input, and the ⓘ tooltip open.

## 8. Risks

- **Affordance loss on borderless inputs.** The hover fill plus a visible focus ring are the affordance, and empty inputs keep their placeholder. The browser pass checks an empty required field at rest in light and dark mode.
- **`aria-describedby` wiring** through arbitrary children, including `FormControl`'s own ids. Solved once in `SettingsRow`; its tests pin both cases.
- **A shared control stays framed differently.** `ManagerReviewVisibilityToggle` keeps its own label and hint line on Review consensus, because changing it would restyle QA Configuration, which is out of scope. It is one visible hint line, not a frame.
- **Wide diff across ~25 files.** Mitigated by task order: primitives and quiet variant first, then one surface family per task (project settings, user settings + integrations, article panel), each with its tests green before the next.
- **File-size ratchet.** No in-scope file is near the 800-line cap except `ArticleForm.tsx` (808 lines, baselined at 1213), which this spec does not grow.

## 9. Follow-ups

- The `useTemplateFocus` extraction for `TemplateConfigGridPanel.tsx` (a separate task chip from sub-project 2).
- The prose measure on QA Configuration's long tool descriptions (measured 1574px wide at 1920 in sub-project 2), if the user wants a readable column there too.
- `ManagerReviewVisibilityToggle` in the flat-row form on both surfaces, if QA Configuration gets its own density pass.
