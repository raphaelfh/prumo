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

## 1. Problem

Survey of `dev` plus PR #896 at 1280 and 390 px, done in one browser session, with a read-only code inventory.

| Surface | Noise |
|---|---|
| Every settings page | **Three heading layers, each with its own description.** (1) The page header ("Project settings · Members and permissions"). (2) The section heading and its description (`SettingsSection`). (3) A title and description on every group card (`SettingsCard`). Nearly every field also has a hint line (`SettingsField`). |
| Project → Configuration | **Nested frames.** A bordered box inside a `SettingsCard` (`BasicInfoSection.tsx:100`, `AiEngineSection.tsx:263`), a bordered callout box and a dashed empty-state box on Review consensus, and a card per group everywhere. The page gutter is `px-6 py-6 lg:px-8 lg:py-8`, and content is unbounded (a 1352px-wide column at 1920). |
| Team | "Add member", "Current members" and "Roles and permissions" are three cards. The two lines of hint text under the invite form duplicate the role description. |
| Security | A lock callout box repeats the password rules, which the field hint then says a third time. |
| Settings → Integrations | **Zotero.** Label and value run together (`ZoteroIntegrationSection.tsx:97-108`: "User ID130...353", "Library typeuser"). A bordered status box and a bordered credentials box sit in one section. **Buttons.** Test connection, Disconnect and Add connection are `variant="outline"` in row positions, where frontend-ux says ghost. |
| Article edit panel | **Authors.** One bordered box per author row, with uppercase LAST NAME / FIRST NAME micro-labels (`ArticleAuthorsField.tsx:74-121`). **Files.** The only panel section wrapped in a `Card`, holding bordered or dashed file rows (`ArticleFilesSection.tsx:72,99,135`). **Chrome.** Cancel is `outline` (`ArticleFormHeader.tsx:36`). |
| Form controls | `Input`, `Textarea` and `SelectTrigger` are `border border-input h-10` at rest everywhere; "borderless" has no shared expression. |

`SettingsCard` is used in 8 files (`project/settings/{AdvancedSettingsSection,AiEngineSection,BasicInfoSection,ReviewConsensusSection,ReviewDetailsSection,TeamMembersSection}.tsx`, `user/{ProfileSection,SecuritySection}.tsx`).

`SettingsField` is used in `project/settings/{BasicInfoSection,ReviewDetailsSection,ConsensusConfigForm}.tsx`, `user/{ProfileSection,SecuritySection}.tsx` and `articles/ArticleKeywordsField.tsx`.

`SettingsSection` is used by the settings sections above, `user/IntegrationsSection.tsx`, `project/settings/ReviewQuestionSection.tsx`, and all five `articles/sections/*.tsx` headings.

## 2. Goals and non-goals

Goals:

1. One heading layer per settings page, and no card, callout box or nested frame on any in-scope surface.
2. Settings fields read as a label/value grid with borderless, always-editable controls.
3. Guidance moves out of the way: field hints become ⓘ tooltips, and each section keeps at most one intro line.
4. Settings content sits in a readable column on large screens.
5. `SettingsCard` and `SettingsField` are deleted, and a fitness gate keeps cards from coming back on these surfaces.

Non-goals:

- **Behaviour or data changes.** Save models stay as they are: the batched project-settings save, the review question's section-owned save, save-on-change for the AI engine, and immediate commits in the article panel. So do endpoints, permissions and copy meaning.
- **Other screens.** The extraction/QA worklists, the template grid, the run views, dialogs and headers are untouched (sub-projects 1 and 2 own those).
- **The article panel's field rows.** They keep their click-to-edit `ArticleFieldRow` behaviour. Only the authors block, the files section, the keywords label alignment and the Cancel button change there.
- **Inline section creation.** That is a separate follow-up spec, recorded in sub-project 2 §9.

## 3. Decisions (brainstorming, 2026-09-13)

