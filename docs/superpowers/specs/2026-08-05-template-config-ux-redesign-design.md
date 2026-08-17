---
status: draft
last_reviewed: 2026-08-10
owner: '@raphaelfh'
---

# Template configuration UX redesign + extraction engine — design

> **Status:** Draft · Date: 2026-08-05 · Deciders: @raphaelfh
> **Scope:** replace the dialog-per-edit template configuration screen with a
> draft/publish grid editor; introduce a template-level general AI
> instruction, a project-level extraction engine (model/mode/alternates,
> future custom endpoints), reviewer-facing engine surfaces, and corrected
> run-provenance recording. Extraction templates only (QA config untouched).
> **Delivery:** three tracks, seven phases (A, C1, B1, B2, B3, C2, C3) —
> each phase is its own plan + PR train. This document is the umbrella
> design; phases must not be merged into one implementation plan.

## Problem

Every micro-edit on the Configuration tab costs ~5 interactions (single-open
accordion → `⋮` menu → dialog → save) and fires an immediate template
republish (v+1 + re-pin), so ten small edits mint up to ten versions and a
failed republish silently desynchronizes config from the published version
(`useTemplateRepublish` fire-and-forget). Reordering fields, moving a field
between sections, and creating per-model sections are impossible from the
UI. There is no template-level AI instruction, no model/mode choice, and
run provenance records `settings.LLM_PROVIDER` — an env var that can change
after the run (provenance can lie; constitution §IX violation).

Research grounding (session artifacts, see References): SR tools and
doc-extraction platforms converged on draft-workspace + single publish
review with severity-tiered friction (REDCap, Qualtrics, PlanetScale);
field editors at this scale (40–70 fields) converged on dense grids with
inline editing (Airtable, Notion); reporting standards (RAISE, RRMG,
PRISMA-trAIce, TRIPOD-LLM, the 2025 joint position statement) mandate
pinned model identity, exact prompts, and 100% human verification —
reproducibility is provenance, not determinism knobs.

## Design overview — one screen, two visual regimes

The manager screen (Configuration tab, `managerOnly`) is split by a rule
the structure itself teaches:

- **Page chrome** (project regime — applies immediately, never versioned):
  the `⚙ <model> · <mode>` engine chip with its popover, and
  `Switch template…` (renamed Import; it is a lifecycle swap, not a draft
  change).
- **The versioned card** (neutral permanent border — the card *is* the
  template object): card header = Draft chip (changes popover), search,
  History, `Publish vN…`; row zero = ✨ General AI instruction; body =
  outline rail + grid + docked inspector.

Enforcement rules: engine edits never increment the Draft chip and never
appear in the Publish diff (the sheet carries the disclaimer "Model and
mode are project settings and are not part of this version"); every
parameter has exactly one writable surface (all other appearances are
read-only echoes with deep links); amber is reserved for "needs attention
before publish" (Draft chip, unresolved `[customize:]` slots, warning diff
tiers) — never the card frame.

## 1. Draft / publish model (track B backbone)

- **One server-persisted draft per template** with an advisory editor lock
  ("Draft · 6 changes · started Jul 30 by M. Costa · Take over"). No
  per-user drafts, no live co-editing in v1.
- Editing no longer republishes. The draft accumulates; **Publish** is the
  only friction: a severity-tiered diff sheet (additive/cosmetic
  pre-approved · semantic rows expand-to-view · destructive rows require
  per-item ☑ ack), an optional version note, then `republish` (existing
  v+1 + re-pin + materialization machinery, `TemplateVersionService`).
- The client-side Draft chip diff is advisory; the Publish sheet numbers
  are **recomputed server-side** from the persisted draft.
- Per-change Revert in the Draft popover is **leaf-only** (label, type,
  required, options, instructions); structural changes (add/remove/move/
  duplicate) point at ⌘Z and whole-draft Discard. Cascade-aware revert is
  explicitly out of scope.
- **History** (card header): versions with author, timestamp, note, diff,
  pinned-run counts. "Restore vN" stages that version's shape as the
  current draft and goes through the same Publish (history is
  append-only, never rewritten).
- **Unpublished regime** (scratch-built template, no v1 yet): chip reads
  "Not yet published", button reads "Publish v1…", the sheet shows one
  "initial version" block (no tiers, no acks, no reopen section — an
  unpublished template has zero runs by construction). No phantom v1 row
  in History. Imported templates: v1 = the import snapshot (already true).

### 1.1 Critical backend prerequisite (phase B1) — snapshot-only readers

