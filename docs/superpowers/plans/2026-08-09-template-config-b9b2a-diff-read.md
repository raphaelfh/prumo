---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9b2a — the diff read surface + a read-only tier view

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore, 2026-08-09) against dev @ `63863841`.
> Inherits the ratified rulings in
> `docs/superpowers/plans/2026-08-09-template-config-b9b1-diff-read.md`
> ("Pre-decided for B-9b2") — **with one correction the map found: it is
> 14 wire variants, not 13.**

## Why this split

B-9b2 as one slice is: a wire enum + composite ids + display renderers +
an `affects_recorded_data` post-pass + a repository promotion + a new GET
+ a fingerprint + a request body on a POST that has none + a new refusal
code + a migration + a six-phase sheet with per-item acks + ~70 copy keys
+ five test suites. That is two PRs, and the second cannot be reviewed
while the first's contract is still moving.

- **B-9b2a (this plan)** — the read surface, ratified by a **read-only
  tier view**: the sheet renders the tiers with no acks, no note, and the
  existing Publish button untouched. This satisfies B-9a's D7 (no typed
  contract without a consumer) while the wire model is still cheap to
  change.
- **B-9b2b** — everything that can silently corrupt or mislead: the
  `(id, tier)` ack round trip inside `acquire_publish_locks`, the drift
  refusal and its tick-reset, the request-body blast radius, migration
  0052 + the note, and the no-op resolution.

## Load-bearing facts (verified 2026-08-09)

- **14 wire variants, not 13.** `_diff_instruction`
  (`template_diff.py:339-354`) provably emits ADDED **and** REMOVED **and**
  MODIFIED — clearing the instruction is reachable, since
  `template_instruction_service`'s `(x or "").strip() or None` writes
  NULL. Splitting `(MODIFIED, FIELD, allowed_values)` into
  option-added/option-removed then gives 14. **An enum that is not
  exhaustive over the engine is the one thing the discriminator exists to
  prevent.**
- **The raw string id exists but is discarded at every site.**
  `_Node.node_id: str` (`:224`), built via `str(raw.get(IDENTITY_KEY))`
  (`:273`, `:280`) — including the literal `"None"`. There are **12**
  `TemplateChange(` sites; the 11 node-bearing ones all wrap the id in
  `_as_uuid(...)` (three via the hoisted `node_id` at `:546`), and the
  12th — the instruction row at `:345` — passes no id at all.
  `TemplateChange.node_id` is typed `UUID | None` (`:194`) with **four
  live consumers** treating it as a `UUID` in
  `template_discard_service.py` (`:301`, `:306`, `:377`, `:655`). Adding
  a parallel `raw_node_id: str` is the non-invasive route; retyping
  forces five call sites.
- **Two junk-id nodes cannot coexist**, so they cannot collide: `_index`
  keys its dicts by that same stringified id (`:274`, `:283`), so a
  second node with an absent id overwrites the first rather than
  producing two `"None"` rows. The composite id's junk-id cases are
  therefore about *stability and greppability*, not collision.
