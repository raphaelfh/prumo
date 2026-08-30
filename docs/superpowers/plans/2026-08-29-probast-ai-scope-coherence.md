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
| PR2 | backend consumers: scope helper, AI-path guard, payload state, export parity, run-view `general_instructions` | **shipped** |
| PR3 | frontend: `schema` in the selects, data-driven `studyTypeScope`, progress filtering, the out-of-scope render across its three sites, AI button and muted title | **shipped** |
| PR4 | finalize backstop for divergence-without-rationale | **shipped** |
| PR5 | `useProjectQATemplate` to TanStack Query | dropped — see below |

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

### Open finding for PR2/PR3 — the adoption story does not hold — CLOSED

`ProjectExtractionTemplate.schema_` had exactly ONE writer (at clone
creation), so the design's "existing clones adopt on re-import" was false and
only a delete plus a fresh import installed `scope_rules`. **Closed by #738**:
`template_clone_service.py:193` now re-syncs `schema_` from the global on every
re-import heal (copied, not aliased). No action left for PR3.

---

## PR2 (shipped) and PR3 (shipped)

- **PR2 — backend consumers** (#739). `out_of_scope_sections` /
  `scope_filtered_values` in `derived_judgment_service`; the AI-path guard in
  `llm_field_filter`; `state="out-of-scope"` stamped by
  `derived_judgment_payload`; export parity through the same filter; the run
  view's nullable `general_instructions`.
- **PR3 — frontend.** `schema` added to `loadProjectQATemplate`'s select and to
  `ProjectTemplateRow`'s type (the shared query already fetched it);
  `studyTypeScope` rewritten data-driven (`outOfScopeSectionsOnForm` /
  `outOfScopeSectionsOnRow` over `outOfScopeSections`); worklist progress
  filtered via `lib/qa/scopedProgress`; the out-of-scope render across its
  three sites (the derived chip's badge, hint and breakdown rows; the overall
  banner's badge, tooltip, remediation paragraph and breakdown rows; the
  in-section summary badge); the section AI button hidden and the section title
  muted out of scope.

### Corrections the execution surfaced

Three premises in §3 of the design did not survive contact with the code, and
the sentences that state them should be read as pre-PR1 artifacts:

- **"the two QA call sites (form header, `HITLArticleTable` per row)" — there
  is ONE.** The QA run form header passes a hardcoded `{completed: 0, total: 0,
  pct: 0}` and `RunStatus` hides the counter when `total === 0`, so filtering it
  is a no-op; the QA dashboard computes `started / totalArticles` and never
  consults requiredness at all. `HITLArticleTable` is the only live QA
  required-field percentage.
- **Problem #1's numbers are pre-PR1.** "All 49 fields of the evaluation part
  are `is_required=True`" and "~52%" were true before PR1 cut requiredness to
  15 fields. Post-PR1 a completed single-part assessment read **8/15 = 53%**;
  after PR3's filtering it reads 8/8.
- **Out-of-scope sections were already collapsed on mount**, because only
  `idx === 0` (`assessment_scope`, never excluded) gets `defaultOpen`. The
  spec's "renders collapsed by default" was therefore dropped as a near no-op;
  only the muted title shipped. The residual it leaves — re-collapsing a
  section the reviewer already opened when they reclassify — was judged not
  worth the state it would add.

### Dropped, with reasons

- **The `allows_no_information` toggle in the template-config field inspector.**
  The inspector is extraction-only by construction (`TemplateConfigEditor`
  mounts solely from `ExtractionInterface`, whose list is filtered
  `kind: 'extraction'`; documented at `TemplateGrid.tsx:718-722`), so it can
  never reach PROBAST+AI — the one template that uses the flag. On the
  templates it *can* reach, the only thing the toggle enables is switching off
  a disposition ADR-0016 keeps available by default. Two real defects in the
  same area (the lossy field-delete Undo, and the now-false
  `dispositionBuilderHint` copy) are extraction-side and spun out separately.
- **PR5, `useProjectQATemplate` → TanStack Query.** Its stated justification —
  "a file PR3 has to touch anyway" — is false: PR3 touches
  `qaTemplateService.ts` and `useQATemplate.ts`, not that hook. It is a
  behaviour-preserving rewrite with no forcing function, and migrating one of
  three sibling hand-rolled hooks in `hooks/qa/` is half a cleanup. Pay the
  pattern debt for the directory at once, when something needs cache sharing.

## PR4 — finalize backstop (shipped)

`DivergenceRationaleError` raised in `RunLifecycleService.advance_stage` at
`target == FINALIZED`, from `build_derived_judgments_payload` over the
published states. The rule lives in its own module,
`app/services/qa_divergence_gate.py`; the error class sits beside its siblings
`EmptyFinalizeError` / `IncompleteFinalizeError`, because subclassing
`InvalidStageTransitionError` from inside the gate module would close an import
cycle. The gate is kind-neutral as designed — a template with no
`derived_judgments` exits after one `db.get`, so extraction runs need no
`kind ==` branch.

Its value was underrated, not overrated: the client-side gate lives only in
`QASectionAccordion.handleJudgmentChange`, and the surface where a manager
actually resolves divergence — `ConsensusResolutionPanel` — has **no
divergence gate at all**. So the unguarded path is not "someone crafting a
POST", it is normal use. Closing the client gaps is a separate slice (below).

### Departures from the design

**D6 — the status is 400, not 422.** §5 says the new subclass reaches "the
existing 422 envelope". It does not: `InvalidStageTransitionError` maps to
**400** at both finalize entry points (`extraction_runs.py:413` on `/advance`,
`:481` on `/approve-finalize`), and 422 in that router belongs to
`CoordinateMismatchError` alone. The two existing finalize gates are 400 for
the same reason. Shipped as 400 — consistent with its siblings and requiring
no endpoint change, which is what "reuse the existing envelope" was actually
asking for. Getting 422 would mean a new `except` ahead of the base one at two
call sites and a contract split between sibling gates.

**D7 — the emptiness predicate is bespoke, not `is_value_filled`.** The shared
predicate calls `"  "` filled and calls any disposition marker filled, both
pinned by tests. The client's `rationaleIsEmpty` trims and treats a marker as
empty. `is_value_filled` diverges in the lenient direction, so it would have
been safe but wrong; `qa_divergence_gate._rationale_is_empty` mirrors the
client instead, which is the invariant that matters (the backstop must never
be stricter than the form that fed it).

**D8 — no database reset, and none was needed.** Zero QA runs are at
`consensus` and every non-finalized run has zero published states, so the gate
can strand nothing. The refusal names the coordinate (the recommendation's own
label, e.g. "Development D1: quality") and the surface that fixes it
("Resolve divergence", the panel's own title) — a 400 at the last action of a
long workflow that does not say where to type the rationale is a dead end.

**D9 — the line budget.** `run_lifecycle_service.py` sits exactly at its
`check_file_size.baseline` cap and may not grow. The call site was paid for by
collapsing two byte-identical inline `SELECT … FOR UPDATE` blocks onto
`load_run_for_update`, the helper the file already imports and already uses
twice — the house pattern in four sibling services. `_judgment` became public
as `judgment_of` in the same pass: PR4 makes it a cross-module contract, and
this repo imports a private name across modules exactly once.

### Recorded for their own work

- **Close the client-side divergence gaps (UX slice).** PR4 makes the data
  integrity real; it does not make the experience good, because every gap
  below now surfaces as a 400 at finalize instead of a prompt at the moment of
  the pick. In rough order of exposure: `ConsensusResolutionPanel` /
  `ConsensusOverrideEditor` publish any judgment with an empty rationale and
  label the box "Rationale (optional)" — the very control the 400 demands; the
  paired rationale on the reviewer's form renders through an ungated
  `renderFieldInput`, so it can be cleared after the divergence was confirmed;
  a divergence hydrated from an earlier session is annotated but never
  blocked; and a "No information" marker bypasses the pick gate as an object
  envelope while the backend reads it as a judgment (unreachable on
  PROBAST+AI today, which seeds `allows_no_information` false, but live for
  any other v2-shaped template).

- **QA templates have no AI-instruction surface.** `TemplateInstructionControl`
  is mounted only inside the extraction-only editor, and the QA Configuration
  tab offers per-tool switches only — yet every seeded applicability prompt
  tells the model to judge "as stated in the review's general instructions (the
  Step-1 PICOTS)". So AI applicability proposals are made against a
  `[customize: …]` placeholder no QA manager can see or fix. The design's
  Step-1 PICOTS disclosure was **not** implemented as specified because its
  null-state copy points the user at that unreachable screen; the underlying
  defect deserves its own design pass.
- **Instrument fidelity of the free-text boxes.** The 34 signaling questions
  and 14 judgments are verbatim-correct against the source with zero extras and
  zero gaps. The losses are all in the describe prompts, and they matter because
  `_describe` interpolates the prompt straight into `llm_description`: a dropped
  phrase is a fact the AI is never asked to extract, from boxes PROBAST+AI
  defines as the evidence its signaling questions are answered on. Seven of the
  eight Domain-4 prompts, both D2 prompts and both D3-applicability prompts lose
  something the form names — the candidate-predictor counts, events per
  predictor, the optimism adjustment, classification or risk group definition,
  the EXTENT of missing data rather than only its handling, and the
  per-component frequencies of a composite outcome, which no field among the 95
  asks for. Fixed separately in seed 2.2.0; not part of this train.

  Two adjacent findings were REJECTED after re-derivation, both non-defects, and
  should not be re-opened: evaluation D4's describes-after-signaling order is a
  layout deviation published in the item map and in the 2026-08-22 spec (only
  the module docstring over-claimed), and the `llm_description` on the 6
  applicability rationales but not the 8 judgment rationales is the spec's own
  AI-affordance rule — each rationale follows its own judgment, and the
  applicability judgment is AI-proposable while the quality/RoB judgment is not.