Three adversarial findings make the draft layer a backend project first:

1. **AI prompts read live rows** (`section_extraction_service`
   `_top_level_entity_types_for_template`, also the judge/model paths):
   safe today only because live == active snapshot. Extraction must read
   structure and instructions from `run.version_id`'s snapshot.
2. **Worklist progress and exports read live rows**
   (`useTemplateEntityTypes` → progress percentages;
   `extraction_export_service` role/label lookups). Re-point to the active
   version snapshot.
3. **`template_clone_service` self-heal** measures drift live-vs-snapshot
   and republishes on drift — under a pending draft, re-import would
   silently publish it. The drift clause is rewritten in the same change
   that removes auto-republish; re-import with a pending draft blocks with
   an explanation (discard or publish first).

Also inverted: `useFieldManagement.republish.test.tsx` asserts
edit-implies-republish — rewritten to assert the opposite (edits never
republish; publish does).

### 1.2 New backend API surface

Editor writes move off direct PostgREST (CI forbids new `supabase.from`)
onto typed endpoints: draft field/section CRUD (including reorder and
move), server diff + severity classification, versions list (History),
publish, per-change leaf revert, discard draft,
engine settings GET/PUT (lands in C1), engine availability per-user
(lands in C2), and the sub-section/table writes gaining `role` +
`parent_entity_type_id` (replacing the hard-coded `study_section`/`null`
in `createSection`). This inventory spans all tracks; each endpoint
ships with its owning phase.
All behind `require_project_manager` except availability (member) —
BOLA-checked, ApiResponse envelope, typed error codes.

## 2. The editor (phase B2)

**Grid + docked inspector** (zero dialogs), Airtable cell contract:

- Click focuses the cell (ring on the full cell) and selects the row —
  never edits. Second click / Enter / F2 / typing edits (typing replaces).
  Text cells focus-then-edit; control cells act on click (Type opens its
  menu, Required checkbox toggles, ✨/Options cells open the inspector at
  the right group). Enter commits and moves down (chains into the ghost
  row); Enter on an empty ghost exits the chain; a never-committed empty
  row is auto-discarded on blur and never enters the draft or the diff.
  Esc: cancel edit → close inspector (focus returns to the cell) → clear
  focus. Tab/Shift+Tab move horizontally; arrows rove (ARIA grid).
- Inspector: docked, non-modal (`⌘.` toggles), repointed by selection;
  field form = Label · Key 🔒 · **Section combobox** (the accessible move
  mechanism) · Type · Required (switch here) · Options (drag, wrap) ·
  allow-other · ✨ AI instruction ("Guides the AI on this field only…") ·
  Description — for reviewers ("Never sent to the AI") · dispositions ·
  View prompt. Below the container breakpoint it becomes a Sheet overlay.
- Moves: dnd-kit drag with edge auto-scroll and **drop-on-collapsed-header
  = end of that section**; `⌘⇧↑/↓` keyboard move (re-parents across
  boundaries, announced); `⌘⇧M` "Move to section…" command menu; the
  Section combobox. Undo: single draft-session stack, toast with Undo
  (6 s) on every structural mutation; deletes never confirm in draft (the
  Publish ☑ ack is the real gate).
- Layout: no `#` column; Key and Options columns behind a Display menu
  (sliders icon — never a second gear), Key default-off; horizontal
  hairlines only; sticky tiers = card header + section headers (~68 px),
  anchored to the tab's scroll container; outline rail (200 px, 2-line
  wrap + tooltip, scroll-spy, `＋ New section` footer) gated by container
  query — below it the stuck section header becomes a jump menu; container
  queries throughout (the sidebar is resizable 240–400 px — viewport
  breakpoints misfire); coarse pointers: ≥44 px rows, long-press drag,
  no gutter inserter.
- Section headers: single-line fixed-height flex rows (⠿ · chevron ·
  label · ● description dot · muted truncating meta · spacer · `＋ ▾`).
  Metadata labels only the non-default: "one per article" is silent;
  "repeats per article", "repeats per model", "Repeating group" are shown.
  Required column uses compact checkboxes (switches only in the inspector).
- Add flows: per-section ghost `＋ New field` row (Enter-chains); `＋ ▾`
  header menu (Field / Duplicate / Delete — plus group-specific items,
  §3); hover gutter inserter (6 px activation band, fine pointers only)
  for exact positioning; `＋ New section ▾` in the rail footer and grid
  end. New sections are born inline (label editing in place), then the
  section inspector opens (Description carries "shown to reviewers AND
  sent in this section's prompt" + View prompt; cardinality as labeled
  control, never the bare "Unique" jargon).