- **The GET would be the FIRST ungated `diff_snapshots` caller.** Both
  production call sites gate on `baseline_is_restorable` first
  (`template_version_read_service.py:94` before `:99`;
  `template_discard_service.py:265` before `:298`), and the engine writes
  that gate into its own caller contract (`template_diff.py:100-104`:
  `role` "has no canonical default by design … which the caller rejects
  wholesale via `snapshot_is_narrow` (D5)"). See D9.
- **Two variants carry only a count and the engine throws the rest away.**
  `_diff_field_order` computes `before_seq`/`after_seq` and discards them
  at `:626`; the two REORDERED variants also count **different
  populations** — a section's count excludes just-added fields, a field's
  option count includes just-added options.
- **`validation_schema` has no reader anywhere** — model, snapshot SQL,
  clone copy and the tier map only. No prompt, form, export or validator
  consumes it. A row saying "this changes meaning" is false today.
- `template_diff.py` is **642 lines** against the 800 ceiling; the
  fingerprint, the wire enum, the renderers and the post-pass will not
  fit.
- **Two incompatible notions of "recorded data" for a section**: this
  ruling derives it from child-field values
  (`_fields_referenced_by_the_workflow`), while Discard's section gate
  uses instance ownership (`_entity_types_with_instances`,
  `template_discard_service.py:454-469`). A section owning instances but
  no field values would read "no recorded work" here and be refused by
  Discard.
- Repository conventions: two coexist; a five-model union fits the plain
  `self.db` class form (`extraction_proposal_repository.py:11-13`), not
  `BaseRepository[Model]`. Repositories flush, never commit.
- `Sheet` already exists and is already used on this surface
  (`TemplateConfigGridPanel.tsx:670-693`); `accordion.tsx`,
  `scroll-area.tsx`, `checkbox.tsx` are all present with in-domain
  consumers. AlertDialog is wrong here: `AlertDialogContent` has no
  scroll container (`alert-dialog.tsx:36-39`). The secondary objection is
  narrower than first written — `asChild` already escapes the `<p>` tag
  (`TemplateDiscardDialog.tsx:198`), so the residual defect is that the
  rows would land inside the dialog's *accessible description*, which
  `aria-describedby` flattens.
- `frontend/test/TemplateConfigPublish.test.tsx` is **698 lines against
  the 800 ceiling and is not baselined** — a sheet suite needs a sibling
  file.
- Copy: `extraction.ts` pinned at 958; everything goes to
  `templateConfig.ts` (153 lines).
- The discard suite already built the multi-tier fixture machinery
  (`_fresh_charms`, `_add_section`, `_add_field`, `_set_label`,
  `_delete_field`, `_add_instance`, and `_option_orphan_setup` — the one
  that manufactures a recorded value on a removed option). They are
  module-private; **extract them rather than duplicating**, or the two
  gates drift.

## Decisions (panel-ratified 2026-08-09)

> Three-lens adversarial panel (identity · read model · scope), each
> finding put to an independent skeptic prompted to refute it: 18 raised,
> 1 BLOCKING survived (D9), 16 refuted, 1 downgraded to MINOR (the
> `types/api` regeneration, now in T2). Nine refuted findings left a
> residual their own skeptic endorsed; those are folded into D1-D8 and
> T1-T3 above and below.

- **D1 — 14 variants, exhaustiveness enforced.** The wire enum covers all
  14, and a test asserts every `TemplateChange` the engine can emit maps
  to exactly one variant **and** that no variant is unreachable — in the
  style of the existing `ATTRIBUTE_TIERS`-vs-`SNAPSHOT_SQL` assertion, so
  a future engine change fails loudly instead of falling into a catch-all.
  **Bounded claim:** it fails loudly for a new `ChangeKind`, `NodeKind`
  or snapshot attribute. It does **not** catch a future *sub-split inside
  an existing* `(kind, node_kind, attribute)` triple — the way
  `_diff_options` already splits `(MODIFIED, FIELD, allowed_values)` by
  `before`/`after` nullity (`:549-574`). That polarity stays
  fixture-covered by the per-variant renderer case, not proven exhaustive.
- **D2 — `raw_node_id: str` is added alongside `node_id`**, not a retype.
  The composite id is minted from the raw string (with `"template"`
  reserved for the instruction row); the four `UUID`-typed consumers in
  the discard service are untouched. The engine only carries the raw
  string `_index` already computes; **the id itself is minted in
  `template_diff_read.py`** (branching on `node_kind is
  NodeKind.TEMPLATE` for the sentinel), keeping the read model's
  vocabulary out of the pure engine. **Its in-slice consumer is the
  view's React row key**, stable across a `templateDiffKeys` refetch; the
  re-validation consumer lands in B-9b2b.
- **D3 — Only the opaque attributes render server-side.**
  `validation_schema`, `allowed_units` and `parent_entity_type_id` get
  `before_display`/`after_display` strings (never an id on screen);
  booleans and scalars ship typed (`str | int | bool | None`, never
  `Any`) and the copy layer renders them. Rendering everything
  server-side would satisfy the no-`Any` rule while silently forking the
  i18n boundary — the repo rule is that user-facing text lives in
  `frontend/lib/copy`. The `int` arm exists **only** if the two REORDERED
  counts share the attribute-value slot; no attribute value is ever an
  `int` (`ENTITY_ATTRIBUTE_DEFAULTS` `:105-115` and
  `FIELD_ATTRIBUTE_DEFAULTS` `:117-132` hold `str | bool | None` only).
  **Ruling: the counts travel in a named `reorder_count: int | None`
  field**, and the attribute-value slot narrows to `str | bool | None`.
- **D4 — A new module for the read model.** `template_diff.py` has no
  room; the wire enum, the renderers, the post-pass and (in B-9b2b) the
  fingerprint live in a sibling (`template_diff_read.py`), importing the
  engine rather than growing it.
- **D5 — The resolver becomes
  `ExtractionFieldReferenceRepository.fields_with_recorded_work`** (plain
  `self.db` class form), with **both** call sites re-pointed — the
  discard gate and the diff read — so the two cannot diverge. The
  `union()` and the empty-list early return move verbatim; no `flush()`,
  no template/project argument. The diff read resolves **live field ids
  only**, and that is correct rather than lucky: all five workflow
  `field_id` FKs are RESTRICT (`template_discard_service.py:126-135`), so
  a field absent from the live tree provably holds no recorded work —
  the delete would have been refused.
- **D6 — Name the section discrepancy, do not paper over it.**
  `affects_recorded_data` for an entity type is derived from child-field
  values; a section owning instances is a *different* predicate that
  Discard uses. Until they are reconciled the read model exposes the
  field-derived flag only, and the copy must not imply it covers
  instances. Reconciling them is explicitly B-9b2b's or a follow-up's
  problem, recorded here so nobody assumes it is done. **The post-pass
  signature is `(changes, parent_children_field_ids, recorded)`** — it
  needs the current snapshot's parent→children field-id map, because an
  ADDED/REMOVED section absorbs its child rows and `TemplateDiff.changes`
  alone cannot resolve them. A REMOVED node is structurally always
  `false` (the RESTRICT FKs in D5).
- **D7 — The consumer is a read-only tier view.** The sheet opens from
  the chip cluster, renders the four tier groups (additive and cosmetic
  **collapsed by default — count in the accordion trigger, expanding to
  the same row list as semantic**, never a count-only group; semantic
  expand-to-view; destructive listed with the recorded-work badge), and
  has **no checkboxes, no note field, and no Publish action of its own**
  — Publish stays where it is and behaves exactly as today. This ratifies
  the wire model on screen before anything mutates. The recorded-work
  badge is **destructive-only**: the post-pass computes the flag for
  every node kind, but no additive/cosmetic/semantic row renders it.
- **D8 — Honest copy for what the engine cannot say.** Reorder rows say
  only "N items reordered" and the two variants must not share a
  sentence that implies the same arithmetic — and the option variant's N
  **includes just-added codes**, so its copy must not imply all N moved
  ("order changed among N options", not "N options reordered").
  `validation_schema` rows
  must not claim a downstream effect. No per-option claim, and never the
  word "answers" — the union includes AI and system proposals, so the
  honest phrase is "recorded extraction work".
- **D9 (panel, BLOCKING) — the GET has THREE shapes, and the third gates
  on `baseline_is_restorable`.** Beyond "no baseline" (200,
  `initial_version: true`, empty buckets) there is a third state already
  live on this surface: an active version whose stored `schema_` is
  **narrow**. `config-status` refuses to diff it and returns
  `pending_change_count: null`
  (`template_version_read_service.py:93-95`), and the UI already renders
  that as `discardTooltipBaselineTooOld`
  (`TemplateConfigPublishControls.tsx:72-77`). Diffing it anyway
  fabricates rows: `role` defaults to `None` in the engine (`:112`) but
  is non-nullable live (`models/extraction.py:293`), so a narrow baseline
  yields **at minimum one phantom SEMANTIC row per entity type,
  deterministically** — a sheet full of changes beside a chip with no
  count. The GET therefore gates on the **same predicate** and returns
  `diff_available: false` with a `baseline_too_old` reason and empty
  buckets — **never a computed diff**. Without this the GET is the first
  ungated `diff_snapshots` caller in the tree.
- **D10 — the two inherited B-9b1 obligations are discharged here, not
  dropped silently.** (a) **`inventory_complete` is DROPPED.** The symbol
  exists nowhere in the tree — only in the b9b1 ruling text — and the
  hazard it named is a discard-side write concern that B-9c2 D11 already
  owns and shipped. The read model does not carry it and the sheet
  implies no inventory. (b) **The cost caveat is discharged by the
  promotion, plus one measurement.** `fields_with_recorded_work` *is* the
  already-shipped discard union, run today over every live field under
  `acquire_publish_locks` (`template_discard_service.py:252`, `:510`), so
  the GET adds no new query **shape** — but it does add a new
  **frequency**, so T2 records one `EXPLAIN` against the integration
  fixture in the PR body rather than skipping the ratified step.

## Tasks (subagent-driven, TDD per task)

**T1 — Composite id + the 14-variant wire model (backend, pure)**
D1, D2, D3, D4. Unit tests only: id uniqueness across every emission
site (including two option removals on one field, two fields losing the
same code, junk/absent ids, the instruction row); id stability across
recomputation with dicts whose keys were inserted in opposite orders
(**keep this case** — it is the only one that fails an ordinal-suffixed
id implementation, e.g. `…:2`); the exhaustiveness assertion; a
renderer-facing case per variant proving the client needs no knowledge of
the `before`/`after` overloading; and that no field on the read model is
typed `Any`. Add a **partition assertion** —
`OPAQUE_ATTRIBUTES | SCALAR_ATTRIBUTES == set(ENTITY_ATTRIBUTE_DEFAULTS)
| set(FIELD_ATTRIBUTE_DEFAULTS)` — in the style of
`test_tier_map_is_exhaustive_over_the_snapshot_key_set`
(`tests/unit/test_template_diff.py:684`), so a future JSONB snapshot key
cannot silently land in the scalar arm.

**T2 — Resolver promotion + `GET config-diff` (backend)**
D5, D6, D9, D10, and the `affects_recorded_data` post-pass. Re-point both
call sites; the discard suite must stay green. Integration tests: a draft
with all four tiers; a field with recorded values flipping a tier while
the **total** still matches the chip's count; the no-baseline shape (200,
`initial_version: true`, empty buckets — never 404); **the narrow-baseline
shape (D9): 200, `diff_available: false`, `baseline_too_old`, empty
buckets, and `diff_snapshots` never called** — assert the last by
mutation (drop the gate, require the fabricated `role` rows to appear); a
REMOVED field row reporting `affects_recorded_data: false` *by the
RESTRICT argument*, not by accident; `config-status` still passing
`frozenset()` and never resolving the real set; BOLA;
endpoint-coroutine coverage (the ASGI blind spot — httpx integration
alone does not register those lines). **Extract the discard suite's
fixture helpers** into a shared module rather than duplicating them.
**Regenerate `frontend/types/api/{openapi.json,schema.d.ts}` and commit
in the same commit** — T3's `satisfies Record<…>` reads the generated
union, and the `api-contract` CI job fails on drift. Record the D10(b)
`EXPLAIN` number in the PR body.

