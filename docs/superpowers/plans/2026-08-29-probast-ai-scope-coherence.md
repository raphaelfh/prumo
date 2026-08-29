---
status: in_progress
last_reviewed: 2026-08-29
owner: '@raphaelfh'
---

# PROBAST+AI scope coherence — implementation plan

**Goal:** make PROBAST+AI v2's Step-2 study-type classification load-bearing
across progress, AI calls, derivation and export, on an instrument-exact
five-answer signaling scale, delivered by a seed that actually converges.

**Architecture:** the rule is declared data (`scope_rules` on the template's
`schema_`, sibling of `derived_judgments`); each layer evaluates it where that
layer acts. One additive column (`allows_no_information`) turns the hardcoded
universal "No information" marker into a per-field opt-in like its NA/NE
siblings. The seed converges unconditionally so corrected template data reaches
an existing database.

**Design:**
[`2026-08-26-probast-ai-scope-coherence-design.md`](../specs/2026-08-26-probast-ai-scope-coherence-design.md)

## Global constraints

- `allows_no_information` is a boolean on `extraction_fields` with
  `server_default true`, and `true` at every absent-key default — the marker
  was universal before the column, so absent means "available".
- Seed 2.1.0 sets it `False` on all 95 fields; the shared `_PROBAST_SIGNALING`
  constant stays untouched (the five-answer list is v2-local).
- Required = the scope classifier + the 8 domain judgments + the 6
  applicability judgments; signaling questions and all text boxes are optional.
  The six conditional rows keep `allows_not_applicable`.
- Seed convergence is unconditional — no version compare. The template row is
  updated, never deleted; its children are replaced under deterministic ids.
- `backend/app/seed.py` sits EXACTLY at its file-size ratchet cap
  (`scripts/fitness/check_file_size.baseline`). Any edit there must be
  line-neutral or shrink.
- Alembic revision ids ≤ 32 chars; adding a migration bumps the
  `test_migration_roundtrip` head pin and the migration-head line in
  `docs/reference/extraction-hitl-architecture.md`.
- English only, conventional commits, PRs target `dev`.

## Delivery — PR train on `dev`

| PR | Content | State |
|----|---------|-------|
| PR1 | model + seed: the migration, `scope_rules` data, the NI answer, optionality, unconditional convergence, `2.1.0` | **shipped** |
| PR2 | backend consumers: scope helper, AI-path guard, payload state, export parity, run-view `general_instructions` | queued |
| PR3 | frontend: schema in selects, data-driven `studyTypeScope`, progress filtering, collapse and copy, banner and chip state, flag-gated NI in `FieldInput` | queued |
| PR4 | finalize backstop for divergence-without-rationale | queued |
| PR5 | `useProjectQATemplate` to TanStack Query | queued |

---

## PR1 — model and seed (shipped)

Delivered as three commits. What follows records the shape that shipped and,
where it departs from the design, why — five departures came out of an
adversarial panel review and are load-bearing for the queued slices.

### What shipped

1. **`0062_allows_no_information`** — additive boolean on `extraction_fields`,
   `server_default true`, threaded to its siblings' touchpoints: snapshot SQL,
   clone copy, `template_diff` (defaults map + SEMANTIC tier, which the
   discard/restore path derives from), and the `template_structure` /
   `template_portable` / `extraction_run` wire schemas.
2. **`disposition_to_marker` is flag-aware** — see departure D1.
3. **Seed 2.1.0** — `scope_rules` on `schema_`, the five-answer `_PAI_SIGNALING`
   list, `_SIGNALING_MAP["ni"] → Unclear`, optionality, `allows_no_information`
   off on all 95 fields, uuid5 field ids, and unconditional convergence behind
   a transaction advisory lock.

### Departures from the design, and why

**D1 — `disposition_to_marker` had to become flag-aware; the design does not
mention it.** ADR-0016 Phase 2 rewrites any in-band disposition string that
appears in a field's `allowed_values` into the coded marker, at both write
choke-points (`extraction_proposal_service`, `extraction_review_service`).
Putting `"NI"` back into `allowed_values` therefore turned every reviewer's and
every AI's NI answer into a `no_information` marker — which
`allows_no_information=False` then tells the form not to render. The answer
would silently vanish. The flag is now passed to the normalizer, which skips
the rewrite for its own disposition only; NA/NE on the same field still
normalize, and every caller that has not looked the flag up keeps the old
behaviour. ADR-0016 carries an amendment recording this.

