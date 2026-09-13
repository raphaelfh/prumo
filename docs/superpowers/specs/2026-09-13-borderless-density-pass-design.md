---
status: approved
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Borderless density pass — flat label grid for settings and the article panel

Sub-project 3 of 3 in the "less friction, fewer elements" train.

- Sub-project 1 (interaction primitives, `docs/superpowers/specs/2026-09-12-interaction-primitives-design.md`, PR #887) set the cursor, tooltip, `IconButton` and overlay frame.
- Sub-project 2 (configuration as views, `docs/superpowers/specs/2026-09-13-configuration-as-views-design.md`, PR #896) moved configuration out of popups and gave every project tab the Articles `p-2` gutter; its §4.5 left the Project settings gutter to this spec.

This spec removes the frames, redundant text and bordered controls that remain on the settings pages and the article edit panel.

Design decisions were made with the user in brainstorming on 2026-09-13 (sections 1–3 approved). The written document then went through a self-review and a four-lens adversarial review against the tree; the user settled the decisions that review reopened (marked *written review* in §3) and approved this document on 2026-09-13.

File references were verified on PR #896's head `538aafb7`; #896 merged to `dev` as `b95a5e10` on 2026-09-13, and the implementation builds on `dev`.

## 1. Problem

Survey of `dev` plus PR #896 at 1280 and 390 px, done in one browser session, with a read-only code inventory.

| Surface | Noise |
|---|---|
| Every settings page | **Three heading layers, each with its own description.** (1) The `PageHeader` strip: "Project settings · Members and permissions" on project settings (title plus the active section's description); the tab's description alone on user settings, where the breadcrumb names the page. (2) The section heading and its description (`SettingsSection`, an `<h2>`). (3) A title and description on every group card (`SettingsCard`). Nearly every field also has a hint line (`SettingsField`). |
| Project → Configuration | **Nested frames.** A bordered box inside a `SettingsCard` (`BasicInfoSection.tsx:100`, `AiEngineSection.tsx:263`), a callout box and a dashed empty-state box on Review consensus (`ReviewConsensusSection.tsx:143,166`), a bordered box per template override (`TemplateConsensusOverride.tsx:115`), and a card per group everywhere. The page gutter is `max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8` (`ProjectSettings.tsx:173`), and content is unbounded (a 1352px-wide column at 1920). |
| Team | "Add member", "Current members" and "Roles and permissions" are three cards. Under the invite form, one hint line repeats the selected role's description from the Roles card. The empty member list is a callout box. |
| Security | A lock callout box states the password rules, and the new-password hint states them a second time. |
| Settings → Integrations | **Zotero** (`project/settings/ZoteroIntegrationSection.tsx`, rendered by `user/IntegrationsSection.tsx`). Label and value run together (`:97-104`: "User ID130...353", "Library typeuser"). A bordered status box and a bordered credentials box sit in one section. **Buttons.** Test connection, Disconnect and Add connection are `variant="outline"` in row positions, where frontend-ux says ghost. |
| Article edit panel | **Authors.** One bordered box per author row, with uppercase LAST NAME / FIRST NAME micro-labels that are not associated with their inputs (`ArticleAuthorsField.tsx:74-121`). **Files.** The only panel section wrapped in a `Card`, with a second heading ("Article files" under the section's "Files") and bordered or dashed file rows (`ArticleFilesSection.tsx:72,99,135`). **Keywords.** A bordered box with its own header strip and a divided list, followed by a hint line (`ArticleKeywordsField.tsx:56-57`, `sections/AdditionalInfoSection.tsx:36`). **Chrome.** Cancel is `outline` (`ArticleFormHeader.tsx:36`). |
| Form controls | `Input`, `Textarea` and `SelectTrigger` are `border border-input h-10` at rest everywhere; "borderless" has no shared expression. `TagInput` adds bordered chips and an unlabelled icon-only `outline` add button. |

`SettingsCard` is used in 8 files (`project/settings/{AdvancedSettingsSection,AiEngineSection,BasicInfoSection,ReviewConsensusSection,ReviewDetailsSection,TeamMembersSection}.tsx`, `user/{ProfileSection,SecuritySection}.tsx`).

`SettingsField` is used in `project/settings/{BasicInfoSection,ReviewDetailsSection,ConsensusConfigForm}.tsx` and `user/{ProfileSection,SecuritySection}.tsx`.

`SettingsSection` is used by the settings sections above, `user/IntegrationsSection.tsx`, `project/settings/ReviewQuestionSection.tsx`, and all five `articles/sections/*.tsx` headings.

`@/components/ui/alert` callouts are used in `project/settings/{ReviewConsensusSection,ConsensusConfigForm,TeamMembersSection}.tsx` and `user/SecuritySection.tsx`.

## 2. Goals and non-goals

Goals:

1. No card, callout box or nested frame on any in-scope surface, and one heading layer inside each settings page body (group titles) under the unchanged `PageHeader` strip.
2. Settings fields read as a label/value grid with borderless, always-editable controls.
3. Guidance moves out of the way: field hints move behind an ⓘ trigger (tooltip on hover or focus, popover on tap), and each section keeps at most one intro line. Text that explains why a control is disabled stays visible.
4. Settings content sits in a readable column on large screens.
5. `SettingsCard`, `SettingsField` and `SettingsSection` are deleted and retired, and a fitness gate keeps card imports, callout imports and raw bordered frames from coming back on these surfaces.

Non-goals:

- **Behaviour or data changes.** Save models stay as they are: the batched project-settings save, the review question's section-owned save, save-on-change for the AI engine and the visibility and parsing switches, and immediate commits in the article panel. So do endpoints, permissions and non-manager capabilities. Copy meaning is kept; the only copy text edits are the two corrections listed in §4.4.
- **Other screens.** The extraction/QA worklists, QA Configuration, the template grid, the run views, dialogs and headers are untouched (sub-projects 1 and 2 own those). Shared components keep their current look on those screens.
- **The article panel's field rows.** They keep their click-to-edit `ArticleFieldRow` behaviour. Only the section headings, the authors block, the files section, the keywords block and the Cancel button change there.
- **Inline section creation.** That is a separate follow-up spec, recorded in sub-project 2 §9.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Border principle | **Fully flat label grid**: no cards on in-scope screens; forms are two-column label/value rows; sections are separated by a heading and whitespace | The user picked the most minimal option, a Linear-style settings layout. |
| Scope | Article edit panel, Settings → Integrations, every Project → Configuration section, user Profile and Security | Gives every `SettingsCard` / `SettingsField` / `SettingsSection` caller a migration, so all three components can be deleted. |
| Helper text | Field hints move behind an ⓘ trigger beside the label; a section keeps at most one short intro line; descriptions that restate a heading or a label are deleted; placeholders stay as the inline example | Less text at rest. Every description key has an explicit fate in §4.4. |
| Hints on touch (*written review*) | The ⓘ opens a tooltip on hover or focus and a popover on tap (coarse pointer); the same text also reaches the control through `aria-describedby` | Radix tooltips do not open on tap. For settings fields this deliberately overrides sub-project 1's "tooltips are the last resort after inline help". |
| Edit model | Borderless inputs that are always editable: hover fill at rest, focus ring while typing; selects, textareas and switches match | One click to edit; keeps the page's save models. The control tab order is unchanged; a hinted row adds one ⓘ tab stop before its control. |
| Architecture | New `SettingsPage`, `SettingsGroup`, `SettingsRow`, `SettingsActions` and a shared `FieldHint`; a `quiet` variant on `Input`/`Textarea`/`SelectTrigger` in `ui/*`; migrate every caller; delete `SettingsCard`, `SettingsField` and `SettingsSection` | Honest names and one place to change the look. The `ui/*` variants and the `FormControl` merge fix are recorded as deliberate upstream divergences in the ui-styling skill, with guard tests. |
| Page structure | Groups separated by a single hairline; full-width flush lists (members, keys, connections, overrides); ghost row and chrome actions; a group's primary action is filled, `sm`, under the value column | Approved as Section 1. |
| Content width | A readable column, `max-w-3xl` (48rem, 768px), left-aligned inside the view's `p-2` inset — on project settings and user settings alike | Approved; `.claude/rules/frontend.md` makes `p-2` the view-owned gutter. |
| Manager review visibility (*written review*) | A switch row with a hint, driven by a hook extracted from `ManagerReviewVisibilityToggle`; the component keeps its markup for QA Configuration | Honours the approved row without restyling an out-of-scope screen. |
| Keywords (*written review*) | The whole bordered keywords block is flattened, not only its label aligned | Otherwise the panel keeps one bordered frame, against goal 1. |
| Advanced grouping (*written review*) | One flat group of rows (with the previously omitted parsing switch), then Danger zone | Fewest headings and hairlines, as approved. |
| Delivery | Two PRs from one plan: PR 1 primitives, controls, project and user settings, Integrations and the settings gate; PR 2 the article panel, `SettingsSection` retirement and the article paths of the gate | Smaller reviews and one armed PR at a time on the merge train. |

## 4. Design

### 4.1 Primitives

All in `frontend/components/settings/` unless noted.

**`SettingsPage`** is the one wrapper per settings section body. Each section component (`BasicInfoSection`, `SecuritySection`, `IntegrationsSection`, …) renders its own, because the intro belongs to the section; `ProjectSettings.tsx` and `pages/UserSettings.tsx` own only the gutter.

- Props: `intro?: ReactNode`, `children`.
- Renders `<div class="mx-0 w-full max-w-3xl">`, then the optional intro `<p class="text-[13px] text-muted-foreground">`, then a body `<div class="@container/settings">` holding the children.
- **The body's direct children are `SettingsGroup`s only.** Loading, error and empty states render inside a group. A component that renders a group (e.g. `AiConnectionsSection`) returns the `SettingsGroup` as its root, with no wrapper element and no `space-y-*` parent in between.
- `PageHeader` is unchanged. Old `SettingsSection` headings are deleted.

**`SettingsGroup`**

- Props: `title?: string`, `hint?: string`, `tone?: 'default' | 'danger'`, `children`.
- The title renders as `<h2 class="text-[13px] font-medium">` (`text-destructive` for `danger`), followed by a `FieldHint` when `hint` is set. There is no description prop. `ArticleFormChrome.test.tsx:57-69` (one `H2` per article section) and `e2e/flows/settings-connections.e2e.ts:15` (heading "AI connections") depend on the `<h2>`.
- Hairline: `border-t border-border/40 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0`. Because the settings body holds only groups, this draws exactly one hairline per boundary (frontend-ux §6). In the article panel each group is the only child of its `<section>`, so the panel draws none and keeps its existing `space-y-8` (`ArticleForm.tsx:734`).
- The body stacks its children with `space-y-1`. Children are `SettingsRow`, `SettingsActions`, lists or a single muted line; a component that renders several rows returns a fragment, so the rows stay direct children.

**`SettingsRow`**

- Props: `label: string`, `htmlFor?: string`, `hint?: string`, `required?: boolean`, `error?: string`, `align?: 'center' | 'start'` (default `center`; `start` for textareas, tag lists and multi-line value cells), `children: ReactNode | ((a11y: {describedBy: string | undefined}) => ReactNode)`.
- Layout: `grid gap-x-3 gap-y-1 py-1 @[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]`. It is a **container** query on the settings body, not a viewport breakpoint: the body sits beside a fixed 224px rail, so a viewport `sm:` would put the 11rem label column on a ~400px body. Below 36rem the label stacks above the control and aligns left.
- The label cell holds a `<label>` (`text-[13px] text-muted-foreground`, right-aligned in the two-column layout) carrying `required` as a `*` in `text-destructive`. The `FieldHint`, when present, is a **sibling** of the `<label>`, never inside it, so it does not leak into the control's accessible name.
- A row with a `hint` or `error` renders visually hidden text with ids (`${id}-hint`, `${id}-error`) and must use the **render-prop** form: it receives `describedBy` (the joined ids) and puts it on the control, or on `FormControl` in react-hook-form rows. `cloneElement` is not used: a row's child is often not the control (Security's input-plus-toggle wrapper, a Radix `Select` root).
- `error` renders under the control in `text-xs text-destructive`. react-hook-form rows keep `FormMessage` instead, placed inside the value cell.
- A row with no control (Profile's email) omits `htmlFor`; its hint is reachable through the `FieldHint` only.
- Content that must stay visible and is not a hint stays inside the value cell under the control: live feedback (Security's strength meter and match line), disabled reasons (the parsing needs-key sentence), validation messages and links (the provider docs link, Zotero's "How to find" link), since a tooltip or popover cannot be relied on for either.

**`SettingsActions`** places a group's actions under the value column: the same container-query grid as `SettingsRow` with an empty label cell, and the buttons `flex flex-wrap gap-2` in the value cell (primary `sm`, secondary `ghost sm`).

**`FieldHint`** (`frontend/components/patterns/FieldHint.tsx`, shared by settings rows, group titles and the article keywords row).

- Props: `label: string` (the field it explains), `hint: string`.
- Renders an `IconButton` (`size="icon-xs"`, `Info` icon) named `common.fieldHintAria` with `{{label}}` replaced (`t()` does no interpolation; use the `.replace` idiom of `ArticleKeywordsField.tsx:19`).
- Fine pointer: the `IconButton` tooltip shows the hint. Coarse pointer (`(pointer: coarse)`, read through a `useSyncExternalStore` media hook in the style of `hooks/use-mobile.tsx`): the tooltip is off and a tap toggles a `Popover` (`ui/popover.tsx`) with the same text.

**`TagInput`** stays, restyled for the flat grid.

- New props: `id?` and `aria-describedby?` for its input, so a row can label and describe it; `addLabel: string` names the add control.
- Its input is `quiet`; the add button becomes an `IconButton` labelled `addLabel` (callers pass `common.addToLabel` with the row label, e.g. "Add to Inclusion criteria").
- Chips and list items drop their `border`; the list tints move from raw `green-500`/`red-500` to the `success`/`destructive` tokens.

**Row actions revealed on hover** (members, keywords, authors) use `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`, so they appear on keyboard focus and are always visible on devices that cannot hover. A row in an edit state (Team's inline role editor) shows its controls without hover.

**Deleted:** `SettingsCard.tsx` and `SettingsField.tsx` (PR 1); `SettingsSection.tsx` (PR 2, when the article sections stop using it); and their exports from `settings/index.ts`.

### 4.2 Quiet controls and `FormControl` (`frontend/components/ui/`)

`Input`, `Textarea` and `SelectTrigger` gain `variant?: 'default' | 'quiet'`, via a cva in each file. `default` keeps today's classes.

`quiet`:

- `border-transparent bg-transparent shadow-none px-2 h-8 text-[13px] md:text-[13px]` — the explicit `md:` size is required, because the `Input` base carries `md:text-sm`, which compiles after `text-[13px]` and would render quiet inputs at 14px from 768px up;
- `hover:bg-muted/60 disabled:hover:bg-transparent`;
- focus: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background` — on `SelectTrigger` too, whose default uses `focus:`; a quiet trigger that keeps a `focus:` ring and fill would look stuck after every mouse pick, because Radix returns focus to it;
- invalid: `aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2` — `aria-*` utilities compile after `focus-visible`, so without the last class a focused invalid field would lose its 2px focus ring;
- the textarea keeps `min-h` and drops `h-8`; the select trigger keeps its chevron.

**Migration strips caller overrides.** Every migrated call site removes its `h-*`, `text-*` and `px-*` classes (`h-9 text-[13px]` in Basic info, Review details, Team, Profile, Security, Zotero and the AI forms; `h-7 text-[13px]` in `TagInput`), since `cn()` lets a caller's class beat the variant. Width classes stay.

**`FormControl` merges `aria-describedby`.** Today `FormControl` spreads its props after its own `aria-describedby` (`form.tsx:106-108`), and Radix `Slot` lets the child's props win, so any id passed in overwrites the description and message ids. `FormControl` now joins `formDescriptionId`, `formMessageId` (when there is an error) and an incoming `aria-describedby`, and the inner control never sets the attribute itself.

`Switch` needs no variant: it has no border.

The ui-styling skill records both changes as deliberate divergences from upstream shadcn, next to the button size scale, and its stale "Tailwind v3.4.17" line is corrected to the installed v4.

### 4.3 Surface mapping

Copy keys named here are exact; §4.4 lists every description's fate. "Hint" means a `FieldHint`.

**PR 1**

| Surface | Becomes |
|---|---|
| Basic info | One untitled group. Rows: Project name (required; hint `basicProjectNameHint`), Description (textarea; hint `basicDescriptionHint`), Review type (required select; hint = the selected type's description). The PICOTS notice box is deleted: its sentence is stale (PICOTS moved to Review question in #896), and the "PICOTS" badge already renders in the selected value. |
| Review details | Group *General information* (`reviewCardGeneralTitle`): Review title, Condition studied, Review context, Review rationale, each with its existing hint. Group *Search strategy* (`reviewCardSearchTitle`): one row, Strategy description (monospace textarea; hint `reviewStrategyHint`). |
| Review question | Intro: `aiContext.sectionDesc`. First untitled group: the "Send to the AI" switch row (hint `enabledHint`), then the "What the AI is sent" disclosure full width; its `previewHint` stays visible inside the open disclosure, and the preview block keeps its muted fill and drops its border. Second untitled group, replacing the `<Separator/>` at `PicotsPane.tsx:172`: one row per PICOTS slot from `PICOTSItemEditor`, whose label is the server's wording, with a quiet description textarea (`align="start"`). The timing slot's help button becomes the row hint (`timingHint`). Where a slot shows criteria, the value cell continues with the small "Inclusion criteria" / "Exclusion criteria" labels, a muted "Optional", and their `TagInput`s, with no separator. Loading and error states render inside the first group. The sticky dirty-only footer and the discard guard are unchanged, except that its Cancel becomes `ghost` (amending sub-project 2 §4.2, to match every other Cancel here). Non-managers: the intro, then one group with the `managerOnly` line and the preview. |
| AI engine | First untitled group, holding its own skeleton and retry line. Rows: Project default (select; hint `cardDescription`), Mode (select), Lock members (switch, managers only; hint `lockHint`). Non-managers see plain-text values, with the `lockedBadge` next to the default when members are locked (as today). Group *Shared keys* (`sharedTitle`; hint `sharedDescription`; managers only): a flush list (`role="list"`) of rows — label · provider · serves badge · remove `IconButton` — replacing the table, with a ghost "Add shared key". The add form is rows (Provider, Label, Key) and `SettingsActions` with Save (primary) and Cancel (ghost), with no bordered box. |
| Team | Untitled first group, one row *Add member* (`teamCardAddTitle`; hint `teamUserMustBeRegistered`): email quiet input, role quiet select (items show the role name only) and a primary Add at the end of the value cell — the row's own submit, so it stays inline and wraps below 36rem. The selected role's description line is deleted; the Roles group lists every description. Group *Current members* (`teamCardMembersTitle`): flush rows (avatar · name/email · role badge · edit/remove `IconButton`s revealed per §4.1), no separators; the inline role editor, its sole-manager tooltip and the `confirm()` on remove are unchanged. An empty list is one muted line (`teamNoMembersYet`). Group *Roles and permissions* (`teamCardRolesTitle`; hint `teamCardRolesDesc`): a compact two-column list. |
| Review consensus | Intro: `runsBannerTitle` (in `text-foreground`) followed by `runsBannerBody` in one paragraph. Group *Project default* (`projectDefaultTitle`; hint `projectDefaultDesc`): a *Current* row (`currentDefaultLabel`, muted value `currentSystemDefault`) shown only once the config has loaded without error and `scope_kind !== 'project'`; the Rule row (hint `ruleHint`); for the arbitrator rule, the Arbitrator row (required; hint `arbitratorHint`; with no eligible member its value cell is the muted `arbitratorNoEligibleMembers` line; otherwise a missing choice is the row `error` `arbitratorRequired`); `SettingsActions` with "Reset to system default" (ghost, when customized and the viewer is a manager) and "Save project default" (primary; disabled for non-managers, as today). Untitled group: a switch row (`managerVisibilityLabel`; hint `managerVisibilityHint`) driven by `useManagerReviewVisibility(projectId, kind, currentValue)`, extracted from `ManagerReviewVisibilityToggle`, which keeps its markup and QA Configuration keeps its look; not rendered while permissions load (as today). Group *Per-template overrides* (`templatesTitle`; hint `templatesDesc`): a flush list of row buttons (chevron · name · framework · Inherits/Overridden badge) with a hover fill; an expanded row shows the Rule/Arbitrator rows beneath it (from `ConsensusConfigForm`, returning a fragment) and `SettingsActions` with "Remove override" (ghost, when overridden and editable) and Save (primary, when editable), with no border box and no inner rule. Loading and empty states are muted lines inside the group. |
| Advanced | One untitled group. Rows: Review keywords (`advancedCardKeywordsTitle`; `TagInput`; hint `advancedCardKeywordsDesc`), Inclusion criteria and Exclusion criteria (`TagInput`), Additional notes (textarea), Included study types (`advancedCardStudyTypesTitle`; `TagInput`; hint `advancedCardStudyTypesDesc`), Design notes (textarea), High-quality PDF parsing (a switch row rendered by `HighQualityParsingToggle`; hint `highQualityHint`; when no LlamaCloud key is stored, the `highQualityNeedsKey` sentence stays visible under the disabled switch). Group *Danger zone* (`advancedCardDangerTitle`, `tone="danger"`): a Delete project row (`advancedDeleteProjectHeading`; hint `advancedDeleteProjectWarning`) holding the existing destructive `sm` button and its `AlertDialog`. Non-manager behaviour is unchanged. |
| Profile | One untitled group. Rows: Picture (avatar `h-8` + muted "Upload coming soon"), Email (plain read-only text, no `htmlFor`; hint `profileEmailHint`), Full name (quiet input; `FormItem` wraps the whole row, `FormControl` receives `describedBy`, `FormMessage` sits in the value cell; hint `profileFullNameHint`). `SettingsActions`: Save changes (primary `sm`). The loading branch renders the same rows with `h-8` skeletons. |
| Security | Intro: `securityAlertDescription`. One untitled group. Rows: New password and Confirm new password; each `FormItem` wraps its whole row. The value cell is a `flex items-center gap-1` of the quiet input and its reveal `IconButton` (a sibling, no longer absolutely positioned, so a 44px coarse-pointer target cannot overlap the input), then the strength meter or match line, then `FormMessage`. `SettingsActions`: Change password (primary `sm`). |
| Settings → Integrations | `IntegrationsSection` renders `SettingsPage` with the two components as direct body children; its `space-y-8` wrapper and `SettingsSection` headings are removed. `AiConnectionsSection` returns group *AI connections* (`integrationsTitle`; hint `integrationsDescription`): a flush list (label · provider · host tag · status badge · Verify/Remove `IconButton`s); the empty state is one muted line plus a ghost "Add connection"; the add form is rows — Provider (hint `globalKeyNote` when the provider has a global key; the docs link under the select), Label, Host (only when needed; hint `hostHint`), Key — and `SettingsActions` with Save (primary) and Cancel (ghost). `ZoteroIntegrationSection` returns group *Zotero* (`integrationsZoteroTitle`; hint `integrationsZoteroDescription`). Connected: rows User ID (masked, with the Connected badge inline), Library type, and Last sync when present; `SettingsActions` with ghost "Test connection" and ghost "Disconnect" (its `AlertDialog` kept). Not connected: a muted first line (`zoteroConfigureDesc` plus the "Generate API key" link), rows User ID (hint `zoteroUserIDHint`; the "How to find" link under the input), API key (quiet password input with its Show/Hide ghost button as a sibling; hint `zoteroApiKeyPermissions`) and Library type, and `SettingsActions` with Connect (primary `sm`). |

`ProjectSettings.tsx`'s `<main>` inner wrapper replaces `max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8` with `p-2`. `pages/UserSettings.tsx`'s `<main>` replaces `px-4 py-3 lg:px-6` with `p-2` and drops its `max-w-3xl lg:max-w-4xl` wrapper, since `SettingsPage` owns the width.

**PR 2**

| Surface | Becomes |
|---|---|
| Section headings | `articles/sections/*` render `SettingsGroup` titles (`<h2>`) in place of `SettingsSection`. |
| Authors | Flush rows (`role="listitem"` under the existing `role="list"`): drag handle · last-name quiet input · first-name quiet input, or one quiet name input across both columns in single-name mode. The row actions (switch mode, remove, add below) are `IconButton`s in a horizontal strip revealed per §4.1. The uppercase column labels are removed; the placeholders carry the meaning, and each input gets an `aria-label` from `authorLastName`, `authorFirstName` or `authorSingleField`. The block header stays: normal-case "Authors" with a ghost "Add author". |
| Files | No `Card` and no second heading. File rows are flush with a hover fill; View and Download stay visible ghost text buttons and the delete `IconButton` stays visible, as today. A staged row keeps its muted "Not uploaded yet" (`stagedPending`) and loses the dashed border. A ghost "Add files" follows the list. The empty state is one muted line (`noFilesAddedYet`) plus that button. The delete `AlertDialog` is unchanged. |
| Keywords | A label/value row on the article label column. `ArticleLabeledRow` is extracted from `ArticleFieldRow`'s outer layout (`flex items-baseline gap-2 py-1`, label `w-32 text-right text-muted-foreground`) with a `labelHint?` rendered through `FieldHint`; `ArticleFieldRow` composes it with unchanged behaviour and keeps its own visible `hint`. The Keywords row: label "Keywords" (`articles.keywords`; hint `keywordsFieldHint`); the value cell is `role="group"` labelled by the row label, holding the keyword list (each with a remove `IconButton` revealed per §4.1), then the quiet draft input (keeps its `aria-label` and its Enter/blur commit) and its clear-draft `IconButton`. The bordered box, the count header, the header "focus input" button and the hint line below are removed. |
| Cancel | `ghost`. The `h-8` overrides on Cancel and Save are removed, so both use the `sm` scale height (28px). |

### 4.4 Copy

Hints reuse their keys. Keys whose element is removed are deleted in the same PR, each only after a grep of `frontend/` (tests and e2e included) finds no other reference.

| Keys | Fate |
|---|---|
| `project.basicSectionTitle/Desc`, `basicCardIdentification/Desc`, `basicReviewTypeCardTitle/Desc`, `basicPicotsEnabledTitle/Desc` | Deleted |
| `project.reviewSectionTitle/Desc`, `reviewCardGeneralDesc`, `reviewCardSearchDesc` | Deleted (`reviewCardGeneralTitle`, `reviewCardSearchTitle` are group titles) |
| `aiContext.sectionTitle` / `aiContext.sectionDesc` | Deleted / intro line |
| `project.picotsHelpAria` | Deleted |
| `llmConnections.cardTitle` / `cardDescription` / `sharedDescription` | Deleted (duplicates the rail label) / Project default hint / Shared keys hint |
| `project.teamSectionTitle/Desc`, `teamCardAddDesc`, `teamCardMembersDesc` | Deleted (`teamCardAddTitle` is the invite row label) |
| `project.teamCardRolesDesc` | Roles group hint |
| `consensus.sectionTitle/sectionDesc`, `managerVisibilityCardTitle/Desc`, `projectDefaultUsingSystem` | Deleted |
| `consensus.runsBannerTitle`, `runsBannerBody` | Intro line (both kept; `copy-run-vocabulary.test.ts` is unaffected) |
| `consensus.projectDefaultDesc`, `templatesDesc` | Group hints |
| `project.advancedSectionTitle/Desc`, `advancedCardEligibilityTitle/Desc`, `advancedCardParsingDesc`, `advancedCardDangerDesc` | Deleted (the parsing card's "newly ingested documents" scope moves into `highQualityHint`, below) |
| `project.advancedCardKeywordsDesc`, `advancedCardStudyTypesDesc`, `advancedDeleteProjectWarning` | Row hints |
| `user.profileTitle/Description`, `profileCardTitle/Description`, `profileEmailAria` | Deleted |
| `user.securityTitle/Description`, `securityCardTitle/Description`, `securityNewPasswordHint`, `securityConfirmHint` | Deleted (the last two restate the intro and the label) |
| `llmConnections.integrationsDescription`, `user.integrationsZoteroDescription` | Group hints |
| `articles.articleFiles`, `articleFilesDesc`, `addFilesHint`, `keywordsHeaderOne/Plural`, `keywordsAddFocusAria` | Deleted (PR 2) |

New keys: `common.fieldHintAria` ("About {{label}}"), `common.addToLabel` ("Add to {{label}}"), `consensus.currentDefaultLabel` ("Current"), `consensus.currentSystemDefault` ("System default (1 reviewer, unanimous)").

Text corrections (the key stays, the words change because they are false today): `consensus.tabConsensusDesc` "Reviewers, consensus rule, and arbitrator" → "Consensus rule and arbitrator" (the reviewer count input is gone), and `parsing.highQualityHint` gains "Applies to newly ingested PDFs." from the deleted parsing card description.

## 5. States

- Loading, empty and error states keep their behaviour and render inside their group; skeletons match row height (`h-8`).
- Non-manager views keep today's capabilities: controls that are disabled today stay disabled (quiet, `disabled:opacity-50`), switches stay disabled switches, AI engine keeps its plain-text values and Locked badge, and the review question keeps its preview. No new read-only mode is introduced.

## 6. Enforcement

**`scripts/fitness/check_ui_primitives.py`** gains a rule, `settings-frame`, with a `GUIDANCE` entry and a docstring line citing this spec. In the scoped paths it flags:

- an import of `ui/card` or `ui/alert`, in either quote style, via the `@/components/ui/` alias or a relative path;
- a class string holding an all-sides `border` or `border-dashed` token together with a `rounded*` token — the raw framed box that most §1 frames are (`BasicInfoSection.tsx:100`, `TemplateConsensusOverride.tsx:115`, the Zotero boxes, the author rows, the keywords box).

Scoped paths: `frontend/components/project/settings/`, `frontend/components/user/`, `frontend/components/settings/` and `frontend/components/project/PicotsPane.tsx` in PR 1; `frontend/components/articles/sections/` and `frontend/components/articles/{ArticleFilesSection,ArticleAuthorsField,ArticleKeywordsField}.tsx` added in PR 2. The rule starts at zero findings in each PR.

**`scripts/fitness/check_retired_symbols.py`** (the absolute gate for concepts that must not return) gains `SettingsCard` and `SettingsField` in PR 1, and `SettingsSection` in PR 2.

**`scripts/fitness/check_button_scale.baseline`** is tightened for every touched file whose count drops, by editing those entries (not a blanket `--update-baseline`).

## 7. Testing and verification

**Vitest:**

- `SettingsRow`: label ↔ control association via `htmlFor`; with `hint`, the `FieldHint` is a sibling of the `<label>` (the control's accessible name is the label alone) and the render-prop `describedBy` includes the hint id; with `error`, the error id is appended and the message rendered; the grid classes use the `@[36rem]/settings` container query (class contract — jsdom sees no layout).
- `FormControl`: with an incoming `aria-describedby`, the control's attribute holds the incoming id and the description id when valid, and also the message id after a failed submit.
- `FieldHint`: named "About {label}"; the tooltip shows the hint on a fine pointer; with the coarse-pointer query mocked true, a click opens a popover with the hint.
- `SettingsGroup`: renders an `<h2>`; the hairline classes carry the `first:` resets; `tone="danger"` colours the title.
- `Input`/`Textarea`/`SelectTrigger` `quiet`: the class contract — transparent border, hover fill, `md:text-[13px]`, `focus-visible:` (not `focus:`) ring and fill, `aria-[invalid=true]:focus-visible:ring-2`.
- `TagInput`: its input takes `id` and `aria-describedby`; the add control is named by `addLabel`.
- `useManagerReviewVisibility`: optimistic toggle, revert on failure, prev-sync; `ManagerReviewVisibilityToggle.test.tsx` stays green unchanged.
- Zotero: label and value render as separate row cells (regression test for the run-together text).
- AI engine: non-managers see the Locked badge when members are locked.
- Authors: each name input has an accessible name.
- Existing tests stay green in behaviour. Known edits: `AiEngineSection.test.tsx:91,102` query a table — assert the shared-keys list by role `list` and a row's label, and assert the non-manager case by the absence of the key's label and `sharedRemoveAria`; `AdvancedSettingsSection.test.tsx:47` reads `highQualityHint` as text — assert it through the ⓘ trigger and `aria-describedby`. `SecuritySection.validation.test.tsx:88-90`, `ArticleFormChrome.test.tsx:57-69` and `e2e/flows/settings-connections.e2e.ts:15` must pass unchanged. Tests that asserted removed titles or descriptions are updated to assert the same information via row labels, intro lines or hints, never deleted blind.

**Gates:** `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip --no-tag-hints`, `npx knip --production --no-tag-hints`, `bash scripts/fitness/run_all.sh` (copy keys, UI primitives with `settings-frame`, retired symbols, button scale, file size).

**Browser, one session (`design-review`).** "Before" is the base commit checked out in a separate `git worktree` and served by Vite on its own port — never `git stash`. "After" is the branch on another port. Both are measured in the same browser session at 1920, 1280, 768 and 390 px, light mode, and one settings page plus the article panel in dark mode. Pass criteria, per in-scope page:

- **Frames:** zero elements in `<main>` with a visible border on all four sides, excluding form controls, switches, badges, avatars, dialogs and popovers.
- **Width:** the `SettingsPage` column is 768px wide at 1920.
- **Overflow:** no horizontal scroll at 390 and 768.
- **Density:** vertical pixels per field (settings body height ÷ field count) is lower than before on every settings page.
- **Type:** every label, input and value in the settings body renders at 13px at 1280.
- **Targets:** no new interactive target under 24×24 px on a fine pointer.
- **Captures:** a screenshot of each page, hover and focus states of a quiet input, a focused invalid field, the ⓘ tooltip open, and the ⓘ popover open with touch emulation at 390.

## 8. Risks

- **Affordance loss on borderless inputs.** The hover fill plus a visible focus ring are the affordance, and empty inputs keep their placeholder. The browser pass checks an empty required field at rest in light and dark mode.
- **`aria-describedby` wiring.** Solved once: the render-prop in `SettingsRow` plus the merging `FormControl`; their tests pin the valid and error states.
- **Upstream shadcn drift.** The `quiet` variants and the `FormControl` merge are recorded divergences with guard tests, so a future `shadcn add` that overwrites them fails the suite.
- **Coarse-pointer growth.** `icon-xs` buttons grow to 44px on coarse pointers (`ui/button.tsx:39-40`), so hinted rows are taller on touch; density is measured on a fine pointer, and touch layouts are checked for overlap only.
- **Wide diff across ~30 files.** Mitigated by the two PRs and by task order inside PR 1: primitives, controls and `FormControl` first, then project settings, then user settings and Integrations, each with its tests green before the next.
- **File-size ratchet.** No in-scope file is near the 800-line cap except `ArticleForm.tsx` (808 lines, baselined at 1213), which this spec does not grow.

## 9. Follow-ups

- The prose measure on QA Configuration's long tool descriptions (measured 1574px wide at 1920 in sub-project 2), if the user wants a readable column there too.
- QA Configuration's manager-visibility toggle as a flat row, reusing `useManagerReviewVisibility`, if that screen gets a density pass.
- Team's `confirm()` on member removal as an `AlertDialog` (frontend-ux §8); out of scope here as a behaviour change.