**T3 — The read-only tier view (frontend)**
D7, D8. `Sheet` + `Accordion type="multiple"` + `ScrollArea`; the
`satisfies Record<GeneratedUnion, CopyKey>` exhaustiveness pattern with a
runtime `??` fallback; a new `templateDiffKeys` family in the query-key
factory (CI-enforced); a **sibling test file** (the existing publish
suite is 698/800). Copy in `templateConfig.ts`. Tests must assert **each
tier group expands to rows** (not a count-only group) and that **all 14
copy keys are reachable from a rendered row**. Both non-diff shapes need
copy that cannot read as "no changes": `baseline_too_old` reuses the
`discardTooltipBaselineTooOld` framing; `initial_version` gets one key
(defensive only — migration 0004 plus `template_clone_service.py:214`
publish v1 in the same transaction make it unreachable today).

**T4 — Slice close**
Adversarial review → fixer → `make quality-scan` + `make test-backend`
(serial) → browser pass (open the view on a real multi-tier draft and
read it) → PR + auto-merge + watcher + memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; **`frontend/types/api/`
regenerated and committed** (the `api-contract` job fails on drift); no
new fitness offenders; backend suites never concurrent. **Frontend suite
with the worktree `.env` moved aside** (CI parity). **Backend tests must
not assume `python -m app.seed` ran.** Ordering/determinism guards are
proved **by mutation** — remove the rule, require N/N failures.

## Non-goals (all B-9b2b unless noted)

The per-item acks and their re-validation inside `acquire_publish_locks`;
the fingerprint and the drift phase (including the rule that a recompute
**clears every tick**); the republish request body and its blast radius
across five service call sites; migration 0052 and the version note
(plus the no-op-publish hole, and the fact that nothing displays a note
until B-9e); reconciling the two "recorded data" predicates; making the
engine carry reorder sequences; the option-rename wording problem; §6
reopen (B-9g); History (B-9e); the editor lock (B-9f); B-9x.

**Carried to B-9b2b (panel, 2026-08-09):** row order *within* a tier
bucket is unspecified — `SNAPSHOT_SQL` orders by `sort_order` with no
tiebreak (`extraction_snapshot.py:82`, `:88`) and `sort_order` is not
unique. Harmless for a read-only view, load-bearing the moment a
fingerprint, an `(id, tier)` ack round trip, or an item-enumerating
refusal exists. When B-9b2b needs the contract it must sort by the
**composite id** (provably unique), not by `(label_path, attribute,
option_code)`, which ties on duplicate section labels.