**D2 — the new flag defaults `true` everywhere, unlike its siblings.** Its two
siblings default `false` at every absent-key default because they were always
opt-in. `no_information` was universal, so an absent key — a pre-0062 snapshot,
a bundle exported earlier, an update that omits it — means "the marker was
available". Copying the siblings' `false` would have retired the affordance
app-wide. Pinned by `test_migration_0062_round_trip` (the column default),
`test_no_information_default_is_true_unlike_its_siblings` (the diff map),
`TestNoInformationDefault` (the wire schemas) and an
`apiSchemaDrift` case (the generated contract).

**D3 — PR1 *is* an API contract change.** The design assigns "the train's one
contract change" to PR2, but four OpenAPI-exposed schemas move here, so
`frontend/types/api/{openapi.json,schema.d.ts}` are regenerated and committed in
PR1 or the `api-contract` CI job fails on drift.

**D4 — no new `_field` / `_signaling` keyword.** `backend/app/seed.py` is
exactly at its file-size ratchet cap, and the flag is uniform across all 95
fields, so it is set in `seed_probast_ai`'s build loop instead. The only
`seed.py` edits are line-neutral: `_signaling`'s `allowed` annotation widened to
`list[Any]`, plus comment corrections.

**D5 — field ids are now derived (`uuid5(entity_type_id, name)`).** `_field`
never set `id`, so `UUIDMixin` minted a `uuid4` — meaning convergence would
churn 95 global UUIDs per deploy and the design's "deterministic UUIDs, same
data → same rows" was false for fields. Deriving them makes the claim true and
lets the integration test assert identity rather than content equality.

### Open finding for PR2/PR3 — the adoption story does not hold

`ProjectExtractionTemplate.schema_` has exactly ONE writer
(`template_clone_service.py:226`, at clone creation). The re-import branch heals
structure counts, republishes and re-activates, but never rewrites `schema_`.
So the design's "existing clones adopt on re-import" is false: an existing
v2.0.0 clone can never receive `scope_rules`, and only an explicit delete plus a
fresh import installs it. PR2/PR3 must either refresh `schema_` on the re-import
heal or state the delete-and-reimport requirement in the UI. Nothing in PR1
depends on it.

---

## PR2–PR5 (queued)

- **PR2 — backend consumers.** `out_of_scope_sections(schema, values_by_coord)`
  and `scope_filtered_values` in `derived_judgment_service`; the AI-path guard
  at the single eligible-field assembly point in `section_extraction_service`,
  resolving the classifier from the run's newest proposal on the classifier
  coordinate; `state="out-of-scope"` stamped by `derived_judgment_payload`
  (wire contract — assert the literal); export parity via
  `scope_filtered_values` before `compute_derived_judgments`; the run view's
  nullable `general_instructions`, read through the same
  `general_instructions_for_version` the prompts call (regenerate
  `frontend/types/api/*` and the hand-mirrored `hooks/runs/types.ts`).
- **PR3 — frontend.** `schema_` added to the template selects in
  `qaTemplateService` and the shared project-template query; `studyTypeScope`
  rewritten data-driven (`outOfScopeSections(scopeRules, studyTypeValue)`);
  progress filtered by filtering the `entityTypes` projection at the two QA call
  sites, with `computeRequiredFieldProgress` itself untouched; collapsed muted
  out-of-scope sections that stay editable; the "Not applicable" banner and chip
  state; the Step-1 PICOTS disclosure; flag-gated NI in `FieldInput` plus the
  config-editor toggle. Also carries the `allows_no_information` copy key in
  `TemplateConfigDiffSheet`'s `ATTRIBUTE_COPY`, and the hand mirror in
  `hooks/runs/types.ts` + `runViewAdapters.ts`, which PR1 deliberately left to
  the slice that reads them.
- **PR4 — finalize backstop.** `DivergenceRationaleError` raised in
  `RunLifecycleService.advance` at `target == FINALIZED`, from
  `build_derived_judgments_payload` over the published states.
- **PR5 — `useProjectQATemplate` to TanStack Query.**