| Decision | Choice | Why |
|---|---|---|
| Border principle | **Fully flat label grid**: no cards on in-scope screens; forms are two-column label/value rows; sections are separated by a heading and whitespace | The user picked the most minimal option, a Linear-style settings layout. |
| Scope | Article edit panel, Settings → Integrations, every Project → Configuration section, user Profile and Security | Gives every `SettingsCard` / `SettingsField` caller a migration, so both components can be deleted. |
| Helper text | Field hints go into an ⓘ tooltip beside the label; a section keeps at most one short intro line; descriptions that restate the heading are deleted; placeholders stay as the inline example | Less text at rest. The guidance stays one hover away, through the shared tooltip from sub-project 1. |
| Edit model | Borderless inputs that are always editable: hover fill at rest, focus ring while typing; selects, textareas and switches match | One click to edit; keeps the page's existing save models and tab order. |
| Architecture | New `SettingsRow` + `SettingsGroup` (+ `SettingsPage`) primitives; a `quiet` variant on `Input`/`Textarea`/`SelectTrigger`; migrate every caller; delete `SettingsCard` and `SettingsField` | Honest names and one place to change the look. Restyling the old components in place would leave a `Card` component that renders no card. |
| Page structure | One heading layer; groups separated by a single hairline; full-width flush lists (members, keys, connections, overrides); ghost row and chrome actions; a group's single primary action is filled, `sm`, under the value column | Approved as Section 1. |
| Content width | A readable column, `max-w-3xl` (~720px), left-aligned inside the view's `p-2` inset | Approved: inputs and text stay a readable length at 1920. |

## 4. Design

### 4.1 Primitives (`frontend/components/settings/`)

**`SettingsPage`** is the one wrapper per settings page body.
- Props: `intro?: string`, `children`.
- Renders an optional intro line (`text-[13px] text-muted-foreground`), then the children, inside `mx-0 w-full max-w-3xl`.
- The page title stays the existing `PageHeader`: the section name for project settings, the tab name for user settings. Section headings rendered by the old `SettingsSection` are deleted, so there is exactly one heading layer.

**`SettingsGroup`**
- Props: `title?: string`, `hint?: string` (ⓘ tooltip next to the title), `tone?: 'default' | 'danger'`, `children`.
- The title is `text-[13px] font-medium` (`text-destructive` for `danger`). It has no description prop.
- Consecutive groups are separated by one `border-t border-border/40` hairline with `pt-4` and `mt-4`, drawn by the group that follows. The first group draws none: one hairline per boundary (frontend-ux §6).
- The body stacks `SettingsRow`s or full-width content (lists) with `space-y-1`.

**`SettingsRow`**
- Props: `label: string`, `htmlFor?: string`, `hint?: string`, `required?: boolean`, `error?: string`, `align?: 'center' | 'start'` (default `center`; `start` for textareas and tag lists), `children` (the control).
- Layout: `grid gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)]`.
- The label cell is right-aligned at `sm:` and above, `text-[13px] text-muted-foreground`, and carries `required` as a `*` in `text-destructive`.
- The hint is an ⓘ `IconButton`-sized trigger (`Info` icon, `size-3.5`) that opens the shared `Tooltip`. Its text also reaches the control through `aria-describedby`: the row renders a visually hidden `<span id>` with the hint and passes the id to the control via a `describedById` render-prop or `cloneElement`. The implementation plan picks one; both keep one text source.
- `error` renders under the control in `text-xs text-destructive` with its own id, appended to `aria-describedby`.
- Below `sm`, the label stacks above the control and aligns left.
- Rows are `py-1`, so there are no per-row hint lines.

**Deleted:** `SettingsCard.tsx`, `SettingsField.tsx`, `SettingsSection.tsx`, and their exports from `settings/index.ts`. `TagInput` stays.

### 4.2 Quiet controls (`frontend/components/ui/`)

