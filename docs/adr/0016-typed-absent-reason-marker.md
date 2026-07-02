---
status: accepted
last_reviewed: 2026-07-02
owner: '@raphaelfh'
adr_number: '0016'
---

# Typed `absent_reason` marker for missing values

> **Status:** Accepted · Date: 2026-06-30 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A
> **Amends:** constitution §IX (abstention encoding); refines the emptiness
> semantics behind [ADR-0009](0009-extraction-finalize-completeness-gate.md) /
> [ADR-0015](0015-finalize-via-approve-publish.md) (the gate is unchanged; a
> marker-carrying value now counts as *filled*).

## Context and Problem Statement

A `(instance, field)` value can mean three things the stack collapses into the
same empty/`null`: **(a)** the AI abstained, **(b)** the field is untouched or
cleared, and **(c)** the source *affirmatively* does not state the item — a
real answer in evidence synthesis. Today (c) is half-represented by carrying
the literal string `"No information"` as a select `allowed_value`
(`backend/app/seed.py`), which only works because those fields are selects. A
required **numeric / date / free-text** field the source doesn't report has no
such option and cannot hold the string, so it is stuck at `null` → blocks
finalize → indistinguishable from "untouched".

Storing a disposition *as* the value is the REDCap "Missing Data Codes"
anti-pattern (typed consumers break; codes collide with real values;
numeric/date exports corrupt). Every durable clinical-data standard we
researched instead keeps the value type-correct and carries the reason in a
**separate coded sibling**: HL7 FHIR `dataAbsentReason`, CDISC SDTM
`--STAT`/`--REASND`, OMOP `concept_id 0` + `*_source_value`. The systematic-
review field (Cochrane Handbook §5.4.3, Covidence) is unanimous that "not
reported" must be a first-class recorded answer, never a blank.

## Decision Drivers

- Uniformity across **all** field types, including numeric/date (the gap).
- No legacy: one representation, no permanent read-shim, no FE/BE drift.
- Type-correct, collision-proof, machine-typed exports.
- Preserve the finalize gate's "a human resolves every required field" rule
  (ADR-0009/0015) and constitution §IX traceability.

## Considered Options

- **A — Type-independent coded marker in a sibling key**
  (`{value:null, absent_reason:<code>}`), value stays type-correct. *(chosen)*
- **B — Overload the value** (literal `"No information"` string / sentinel for
  all types). Rejected: the REDCap anti-pattern — breaks numeric/date typing
  and export, collides with real values.
- **C — Domain option only (status quo)**, marker for nothing. Rejected: leaves
  the numeric/date gap and the two-representations conflation.
- **Integration M1 (marker only for non-select types) vs M2 (canonical for all,
  selects map onto it).** Chose **M2** — M1 permanently enshrines two shapes for
  one concept.

## Decision Outcome

Chosen: **A + M2.** A closed enum `absent_reason ∈ {no_information,
not_applicable, not_evaluated}` in the value envelope; the value stays
type-correct (`null` when absent). `is_value_filled` (the single emptiness
oracle, `value_semantics.py`) treats a non-empty `absent_reason` as **filled**;
a bare `{value:null}` stays **empty/unresolved**. The frontend routes all
emptiness/abstention checks through one shared predicate mirroring the backend,
cross-checked by a shared test vector.

Precise semantics:

- **`no_information`** is available on every field; **`not_applicable`** and
  **`not_evaluated`** are opt-in per field. `"Unclear"` stays a substantive
  value.
- **AI abstention is a first-class acceptable proposal**
  (`{value:null, absent_reason:"no_information"}`) the reviewer accepts in one
  click — not bare `null` (**amends §IX**, `constitution.md:154`). The gate
  stays safe: it counts only human decisions / published values, so a bare AI
  proposal never self-satisfies a required field. Only `not_found` (not
  `ambiguous`) maps to the marker. `not_applicable` / `not_evaluated` are
  **human-only** dispositions (the LLM enum cannot express them once the codes
  leave `allowed_values`).
- **Consensus:** distinct answers — different codes diverge (full-envelope
  agreement key already gives this).
- **Migration:** a one-time Alembic backfill rewrites stored disposition values
  → the marker across proposals / decisions / published state, **including
  finalized runs** — covering **both** encodings (full-word `"No information"` /
  `"Not applicable"` / `"Not evaluated"` **and** PROBAST abbreviated `NI` / `NA`,
  `seed.py:155`). Scoped by each run's **frozen template version snapshot**
  (`version.schema_`), never a live-field or blind-string match, so no
  legitimate value is touched and finalized history stays lossless. The
  transitional read-shim is then removed (no permanent legacy).

Delivered in phases, all shipped to production 2026-07-01/02: Phase 0
marker-aware readers (#458), Phase 1 write contract + AI marker (#460), Phases
2–3 template/select unification + data migration `0039_absent_reason_backfill`
with read-shim removal (#462), Phase 4 export/reviewer-compare/UX (#466);
Phase 5 docs closes with this amendment (constitution §IX amended, v2.2.0).
Full design, per-layer detail, and test strategy:
[`docs/superpowers/specs/2026-06-30-no-information-representation-design.md`](../superpowers/specs/2026-06-30-no-information-representation-design.md).

### Consequences

- Good — one uniform, type-correct, standards-aligned representation across all
  field types; the numeric/date "not reported" gap is closed; exports render a
  clear label per disposition; FE/BE emptiness can no longer drift.
- Good — a required field answered "no information" now finalizes as a resolved
  answer instead of stranding the run.
- Bad — a cross-stack change (write-path contract + a data migration touching
  finalized history) and a residual blind-accept-all risk on AI abstentions,
  mitigated by UX (distinct rendering, excluded from silent bulk accept) rather
  than a blocking bare-null.
- Neutral — three codes only (not FHIR's fifteen); `ambiguous` status stays a
  needs-attention proposal (a noted future refinement).

## Validation

- `value_semantics` unit table (marker ⇒ filled; bare null ⇒ empty), shared
  FE/BE vector.
- Finalize-gate test: numeric resolved to `no_information` finalizes; bare null
  still blocks; an unaccepted AI marker does not satisfy the gate.
- Autosave no-regression (hydrated marker not re-POSTed on mount).
- Consensus (same code agrees, different codes diverge), dedup recency, export
  label rendering, and an `allowed_values`-scoped migration verified offline
  (`--sql`) both directions.

## More Information

- Design spec: `docs/superpowers/specs/2026-06-30-no-information-representation-design.md`
- Constitution §IX: `docs/reference/constitution.md`
- Emptiness oracle: `backend/app/services/value_semantics.py`
- Finalize gate: `backend/app/services/run_lifecycle_service.py`
