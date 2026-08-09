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
  (`:273`, `:280`) — including the literal `"None"`. All eleven emission
  sites wrap it in `_as_uuid(...)`, and `TemplateChange.node_id` is typed
  `UUID | None` (`:194`) with **four live consumers** treating it as a
  `UUID` in `template_discard_service.py` (`:301`, `:306`, `:377`,
  `:655`). Adding a parallel `raw_node_id: str` is the non-invasive
  route; retyping forces five call sites.
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
  consumers. AlertDialog is wrong here (no scroll container; its
  description wrapper would nest interactive rows in a `<p>` role).
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

## Decisions (proposed; panel to ratify)

- **D1 — 14 variants, exhaustiveness enforced.** The wire enum covers all
  14, and a test asserts every `TemplateChange` the engine can emit maps
  to exactly one variant **and** that no variant is unreachable — in the
  style of the existing `ATTRIBUTE_TIERS`-vs-`SNAPSHOT_SQL` assertion, so
  a future engine change fails loudly instead of falling into a catch-all.
- **D2 — `raw_node_id: str` is added alongside `node_id`**, not a retype.
  The composite id is minted from the raw string (with `"template"`
  reserved for the instruction row); the four `UUID`-typed consumers in
  the discard service are untouched.
- **D3 — Only the opaque attributes render server-side.**
  `validation_schema`, `allowed_units` and `parent_entity_type_id` get
  `before_display`/`after_display` strings (never an id on screen);
  booleans and scalars ship typed (`str | int | bool | None`, never
  `Any`) and the copy layer renders them. Rendering everything
  server-side would satisfy the no-`Any` rule while silently forking the
  i18n boundary — the repo rule is that user-facing text lives in
  `frontend/lib/copy`.
- **D4 — A new module for the read model.** `template_diff.py` has no
  room; the wire enum, the renderers, the post-pass and (in B-9b2b) the
  fingerprint live in a sibling (`template_diff_read.py`), importing the
  engine rather than growing it.
- **D5 — The resolver becomes
  `ExtractionFieldReferenceRepository.fields_with_recorded_work`** (plain
  `self.db` class form), with **both** call sites re-pointed — the
  discard gate and the diff read — so the two cannot diverge.
- **D6 — Name the section discrepancy, do not paper over it.**
  `affects_recorded_data` for an entity type is derived from child-field
  values; a section owning instances is a *different* predicate that
  Discard uses. Until they are reconciled the read model exposes the
  field-derived flag only, and the copy must not imply it covers
  instances. Reconciling them is explicitly B-9b2b's or a follow-up's
  problem, recorded here so nobody assumes it is done.
- **D7 — The consumer is a read-only tier view.** The sheet opens from
  the chip cluster, renders the four tier groups (additive and cosmetic
  collapsed with counts, semantic expand-to-view, destructive listed with
  the recorded-work badge), and has **no checkboxes, no note field, and
  no Publish action of its own** — Publish stays where it is and behaves
  exactly as today. This ratifies the wire model on screen before
  anything mutates.
- **D8 — Honest copy for what the engine cannot say.** Reorder rows say
  only "N items reordered" and the two variants must not share a
  sentence that implies the same arithmetic. `validation_schema` rows
  must not claim a downstream effect. No per-option claim, and never the
  word "answers" — the union includes AI and system proposals, so the
  honest phrase is "recorded extraction work".

## Tasks (subagent-driven, TDD per task)

**T1 — Composite id + the 14-variant wire model (backend, pure)**
D1, D2, D3, D4. Unit tests only: id uniqueness across every emission
site (including two option removals on one field, two fields losing the
same code, junk/absent ids, the instruction row); id stability across
recomputation with dicts whose keys were inserted in opposite orders;
the exhaustiveness assertion; a renderer-facing case per variant proving
the client needs no knowledge of the `before`/`after` overloading; and
that no field on the read model is typed `Any`.

**T2 — Resolver promotion + `GET config-diff` (backend)**
D5, D6, and the `affects_recorded_data` post-pass. Re-point both call
sites; the discard suite must stay green. Integration tests: a draft with
all four tiers; a field with recorded values flipping a tier while the
**total** still matches the chip's count; the no-baseline shape (200,
`initial_version: true`, empty buckets — never 404); `config-status`
still passing `frozenset()` and never resolving the real set; BOLA;
endpoint-coroutine coverage. **Extract the discard suite's fixture
helpers** into a shared module rather than duplicating them.

**T3 — The read-only tier view (frontend)**
D7, D8. `Sheet` + `Accordion type="multiple"` + `ScrollArea`; the
`satisfies Record<GeneratedUnion, CopyKey>` exhaustiveness pattern with a
runtime `??` fallback; a new `templateDiffKeys` family in the query-key
factory (CI-enforced); a **sibling test file** (the existing publish
suite is 698/800). Copy in `templateConfig.ts`.

**T4 — Slice close**
Adversarial review → fixer → `make quality-scan` + `make test-backend`
(serial) → browser pass (open the view on a real multi-tier draft and
read it) → PR + auto-merge + watcher + memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders;
backend suites never concurrent. **Frontend suite with the worktree
`.env` moved aside** (CI parity). **Backend tests must not assume
`python -m app.seed` ran.**

## Non-goals (all B-9b2b unless noted)

The per-item acks and their re-validation inside `acquire_publish_locks`;
the fingerprint and the drift phase (including the rule that a recompute
**clears every tick**); the republish request body and its blast radius
across five service call sites; migration 0052 and the version note
(plus the no-op-publish hole, and the fact that nothing displays a note
until B-9e); reconciling the two "recorded data" predicates; making the
engine carry reorder sequences; the option-rename wording problem; §6
reopen (B-9g); History (B-9e); the editor lock (B-9f); B-9x.