`Input`, `Textarea` and `SelectTrigger` gain `variant?: 'default' | 'quiet'`, via a cva in each file. `default` is unchanged.

`quiet`:
- `border-transparent bg-transparent shadow-none hover:bg-muted/60 h-8 px-2 text-[13px]`;
- focus keeps the existing `focus-visible:ring-2 ring-ring` and adds `focus-visible:bg-background`;
- `aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive`;
- `disabled:hover:bg-transparent`;
- the textarea keeps `min-h` and drops `h-8`;
- the select trigger keeps its chevron.

`Switch` needs no variant: it has no border.

Read-only values, such as Profile's email, render as plain text in the row (`text-[13px]`), not as a disabled input.

### 4.3 Surface mapping (approved as Section 2)

| Surface | Becomes |
|---|---|
| Basic info | Rows: Project name, Description (textarea), Review type (select). The nested explanation box under Review type becomes that row's `hint`. |
| Review details | Two groups: *General* (Review title, Condition studied, Review context, Review rationale) and *Search strategy* (one monospace textarea row). |
| Review question | "Send to the AI" is a switch row. Each PICOTS part is a row whose label is the server's wording, with inclusion/exclusion tags under the value (`align="start"`). "What the AI is sent" stays a full-width disclosure. The sticky dirty-only Save/Cancel footer and the discard guard from sub-project 2 are unchanged. |
| AI engine | Rows: Project default (select), Mode (select), Lock members (switch; "Managers are never bound" becomes its `hint`). *Shared keys* group: a flush list with a ghost "Add shared key"; the add form opens as rows under the list, with no bordered box. |
| Team | *Invite* row: email input, role select and a primary Add; "The user must be registered" becomes the row's `hint`, and the role description shows in the role select's items. *Members* group: flush list rows (avatar · name/email · role badge · edit/remove `IconButton`s revealed on hover, always visible below `sm`). *Roles* group (`hint` on the title): a compact two-column list. |
| Review consensus | The "only affects articles started from now on" callout becomes the page intro line. *Project default* group: a *Current* row (muted value, "System default (1 reviewer, unanimous)", replacing the dashed box), a Rule select row, and "Save project default" under the value column. *Manager review visibility*: a switch row with `hint`. *Per-template overrides*: a flush list. |
| Advanced | Rows: Keywords, Inclusion criteria, Exclusion criteria and Included study types (TagInput in the value column, `align="start"`), plus Additional notes and Design notes (textareas). *Danger zone* group (`tone="danger"`): a Delete project row with the existing destructive `sm` button and its existing `AlertDialog`. |
| Profile | Rows: Picture (avatar + muted "Upload coming soon"), Email (plain read-only text, with "Managed by the authentication system" as `hint`), Full name (quiet input). "Save changes" sits under the value column. |
| Security | The password rules become the page intro line; the lock callout and the duplicate hint are deleted. Rows: New password, Confirm new password (quiet inputs keep the reveal toggle). "Change password" sits under the value column. |
| Settings → Integrations | *AI connections*: a flush list (provider · masked key · status · ghost Verify/Remove). Empty state is one muted line plus a ghost "Add connection"; the add form is rows (Provider, Key, Host only when the provider needs one) with a primary Add and a ghost Cancel. *Zotero* connected: rows User ID, Library type, Last sync (fixing the run-together labels), plus ghost "Test connection" and "Disconnect". Not connected: the credential rows plus a primary Connect. |
| Article edit panel | **Authors:** flush rows (drag handle · last-name quiet input · first-name quiet input · remove `IconButton` on hover); the uppercase column labels are removed and the placeholders carry the meaning; the section header is normal-case "Authors" with a ghost "Add author". **Files:** no `Card`; file rows are flush with a hover fill; a staged (not yet uploaded) row shows a small muted "Pending" marker instead of a dashed border. **Keywords:** label aligned to the article label column. **Cancel:** `ghost`. **Section headings** (`articles/sections/*`): `SettingsGroup` titles. |