- **Search** (cardbar, collapsed 🔍 → 240 px input): filter-the-grid, VS
  Code-settings style. Matches label, key (even hidden), section titles,
  descriptions, AI instructions, option values — hidden-property matches
  show "· in AI instruction" hints; `<mark>` highlights; sections
  auto-expand (collapse state restored on clear); rail shows per-section
  counts and dims zero-match entries; count suffix `12/66`. `/` opens,
  Esc clears-then-closes, ⌘F is never hijacked. While filtering: inline
  editing stays live, edited-away rows stay visible until the query
  changes, ghost rows/inserter hidden, drag disabled ("Clear search to
  reorder"). No-match state offers `＋ New field "<query>"`.
  Normalization: case- and diacritic-insensitive both sides, whitespace
  terms AND-ed.

## 3. Hierarchy — repeating group with data-driven entry noun

Ground truth: `ck_extraction_entity_types_role_parent` allows children
only for `model_section` under the unique `model_container` (deferred
trigger, one per template). Generic section nesting **does not exist and
is deferred** (priced: constraint + trigger + snapshot + materialization +
run rendering + consensus + exports; no real template needs it — if the
need is visual grouping, ship a cosmetic field-group divider instead).

- **Terminology is generic; the noun is data.** Kind badge: "Repeating
  group". New column `entry_label` on `extraction_entity_types`
  (meaningful for containers; seeded "model" for existing groups)
  interpolates all copy in config **and** run view: "one entry per
  model", "Add model", "per-model section", "New per-model section".
- Grid rendering: the group is one bounded block — single 2 px left
  accent rule (no interior vertical borders), identity fields directly
  under the group header, child sections as indented sub-headers,
  indentation carries the hierarchy (identity 22 px / sub-header 14 px /
  child fields 36 px), block ends with `＋ New per-model section`.
- `＋ ▾` menus tell the schema's truth: root sections never offer
  sub-sections; the group offers `New field` (identity) + `New per-model
  section` + `Delete repeating group…` (cascade warning: children + run
  entries); the bottom ghost offers `Add repeating group…` — disabled
  when one exists ("This template already has a repeating group
  ('Prediction Models')"), hidden for QA templates. Creating one asks
  Label + entry label; cardinality is not asked (a group always repeats).
- Inspectors: group — Kind line "Repeating group — reviewers add one
  entry per model", Repeats locked, entry label editable, no Section
  combobox; per-model section — Placement locked to the group, Repeats
  editable (`Once per model` / `Repeats per model`).
- Live-template safety is free: cardinality-one children backfill under
  existing model instances on session open and on publish
  (`_backfill_child_singletons`); the completion gate picks new required
  fields up only from the next published snapshot.
- AI model-identification stays model-tuned in v1; groups with other
  entry labels start manual-entry-only (generalizing the identification
  prompt by interpolating the group label/description is assessed in the
  C-track plan, not promised here).
- The `entry_label` column and the `createSection` role/parent params
  land with phase B1's migration set (the editor in B2 consumes them).
- Standalone repetition already generic: any section may set
  `cardinality=many` ("Repeats: one per article / repeats per article"
  in its inspector; run view already renders Add-instance).

## 4. ✨ General AI instruction (phase A — ships first)

- **Storage:** nullable `TEXT` column `llm_template_instruction`
  (CHECK ≤ 4000 chars) on **both** `extraction_templates_global` and
  `project_extraction_templates`. Not `schema_` JSONB (vestigial), not a
  table (YAGNI). Clone copies global → project, so imports are born with
  a framework-tuned default (CHARMS/CHARMS+MM extraction text; PROBAST/
  QUADAS-2 appraisal text — adaptation is data, no `if framework` in
  code). Seed sets the four globals + idempotent fill-if-null; prod needs
  a manual `python -m app.seed` (seed never runs on deploy). The column
  applies to both kinds; QA templates get the seeded default injected in
  their prompts, but with no QA structure editor in scope, editing a QA
  template's instruction in-app is not available in v1.
- **Versioning:** `build_template_version_snapshot` emits a top-level
  `llm_template_instruction` key **only when non-NULL** (absent ≡ NULL —
  no phantom v+1 on legacy templates; no `jsonb_strip_nulls`, which would
  recurse into field objects). Republish no-op detection then works
  unchanged.
- **Prompt assembly:** both `_USER_TEMPLATE`s gain an optional leading
  "General instructions for this review:" block, rendered only when the
  **run-pinned snapshot** carries the key (never the live column;
  `content_version()` bumps the prompt VERSION). NULL injects nothing —
  a hidden code default would make the snapshot lie about the prompt.
- **UX:** card row zero. Collapsed: one line, quoted ~90-char preview +
  badges (`Template · versioned`, `edited` when differing from the origin
  global) — swapped for an amber chip "⚠ N [customize] slots to resolve"
  while unresolved slots remain. Click expands inline (auto-grow
  textarea, counter past ~1600). `[customize: …]` spans render
  highlighted until resolved; Publish adds a warning-tier line ("sent
  verbatim to the AI") — non-blocking. "Reset to template default" when
  an origin exists; custom templates get a ghost placeholder + "Insert
  suggested default" (never silently injected text). Publish diff shows
  the instruction edit as its own lowest-tier row with an inline old→new
  text diff. "View prompt" (inspector + row) shows the rendered prompt
  with the three instruction levels highlighted (general / section
  description / field instruction).

## 5. ⚙ Extraction engine (phases C1, C2)

> **Scope call, 2026-08-10.** The backend half of C1 shipped: the server owns
> which model runs (the client-supplied `model` field is gone), the engine is
> frozen once per run so retries cannot drift, and provenance records the
> resolved engine plus the key scope (`user_byok` / `global_service`) — never
> the key. Everything below that is **surface** — the curated catalogue, the
> model picker, the per-project `llm_engine` setting, and the Fast/Verified
> selector — is **deferred to its own spec**, along with §5.1 and §7 which
> depend on it. Tracked in [`docs/ROADMAP.md`](../../ROADMAP.md) under
> "Deferred to a future spec". The text below is retained as the design input
> for that spec, not as a description of what C1 delivered.
>
> **Scope call, 2026-08-17.** The surface shipped as **C1b**
> (`docs/superpowers/plans/2026-08-17-c1b-engine-surface.md`): the curated
> catalogue, the model picker, the per-project `llm_engine` setting, and the
> Fast/Verified selector (Verified visible, disabled; mode enum + provenance
> keys recorded). Still deferred: the Verified execution pass, alternates and
> custom endpoints (C2), §5.1 reviewer surfaces, §7, and the per-article cost
> preview.

- **Storage (C1):** `projects.settings.llm_engine =
  {provider, model, mode, updated_by, updated_at, previous_model}`,
  owned by a service (ParserSettingsService pattern). One attribution
  line ("Model changed by M. Costa · Jul 28 · was GPT-5.1") — an audit
  *line*, not an audit trail (a real trail is future work, called out).
- **Model picker:** one searchable combobox grouped by provider over a
  **server-curated catalog** (3–6 models per provider; never free text;
  never a model `build_model` rejects). Rows: plain-language label +
  one-line "best for", right-aligned context window + cost tier
  ($/$$/$$$), canonical `provider:model` snapshot string in monospace
  (that string is what provenance and methods sections carry — pinned,
  never "latest"). Key-gating: BYOK-only providers without a key render
  grayed + lock + "Add your key" CTA (never visible-but-fails); group
  header carries "each user runs on their own key". Retired catalog
  entries preserve stored strings and block new runs until re-chosen.
- **Mode:** segmented `Fast` (single pass — today's pipeline; the
  entailment gate is structural in BOTH modes, and per-section
  provenance records `mode_requested`/`mode_executed`/`passes`) /
  `Verified` (extract → independent verify). C1 ships the selector with
  `Fast` active and `Verified` visible but disabled ("soon"); the enum
  and the provenance keys land in C1 so records are stable when the
  verify pass arrives. Cost preview per article before running;
  actuals recorded per run. No temperature/seed controls **by design** —
  system-fixed and recorded ("temperature=0, fixed by system").
- **Alternates (C2):** manager-curated list in the engine popover
  ("Reviewers who can't run the default may run these instead — labeled
  as deviations"). Ships empty = locked policy; no separate policy
  toggle. Managing reuses the same catalog in multi-select with
  project-availability notes; picking another BYOK-only model warns it
  won't unblock keyless reviewers.
- **Custom endpoints (C2):** manager-only, project-scoped
  `llm_endpoints` table (label, `openai_compatible`, base_url,
  Fernet-encrypted shared key, whitelisted models, capabilities,
  validation timestamps). `build_model()` grows the
  `openai_compatible` branch (pydantic-ai OpenAIChatModel + base_url).
  Save-time "Verify connection": `GET /models` + structured-output probe
  (tool → native → prompted), stored as `capabilities.output_mode`;
  Verified mode warns/blocks on prompted-only endpoints. SSRF guardrails
  day one: https-only, resolve-and-validate every IP (RFC1918, loopback,
  link-local, CGNAT, ULA), no redirects, response caps, sanitized
  errors; keys never in provenance/logs (endpoint id + label + host
  only). Endpoint failure fails the run with a typed error — **never a
  silent cloud fallback**. Laptop Ollama is documented as
  works-via-tunnel-unsupported (workers cannot reach localhost);
  self-hosted prumo is the strict-perimeter answer (future).

### 5.1 Reviewer surfaces & trigger-time resolution (C2)

The Configuration tab is `managerOnly` — reviewer surfaces live where
reviewers are:

- **Run header:** read-only engine chip (model label + canonical string +
  mode; endpoint host when custom). Deviation runs render it amber:
  `⚠ GPT-5.2 · alternate`.
- **Trigger time:** a per-user availability read model
  (`canonical: {runnable, keyScope, reason}` + runnable alternates;
  reason codes drive all copy) feeds every Run-AI button through one
  gate hook + `EngineResolutionPopover`. Happy path: one click, footer
  states which key pays ("Runs on your OpenAI key" / "prumo's shared
  key" / "the project endpoint's shared key"). Degraded: amber-dot
  button opens the picker — canonical listed first, locked, with reason
  + "Add key →"; runnable alternates selectable; optional
  "use for all my runs in this project" (persistent amber chip, still
  recorded per run). Blocked (no alternates): explanation + CTAs +
  "You can keep extracting manually — AI suggestions are optional."
  Kickoff endpoint re-validates (typed `LLM_KEY_UNAVAILABLE`); the
  worker's `MissingLLMKeyError` remains the last resort. No silent model
  substitution on key failure, ever.
- **Deviation provenance:** run record gains
  `engine_source: project_default | approved_alternate | probe` +
  `canonical_model_at_trigger`; consensus compare shows per-proposal
  engine; finalize shows a non-blocking banner when one article mixes
  models ("Disclose this in your methods…"); the AI-use export
  enumerates every distinct engine with a role column.

### 5.2 Run record (🧾) corrections (C1; endpoint/key-scope fields extended in C2)

Provenance records **what actually ran**, resolved once per run into a
frozen `LlmTarget` (provider, base_url/endpoint id, model, key scope,
capabilities) threaded through the services — never
`settings.LLM_PROVIDER`: resolved model id from the API response,
key scope (`user_byok`/`global_service`/`shared_endpoint`, never the
key), requested vs executed mode + passes, template version + rendered
prompt, inference settings ("temperature=0, fixed by system"), parser
identity + markdown hash, tokens/cost, timestamps. The three
inconsistent frontend hardcoded model defaults
(`sectionExtractionService`, `extractionRunService`, `app.config.ts`)
are deleted in C1 — the engine setting is the single source.

## 6. Publish sheet — runs section — DROPPED 2026-08-10

**Reopen-on-publish is not being built.** Only the first bullet survives:
active (editable-stage) runs re-pin automatically via existing machinery,
and the sheet says so. There is no runs checklist and no `REOPEN` token.

An independent map of every reopen path, made before planning, found the
section rested on a mistaken reading of the code: it conflated
`reopen_to_extract` (destroys published state in place) with `reopen_run`
(forks), and `finalized → extract` exists in no transition table. Both
candidate implementations were unacceptable — destroying deletes
`ExtractionPublishedState`, which *is* the value of record, and would have
needed a new ADR **superseding** ADR-0017 rather than the "deliberate
widening" this section claimed; forking collides with
`uq_one_live_extraction_run_per_coord` (0045), where the first `23505`
aborts the whole publish transaction. The stated permission model was also
unbuildable: `ExtractionHitlConfig.arbitrator_id` is read by zero
authorization paths today.

Decisive argument for dropping it rather than redesigning it: this section
already conceded that **publishing never requires reopening**, and
individual reopen remains available post-publish via History/worklist. The
feature bought nothing that did not already exist, at the price of an
irreversible delete path.

Full evidence:
[`../plans/2026-08-10-template-config-b9g-reopen-findings.md`](../plans/2026-08-10-template-config-b9g-reopen-findings.md).

## 7. Probe (phase C3)

Per-field "Probe with another model": any catalog model, the prober's
own key only, always Fast, **reuses the run's pinned snapshot prompts**
("compares models, not template versions" — result chip shows
`🔬 probe · <model> · v3 prompts · your key`). Output is a labeled
side-artifact (no-persist endpoint or segregated storage — decided in
the C3 plan; never `_create_suggestions`), never replaces the canonical
proposal, recorded in provenance as `engine_source: probe`. Probe and
alternates stay distinct mechanisms.

## 8. Error handling

Typed codes end-to-end (ApiResponse envelope; `error.message`):
draft lock conflict (409 + holder identity), publish diff drift
(sheet recompute prompt),
`LLM_KEY_UNAVAILABLE` (+ reason codes), endpoint unreachable /
capability lost (fail fast, re-probe affordance), model-retired,
unique-index race on group creation ("Someone else just added a
repeating group"), republish failure (no longer fire-and-forget — the
Publish flow is synchronous and reports). Empty-state inventory: no key
(picker lock + CTA), no runnable engine (AI panel empty state; manual
extraction always available), catalog fetch failure (cached list +
stale banner — never an unexplained empty dropdown).

## 9. Testing strategy

Per phase, integration-first (per project rules):

- **A:** snapshot conditional-key round-trip (NULL legacy = no phantom
  v+1; set/clear = real diff); prompt assembly from pinned snapshot
  (reopened old run keeps its instruction); seed idempotency
  (fill-if-null never clobbers customized text); clone copies the
  column.
- **C1:** engine settings service (attribution fields); provenance
  records resolved target, not env; hardcoded-default deletion contract
  test.
- **B1:** the invariant inversion — contract tests that draft edits are
  invisible to run prompts, worklist progress, and exports until
  publish; clone-with-pending-draft blocks; rewritten
  `useFieldManagement.republish` tests; publish re-pins + materializes;
  unpublished regime (no runs, no reopen section).
- **B2:** cell contract (focus vs edit, Enter chain + empty-ghost exit,
  Esc ladder, focus return), move paths ×3, search filter semantics
  (hidden-prop hints, drag disabled), a11y (roving tabindex, live-region
  announcements, WCAG drag alternative); Playwright E2E for
  add-field-chain and drag-between-sections; visual snapshots for the
  group block.
- **B3:** leaf revert, restore-as-draft. (Reopen-on-publish dropped —
  see §6.)
- **C2:** SSRF validator unit suite (private IPs, redirects, rebinding,
  userinfo, schemes), capability probe against a stub OpenAI-compatible
  server, availability matrix per key state, alternates gating,
  deviation provenance through consensus compare.
- **C3:** probe non-pollution (no canonical suggestions written).

RLS reminder: the manager-only write gate for `extraction_fields` /
`extraction_entity_types` is client-side only today — tracked as a
separate hardening task (spawned 2026-08-04), independent of this
redesign but assumed by it.

## 10. Non-goals

Generic section nesting (deferred, priced); multiple repeating groups
per template; per-user engine override on canonical runs; live
co-editing / multi-draft; cascade-aware revert; browser-side inference;
localhost/private-IP endpoints in SaaS; temperature/seed controls;
review-threshold bands and evidence-check knobs (phase-2 of engine,
documented in research); the AI-use disclosure export generator
(highest-leverage future feature — designed in research, not scheduled
here); QA-template structure editing (QA config remains tool toggles).

## References

- Research syntheses and adversarial reviews (session artifacts,
  2026-08-04/05): SR-tool + doc-platform + reporting-standards +
  agentic-trends synthesis; model-picker/local-model/governance
  synthesis; param-governance, default-instruction, grid-stress,
  app-integration, reviewer-access, red-team, subsection-grounding, and
  search-field reports. Mock iterations v1–v10 + final (visual companion,
  `.superpowers/brainstorm/` — gitignored session artifacts; key file:
  `final-complete-mock-v2.html`, polish: `manager-grid-v3-polish.html`).
- Code ground truth cited throughout: `backend/app/models/extraction.py`
  (role/parent constraints), `backend/app/services/{template_version_service,
  template_clone_service,hitl_session_service,section_extraction_service}.py`,
  `backend/app/llm/{provider.py,prompts/section_extraction.py}`,
  `frontend/components/extraction/TemplateConfigEditor.tsx`,
  `frontend/lib/extraction/entityTypeRoles.ts`,
  `frontend/components/layout/sectionViews.ts`.
- Related ADRs: 0013 (stored markdown — enables quote verification
  later), 0016 (dispositions), 0017 (reopen transition), 0018 (staged
  consensus).