`ProjectSettings.tsx` and `pages/UserSettings.tsx` wrap their section bodies in `SettingsPage`. Project settings' `<main>` inner wrapper drops `px-6 py-6 lg:px-8 lg:py-8` for the view's `p-2` inset, matching the frontend-ux §6 row set in sub-project 2.

### 4.4 Copy

- Field hint strings are reused as `hint` props, with the same keys.
- Section and card description keys that only restated a heading are deleted in the same change, and `check_copy_keys.py` shrinks.
- Callout copy that becomes an intro line keeps its key.
- New keys are only: `settings.currentDefaultLabel` (the Consensus *Current* row) and `files.pendingMarker` (the article panel's staged-file marker), or the closest existing namespace the plan finds.

## 5. States

- Loading, empty and error states keep their current behaviour and move into rows or lists. Skeletons match row height (`h-8`).
- Read-only (non-manager) settings render values as plain text in the value column wherever a section already disables its inputs for non-managers. The review question keeps sub-project 2's preview.

## 6. Enforcement

`scripts/fitness/check_ui_primitives.py` gains a rule, `settings-card`:
- no import of `@/components/ui/card` in `frontend/components/project/settings/`, `frontend/components/user/`, `frontend/components/articles/ArticleFilesSection.tsx` or `frontend/components/articles/ArticleAuthorsField.tsx`;
- no import of `SettingsCard`/`SettingsField` anywhere, since both files are deleted.

The rule starts at zero findings.

## 7. Testing and verification

**Vitest:**
- `SettingsRow`:
  - label ↔ control association via `htmlFor`;
  - `hint` renders an ⓘ trigger whose tooltip text equals the hint, and the control's `aria-describedby` includes the hint id;
  - `error` is appended to `aria-describedby` and rendered;
  - the grid classes stack below `sm` (class contract — jsdom sees no layout).
- `SettingsGroup`: the hairline is drawn only from the second group on; `tone="danger"` colours the title.
- `Input`/`Textarea`/`SelectTrigger` `quiet`: the class contract (transparent border, hover fill, focus ring kept) and `aria-invalid` ring.
- Every migrated section: its existing tests stay green unchanged in behaviour. Tests that asserted on removed card titles or descriptions are updated to assert the same information via row labels, intro lines or hint tooltips, never deleted blind.
- Zotero: a test pins that label and value render as separate row cells (a regression test for the run-together text).

**Gates:** `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh` (copy keys, UI primitives with the new rule, button scale, file size).

**Browser, one session (`design-review`; the density before/after recipe):** every in-scope page at 1280 and 390 px, before and after.
- Measure: vertical pixels per field (page height ÷ field count), the number of elements with a visible border per page, the content column width at 1920, and no horizontal scroll at 390.
- Capture: screenshots of each page, dark mode for one settings page and the article panel, hover and focus states of a quiet input, and the ⓘ tooltip open.

## 8. Risks

- **Affordance loss on borderless inputs.** The hover fill plus a visible focus ring are the affordance, and empty inputs keep their placeholder. The browser pass checks an empty required field at rest in light and dark mode.
- **`aria-describedby` wiring** through arbitrary children. Solved once in `SettingsRow`; its test pins it.
- **Wide diff across ~20 files.** Mitigated by task order: primitives and quiet variant first, then one surface family per task (project settings, user settings + integrations, article panel), each with its tests green before the next.
- **File-size ratchet.** No in-scope file is near the 800-line cap except `ArticleForm.tsx` (baselined at 1213), which this spec does not grow.

## 9. Follow-ups

- The `useTemplateFocus` extraction for `TemplateConfigGridPanel.tsx` (a separate task chip from sub-project 2).
- The prose measure on QA Configuration's long tool descriptions (measured 1574px wide at 1920 in sub-project 2), if the user wants a readable column there too.
