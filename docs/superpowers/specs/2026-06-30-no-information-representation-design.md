---
status: shipped
last_reviewed: 2026-07-02
owner: '@raphaelfh'
---

> **Status:** Shipped — Phases 0–4 delivered to production 2026-07-01/02
> (#458 marker-aware readers, #460 write contract + AI marker, #462
> template/select unification + migration `0039_absent_reason_backfill`,
> #466 export/reviewer-compare/UX); Phase 5 docs closed with the
> [ADR-0016](../../adr/0016-typed-absent-reason-marker.md) acceptance and the
> constitution §IX amendment (v2.2.0). Retained as the design record —
> design direction was approved in brainstorm 2026-06-30 (two adversarial
> analysis passes + a prior-art research pass: FHIR `dataAbsentReason`,
> CDISC SDTM, OMOP, REDCap, Cochrane §5.4.3).

# Design: Type-independent "no information" representation (`absent_reason` marker)

## Summary

A field value in prumo can mean three different things that the code today
collapses into the same empty/`null`:

- **(a) abstention** — an AI run examined the field and found nothing;
- **(b) untouched / cleared** — nobody has provided a value;
- **(c) a domain "No information" answer** — the source *affirmatively* does
  not state the item (a real, first-class finding in evidence synthesis).

The current design half-represents (c) by carrying the literal string
`"No information"` as a select `allowed_value`
([`backend/app/seed.py:148-151`](../../../backend/app/seed.py)) — which is the
**REDCap "store the code as the value" anti-pattern**. It works only because
those fields are selects; it does **not** generalize to **numeric / date /
free-text** fields, which have no such option and cannot hold the string. A
required numeric the source doesn't report (e.g. "sample size: not reported")
is therefore stuck at `null` → blocks finalize → with no clean, finalizable
"the source is silent" answer, and no way to tell it apart from "untouched".

This spec adopts the durable pattern used by every clinical-data standard we
researched — **keep the value type-correct (`null`) and carry the disposition
in a separate coded sibling** — as a single, uniform, type-independent marker:

```jsonc
{ "value": <typed value | null>, "absent_reason": "no_information" | "not_applicable" | "not_evaluated" }
```

`absent_reason` present ⇒ the coordinate is a **resolved** answer (satisfies the
finalize completeness gate); a bare `{ "value": null }` (no marker, no decision)
stays **unresolved** (blocks). This closes the numeric/date gap, unifies the
representation across all field types, retires the string hack (no legacy), and
makes the abstention a first-class, acceptable AI proposal a reviewer confirms
in one click.

## Prior art (why a separate coded marker, not an overloaded value)

| Standard | Mechanism | Value stays typed? | Numeric/date? |
|---|---|---|---|
| **HL7 FHIR** `dataAbsentReason` | value omitted + sibling coded reason (15-code set) | yes | yes |
| **CDISC SDTM** "Tests Not Done" | result `NULL` + `--STAT="NOT DONE"` + `--REASND` (separate columns) | yes | yes |
| **OMOP/OHDSI** | `concept_id = 0` + raw kept in `*_source_value` | yes | yes |
| **REDCap** Missing Data Codes | code stored **as the literal value** (in-band) | **no** — breaks numeric/date export | fragile |
| **Cochrane §5.4.3 / Covidence** | "not reported"/"not applicable"/"unclear" as explicit answer options | n/a (all selects) | does not generalize |

Two settled conclusions:

1. **The durable pattern is a separate coded reason with a type-correct value**
   (FHIR / CDISC / OMOP). REDCap's in-band sentinel is the documented
   cautionary anti-pattern (typed consumers choke; codes collide with real
   values; numeric/date exports break). **prumo's current select
   `"No information"` value is that anti-pattern.**
2. **The SR field is unanimous on the *principle*:** "not reported" must be a
   first-class recorded answer, never a blank (Cochrane Handbook §5.4.3:
   *"Include 'not applicable', 'not reported' and 'cannot tell' options"*).
   This backs constitution §IX and the goal of counting it as **resolved**,
   not empty.

Full research (value sets, sources) is captured in the brainstorm workflow
outputs; the minimal closed vocabulary chosen for prumo is three codes, not
FHIR's fifteen (YAGNI for evidence extraction).

## Decisions (owner-approved 2026-06-30)

1. **Unification model M2** — the marker is canonical for **all** field types;
   the select `"No information"` / `"Not applicable"` / `"Not evaluated"`
   options map onto it. One representation everywhere (no dual shape left
   behind).
2. **Migrate all runs, incl. finalized (lossless).** A one-time Alembic data
   migration rewrites stored `{value:"No information"|"Not applicable"|"Not
   evaluated"}` → the marker across proposals, reviewer decisions, and
   published state, so historical exports stay correct and a transitional
   read-shim can be removed (no permanent legacy path).
3. **AI abstention is a first-class acceptable input.** The AI records
   `{value:null, absent_reason:"no_information"}` (with its rationale) as a
   proposal the reviewer **accepts in one click** — *not* bare `null`.
   Constitution §IX is amended accordingly (see below).
4. **Phased delivery**, sequenced so each phase is green + shippable and agents
   run in a clean order (see Phased plan).
5. Spec must also cover: no-legacy/maintainability, reviewer comparison,
   template configuration, export, and extraction + QA UX (all below).

Follow-up clarifications:

- **Template model:** `no_information` is available on **every** field
  automatically (any source can be silent, incl. numeric/date);
  `not_applicable` and `not_evaluated` are **opt-in per field** where
  meaningful. `"Unclear"` stays a **substantive select value** ("present but
  ambiguous" ≠ absent), not a disposition.
- **Reviewer comparison:** distinct answers — different `absent_reason` codes
  diverge; same code agrees; a marker vs a substantive value diverges
  (consistent with the existing full-envelope agreement key).

## The canonical representation

### Envelope

```jsonc
// a real value (unchanged)
{ "value": "Retrospective cohort" }
{ "value": 240, "unit": "days" }
// a resolved "no information" answer (any field type)
{ "value": null, "absent_reason": "no_information" }
// not applicable / not evaluated (opt-in fields)
{ "value": null, "absent_reason": "not_applicable" }
{ "value": null, "absent_reason": "not_evaluated" }
// unresolved — untouched, or an unaccepted proposal, or a rejected decision
{ "value": null }   // (or absent coordinate entirely)
```

- `absent_reason` is a **closed enum**: `no_information | not_applicable |
  not_evaluated`. Defined once in the backend and mirrored to the FE via the
  generated API types (never hand-mirrored).
- The value stays **type-correct** — `null` for a silent numeric/date, never a
  string sentinel. Collisions are structurally impossible.

### Semantics — one rule, one place

`backend/app/services/value_semantics.py` is the single emptiness oracle
(centralized in #454). It gains the marker concept in ~one predicate:

- `is_value_filled(raw)` ⇒ **True** when, after peeling one `{value}` envelope,
  the value is non-empty **OR** the envelope carries a non-empty
  `absent_reason`.
- `is_value_empty` stays its exact inverse.
- A new helper `value_absent_reason(raw)` returns the code (or `None`).

Because the finalize gate ([`run_lifecycle_service.py:372-453`](../../../backend/app/services/run_lifecycle_service.py))
and the suggestion dedup
([`extraction_suggestion_read_service.py:199-216`](../../../backend/app/services/extraction_suggestion_read_service.py))
both delegate emptiness to this oracle, they inherit the marker correctly with
no local change beyond the two deliberate calls below.

The **frontend gets one shared predicate module** mirroring the backend rule
1:1 (`frontend/lib/extraction/valueSemantics.ts`), replacing the three
open-coded copies that drift today:

- `frontend/lib/ai-extraction/suggestionUtils.ts:171` `isNoInfoValue` →
  re-expressed via the shared predicate and **renamed `isAbstention`** (it tests
  the abstention *shape*, so a real value never masquerades as one);
- `frontend/lib/extraction/progress.ts:127` + `computeRowProgress` inline
  checks → the shared predicate (or the progress bar diverges from the gate —
  the "40%, can't submit" bug class the file's own docstring warns about);
- `frontend/lib/ai-extraction/valueParser.ts` `extractValue` / `isEmptyValue`
  → fold into the shared module.

A **shared cross-checked test vector** is asserted identically by
`backend/tests/unit/test_value_semantics.py` and the new FE
`valueSemantics.test.ts`, so the two implementations are *mechanically* kept in
lock-step (replacing today's "the docstring says they mirror"). The vector must
cover **all three shapes** that coexist during the migration window: (1) marker
`{value:null, absent_reason:X}` ⇒ filled/abstention; (2) a legacy disposition
string as a select value ⇒ filled (until Phase 3); (3) bare `{value:null}` / `''`
⇒ unresolved.

### Carrying `absent_reason` end-to-end on the frontend

The FE predicate consolidation is necessary but **not sufficient** — today every
FE unwrap peels `{value}` and **discards** the sibling key, so a marker cannot
round-trip:

- `frontend/services/aiSuggestionService.ts:47` `unwrapValue` → `raw['value'] ?? ''`
- `frontend/services/extractionValueService.ts:27` → `raw.value ?? null`
- `frontend/lib/ai-extraction/valueParser.ts:14,20` `extractValue` → `value.value`
- `frontend/components/runs/ConsensusPanel.tsx:115` — a **fourth** open-coded
  `{value}` peel on the divergence-display surface.

So the FE must carry the marker as data, not collapse it:

- The `AISuggestion` model keeps `absent_reason` (from the full
  `proposed_value` envelope); `isAbstention` and the no-info card read the
  **code**, not the unwrapped scalar, so `no_information` / `not_applicable` /
  `not_evaluated` render distinctly.
- The **form in-memory value** for a resolved disposition is the **full
  envelope** `{value:null, absent_reason:<code>}` (not a bare `null`), and the
  autosave **baseline is built from the same un-peeled shape**, so R7 holds
  (baseline == current on mount; editing an adjacent field never restripes the
  marker coord). `extractValueForSave` → `writeRunFieldValue` thread
  `absent_reason` (Phase 1 write contract).
- `progress.ts` currently **pre-unwraps** into `valueMap` (`:126-136,192-200`)
  *before* the emptiness test — the shared predicate must instead receive the
  **raw envelope** (peel-and-test in one place, matching the backend), or the
  marker is stripped before the predicate sees it and the shared vector passes
  while the real call site is wrong.
- Audit every remaining `"value" in` peel (grep) and route it through the
  shared module.

### Gate safety (why this does not weaken finalize)

The finalize gate only ever counts **human decisions and published values**,
never raw AI proposals — verified: `_filled_coords` requires an
`ExtractionReviewerState` / `ExtractionPublishedState` row
([`run_lifecycle_service.py:372-399`](../../../backend/app/services/run_lifecycle_service.py)),
created only by `record_decision`. So an AI-proposed
`{value:null, absent_reason:"no_information"}` **cannot self-satisfy** a
required field; a human must accept it (exactly like the select
`"No information"` flow today).

The residual risk of decision #3 (an AI abstention that looks acceptable being
**blind accept-all'd** — e.g. a parser silently dropping a section, producing
8 fabricated "not reported" findings) is addressed in the **UX section**
(abstention proposals rendered visibly distinct, no confidence badge, not
silently bundled into a one-click bulk accept), not by re-introducing a
blocking bare-null. This is the deliberate trade the owner chose.

## AI recording change (constitution §IX)

Today the recording loop
([`section_extraction_service.py:1416-1492`](../../../backend/app/services/section_extraction_service.py))
coerces `inner_value = None` on the abstention branch (`value is None` or
`status ∈ {not_found, ambiguous}`) and writes bare `{value:null}`.

New behaviour (Phase 1 **splits** the `is_no_info` predicate at
`section_extraction_service.py:1431-1433`, which today folds `not_found` **and**
`ambiguous` into one bare-null branch):

- **`status = not_found` / `value = None`** → record
  `{value:null, absent_reason:"no_information"}` (keep the rationale; evidence
  stays absent). This is the acceptable AI abstention proposal (decision #3).
- **`status = ambiguous`** ("present but conflicting") is **not** "absent" and
  must **stop sharing** the abstention branch: it stays a needs-attention
  proposal — a `found`-style value with low/zero confidence and **no marker**,
  so it still blocks the gate; where the field offers `"Unclear"` the model may
  pick that substantive value. On a field with no `"Unclear"` option, ambiguous
  persists as a low-confidence proposal with **no** `absent_reason` (never
  silently collapsed to `no_information`). A recording test pins that ambiguous
  gets no marker.
- A **`found`** value (incl. an in-domain `"No information"` select code with a
  supporting quote) flows as a normal value through the entailment gate; the
  select-mapping step (Phase 2) normalizes a chosen disposition code to the
  marker. Note this `found`-"No information" branch is only reachable during the
  transitional window — once Phase 2 removes the disposition codes from
  `allowed_values`, the model's `value` `Literal` can no longer carry them.
- **AI never proposes `not_applicable` / `not_evaluated`.** The LLM output
  `status` is `Literal['found','not_found','ambiguous']` and `value` is
  `Literal[allowed_values] | None` ([schema.py:73-125](../../../backend/app/llm/schema.py));
  once the disposition codes leave `allowed_values`, the only AI-expressible
  disposition is `no_information` (via `not_found`). `not_applicable` and
  `not_evaluated` are therefore **human-only dispositions** in this design —
  intentional; extending the LLM vocabulary is out of scope.

### §IX amendment (proposed wording)

§IX (`docs/reference/constitution.md:149`, "Transparency & Traceability of
AI-Assisted Decisions") today pins abstention to bare `{value:null}` in one
bullet (`:154`). Replace that bullet with the two concepts it currently
conflates:

> - A **domain "no information" / disposition answer** — that the source does
>   not state the item, or the item is not applicable / not evaluated — is a
>   first-class recorded proposal carrying a coded `absent_reason`
>   (`{value:null, absent_reason:<code>}`) with its rationale. A reviewer
>   accepts it like any AI version; it counts as a **resolved** value.
> - A **genuine unresolved state** — no proposal, an unaccepted proposal, or a
>   rejected decision — carries no disposition and is **not** a silent drop: the
>   proposal trail records that the run examined the field.

The ADR (0016) records the decision; the constitution edit lands in the doc
phase.

## Template configuration

- **`no_information` is universal.** Every field — select, multiselect, text,
  number, date — exposes a "No information" affordance that sets
  `absent_reason:"no_information"`. It is no longer a manually-added
  `allowed_value`; the template builder stops needing (and stops offering) the
  string option.
- **`not_applicable` / `not_evaluated` are opt-in per field.** A field's config
  gains two booleans (`allows_not_applicable`, `allows_not_evaluated`) on the
  `ExtractionField` model ([`backend/app/models/extraction.py`](../../../backend/app/models/extraction.py)),
  default off, surfaced in the template builder for signaling-question style
  fields (PROBAST/CHARMS). **These columns are a SQLAlchemy model change ⇒ their
  own Alembic migration** (revision id ≤ 32 chars), landed in **Phase 2** and
  **distinct** from the Phase-3 data backfill. The template-version **snapshot
  builder must copy the flags into `version.schema_`** so the frozen snapshot,
  the finalize gate, and the builder UI stay consistent. Only enabled
  dispositions render on the field.
- **`"Unclear"` stays a substantive select option** (present-but-ambiguous, a
  real answer), untouched.

**Seed changes — the full disposition inventory (both encodings).** The
literal-string sets are only half of it; PROBAST encodes the same dispositions
as abbreviated codes. Every disposition source and its target code:

| Seed source (`backend/app/seed.py`) | Members → disposition | Kept substantive |
|---|---|---|
| `_YES_NO_NI` (`:149`) | `"No information"` → `no_information` | `Yes`, `No` |
| `_YES_NO_NOTEVAL_NI` (`:151`) | `"No information"` → `no_information`; `"Not evaluated"` → `not_evaluated` | `Yes`, `No` |
| `_YES_NO_NOTAPP_NI` (`:150`) | `"No information"` → `no_information`; `"Not applicable"` → `not_applicable` | `Yes`, `No` |
| `_YES_NO_UNCLEAR` (`:148`) | `"No information"` → `no_information` | `Yes`, `No`, **`Unclear`** |
| `_PROBAST_SIGNALING` (`:155`) | `"NI"` → `no_information`; `"NA"` → `not_applicable` | `Y`, `PY`, `PN`, `N` |
| `_QUADAS2_SIGNALING` (`:160`), `_QUADAS2_JUDGMENT` (`:162`) | none | `Y`/`N`/`Unclear`, `Low`/`High`/`Unclear` |
| inline `allowed=[...]` lists carrying the literal strings | same as above | — |

Drop the disposition members from these lists (and the inline lists), set the
opt-in flags on fields that carried `NA`/`Not applicable` / `Not evaluated`, and
feed this exact mapping into the Phase-3 backfill (both full-word and
abbreviated encodings), so **no in-band disposition survives** in any encoding.

## Reviewer comparison (consensus / divergence)

- Consensus agreement keys on the full resolved envelope
  (`json.dumps(resolved, sort_keys=True)`,
  [`run_lifecycle_service.py:310-328`](../../../backend/app/services/run_lifecycle_service.py)),
  so distinct-answers semantics fall out **for free** — **but only because**
  the marker envelope is persisted verbatim into `ExtractionReviewerDecision.value`
  and `ExtractionPublishedState.value` (the Phase-1 write contract). The
  consensus key at `:321` and `_filled_coords` at `:388` hash that stored
  envelope; if a marker collapsed to `null` in those columns, two different
  codes would both hash as `null` and wrongly **agree**. This persistence is the
  load-bearing precondition, called out in Phase 1.
- Two reviewers agree only when value **and** `absent_reason` match;
  `no_information` vs `not_applicable` diverge; a marker vs a substantive value
  diverges.
- Frontend divergence display (the FE-only "≥2 reviewers disagree" cue) must
  read `absent_reason` — including the fourth `{value}` unwrap in
  `ConsensusPanel.tsx:115` — so a disposition divergence renders legibly, not as
  two blank-looking cells.
- Add a consensus test: two reviewers on the same code agree and publish; two
  on different codes stay unresolved.

## Export

- `resolve_value`
  ([`backend/app/services/exports/value_envelope.py`](../../../backend/app/services/exports/value_envelope.py))
  gains a branch that must be placed **at the top**, *before* the exact
  key-set matches `== {"value"}` (`:56`) and `== {"value","unit"}` (`:64`) —
  keyed on `"absent_reason" in raw and raw.get("absent_reason")` — returning the
  stable label. Otherwise a marker (`{value:null, absent_reason:X}`, key-set
  `{value, absent_reason}`) falls through to the catch-all dict-stringify
  (`:84-85`) and leaks `"value: None; absent_reason: no_information"` into a
  cell — the failure the module's own "never returns a dict" invariant forbids.
  An export test asserts a marker never hits the `{value}` unwrap and never
  dict-stringifies.
- The front-matter legend
  ([`extraction_export_service.py:1827-1832`](../../../backend/app/services/extraction_export_service.py))
  today has one disposition row (`"No information"`). It gains **three** rows,
  worded to match the label `resolve_value` emits **exactly** (so cell and
  legend can't drift):
  - `No information` — "The source does not state this item."
  - `Not applicable` — "The item does not apply to this study."
  - `Not evaluated` — "The item was not assessed."
  `"(blank)"` keeps its distinct meaning (no value / rejected).
- **Appraisal worst-case roll-up.** The QA appraisal Overall
  (`build_appraisal_summary`, `extraction_export_service.py:276-339`; verdict
  selection `_is_verdict` + severity rank in the appraisal-summary helper)
  currently ranks an unknown label as most-severe. `_is_verdict` requires *all*
  a field's `allowed_values` to be risk labels, so today's signaling `NI`/`NA`
  fields are excluded — but under this design `no_information` is available on
  **every** field, including a verdict field. **New work (Phase 4):** a
  disposition-marked verdict must be treated as *excluded / unknown* in the
  worst-case rank, **never** most-severe (a `no_information` risk verdict must
  not silently force a Critical Overall). A test locks this.
- Net: exports stay **clear and simple** — one label per disposition, the value
  column stays type-clean, and a downstream consumer never reverse-engineers a
  sentinel.

## UX (extraction + QA — both share the suggestion path)

- **Set a disposition on any field.** `FieldInput` gains a small, unobtrusive
  "No information" control on **all** field types (number/date/text have none
  today), plus the opt-in `Not applicable` / `Not evaluated` where the field
  enables them. Selecting it writes the marker; clearing it returns to
  unresolved.
- **AI abstention proposal is visibly distinct.** An AI
  `{absent_reason:"no_information"}` proposal renders as a quiet, labelled
  "No information" suggestion **without** a confidence badge and marked "no
  evidence", so a reviewer can accept it with one click but is never misled
  into reading it as a confident finding. It is **not** silently swept into a
  bulk "accept all" — bulk-accept excludes or separately confirms abstention
  proposals (the decision-#3 accept-all safeguard).
- **QA / extraction parity.** Replace the divergent header counts
  (`QualityAssessmentFullScreen.tsx:634` counts all;
  `ExtractionFullScreen.tsx:506` filters no-info) with one shared
  `countActionableSuggestions` selector. Under decision #3 an **unresolved
  abstention proposal IS actionable** (it needs a human accept), so it **counts**
  as pending — reversing today's `ExtractionFullScreen:506` exclusion (whose
  comment must be reconciled). "Actionable" therefore = "an unresolved AI
  proposal awaiting a human decision", abstention included; what changes for
  abstentions is *rendering* (distinct, no confidence badge) and *bulk-accept*
  (excluded), **not** the count.
- `isAbstention` (renamed from `isNoInfoValue`) drives the quiet-strip and
  no-info-card rendering in `AISuggestionDisplay` / `AISuggestionReviewPopover`
  through the shared predicate.

## No-legacy & maintainability

- **One representation** end-to-end after migration — the string hack is gone,
  and there is no permanent read-shim (the transitional tolerance in Phase 0 is
  removed in Phase 3).
- **One emptiness rule per side**, mechanically cross-checked (shared test
  vector) — the FE/BE drift hazard and the three open-coded FE copies are
  eliminated, not relocated.
- **Vocabulary matches the concept** — `isAbstention`, `absent_reason`; §IX and
  the architecture doc use the same terms.
- **Typed contract** — `absent_reason` is a backend enum surfaced via the
  generated API types (`npm run generate:api-types`); no hand-mirrored strings.

## Two deliberate behaviour calls (resolved)

1. **Dedup** (`extraction_suggestion_read_service.py:213`): a coded AI
   abstention is now `is_value_empty == False`, so it is a real value in the
   "later abstention must not bury an earlier value" rule. **Resolved:** a
   coded `no_information` is a genuine answer and may win by recency like any
   value; only a bare `{value:null}` (no marker) is still treated as buryable.
   Update the Step-2 comment to state the value-vs-value recency rule.
2. **Consensus agreement** (above): different codes diverge. **Resolved** by
   decision (distinct answers).

## Phased plan (sequenced for clean agent hand-offs)

Each phase is independently green + shippable; readers that must understand the
new shape ship together (fan-out-once). `writing-plans` expands each into tasks.

- **Phase 0 — Marker-aware, read-tolerant (behaviour-preserving).**
  Backend `value_semantics` + `absent_reason` enum + `value_absent_reason`
  helper; finalize gate + dedup inherit. FE shared `valueSemantics.ts`; route
  `progress.ts` (stop pre-unwrapping — pass the raw envelope), `valueParser`,
  `aiSuggestionService.unwrapValue`, and every other `"value" in` peel through
  it. **Rename `isNoInfoValue → isAbstention` as a UNION predicate for the
  transitional window:** `absent_reason` present **OR** legacy-empty
  (`null`/`undefined`/`''`). This *preserves today's truth table* — critical,
  because no markers exist yet (abstentions are still bare `null`/`''` until
  Phase 1+3), so a pure marker-shape test would break the quiet no-info strip
  and re-inflate the pending count across the whole window. **Audit the three
  `isAbstention` call sites in this phase** (`AISuggestionDisplay:112`,
  `AISuggestionReviewPopover:91`, `ExtractionFullScreen:506`) with a
  behaviour-unchanged snapshot/count test — do **not** defer them to Phase 4.
  Readers tolerate **three** shapes: marker, legacy disposition string, bare
  null/`''`. *Ships behaviour-neutral.*
- **Phase 1 — Write-path contract + AI marker.** Thread `absent_reason`
  through `extractValueForSave → writeRunFieldValue → /proposals & /decisions`
  request schemas; **persist the full marker envelope verbatim into
  `ExtractionReviewerDecision.value` and `ExtractionPublishedState.value`** (the
  consensus/gate precondition); regenerate API types. **Split** the
  `is_no_info` branch (`section_extraction_service.py:1431-1433`): only
  `not_found`/bare-`None` → `{value:null, absent_reason:"no_information"}`;
  `ambiguous` falls through as a low-confidence needs-attention proposal with no
  marker. Round-trip + recording tests (incl. "ambiguous gets no marker").
- **Phase 2 — Template config + select unification.** New `allows_not_applicable`
  / `allows_not_evaluated` boolean columns on `ExtractionField` — **their own
  Alembic migration** (≤ 32 chars) + snapshot-builder propagation into
  `version.schema_`. `no_information` global affordance; opt-in flags + builder
  UI; select write path maps a chosen disposition (full-word **and** PROBAST
  `NI`/`NA`) to the marker; seed lists updated per the mapping table
  (`"Unclear"` kept). AI can now only express `no_information` (codes gone from
  the enum); `not_applicable`/`not_evaluated` are human-only.
- **Phase 3 — Data migration (Alembic, all runs incl. finalized).** Rewrite
  stored disposition values → marker across `ExtractionProposalRecord.proposed_value`,
  `ExtractionReviewerDecision.value`, and `ExtractionPublishedState.value`,
  scoped by the **frozen per-run template version snapshot** (`version.schema_`,
  the source the gate/export already trust — `run_lifecycle_service.py:341`),
  **not** the live `extraction_fields` (which Phase 2 mutated). Mirror the read
  resolution: an `accept_proposal` decision with a null `value` inherits
  correctness from its migrated proposal (no double-handle). Never a blind
  string match. Then **narrow `isAbstention` to the pure marker-shape** and
  remove the legacy-string/bare-null read tolerance (the shim). Bump the
  migration-head line + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md` (Alembic only, never
  Supabase MCP).
- **Phase 4 — Export, reviewer-compare, UX.** `resolve_value` top-branch +
  three legend rows; appraisal worst-case excludes a marker verdict; FE
  divergence display + `ConsensusPanel:115` read `absent_reason`; extraction + QA
  UX (field affordance on all types, distinct abstention rendering, bulk-accept
  safeguard, shared `countActionableSuggestions`).
- **Phase 5 — Docs.** ADR-0016 finalized, constitution §IX amended, architecture
  doc updated. (Doc stubs land with their phase; this phase closes them out.)

Transitional window: between Phase 1 (new writes produce the marker) and Phase 3
(data migrated + shim removed + predicate narrowed), readers tolerate **three**
shapes (marker, legacy disposition string, bare null) — a bounded migration
scaffold, not permanent legacy.

## Test strategy (evidence before "done")

- **`value_semantics`** unit table incl. the three shapes: `{value:null,
  absent_reason:X}` ⇒ filled; legacy disposition string ⇒ filled;
  `{value:null}`/`''` ⇒ empty. Shared vector mirrored on FE `valueSemantics.test.ts`.
- **Finalize gate:** a required numeric resolved to `no_information` (via
  human decision) finalizes; the same field bare-null still blocks; an
  *unaccepted* AI marker proposal does **not** satisfy the gate.
- **Recording (Phase 1):** `not_found` → `no_information` marker; **`ambiguous`
  gets no marker** (stays needs-attention); `found` value preserved.
- **Autosave no-regression:** the form value + baseline for a resolved
  disposition are the **full envelope**; baseline == current on mount (no
  re-POST); saving an adjacent field does not restripe the marker coord. New R7
  cases in `frontend/lib/extraction/autosaveDirty.test.ts`.
- **Dedup:** a newer coded abstention vs an older real value (recency rule);
  a bare-null still buryable.
- **Consensus:** same code agrees + publishes; different codes stay unresolved
  (asserts the marker is persisted into decision/published `value`).
- **Export:** marker renders as its exact legend label in CONSENSUS /
  SINGLE_USER / ALL_USERS matrices and **hits the top branch, never the
  `{value}` unwrap / dict-stringify**; `"(blank)"` stays distinct; a
  `no_information` on a verdict field is **excluded** from the appraisal
  worst-case Overall (not most-severe).
- **Migration:** a *finalized* run with `"No information"` (and PROBAST `"NI"`)
  → marker, scoped via the **frozen version snapshot**; a finalized run whose
  *live* template changed still migrates correctly; an `accept_proposal`
  decision whose value lives on the proposal migrates once; a legitimate value
  equal to a disposition string on a field whose (snapshot) domain lacks it is
  untouched; offline `--sql` both directions.
- **API contract:** regenerate `frontend/types/api/schema.d.ts`; the
  `api-contract` CI job stays green.

## Risks & mitigations

- **Blind accept-all of AI abstentions** (decision #3 residual) → UX: distinct
  rendering, no confidence badge, excluded from silent bulk accept.
- **Migration mutates finalized history** → lossless rewrite (semantics
  preserved), `allowed_values`-scoped so no legitimate value is touched;
  `--sql` reviewed both directions before apply.
- **FE/BE predicate drift** → shared cross-checked test vector; FE routes
  through one module.
- **Ambiguous status** mis-mapped to `no_information` → Phase 1 **splits** the
  recording branch so `ambiguous` never receives the marker (stays a
  low-confidence, gate-blocking proposal); pinned by a recording test.
- **Marker lost on the FE read/write path** (the unwraps discard the sibling
  key) → the FE carries the full envelope end-to-end (model, form state,
  autosave baseline, `ConsensusPanel`), verified by the R7 and round-trip tests.
- **Phase 0 silently changing count/strip behaviour** → the transitional
  `isAbstention` is a truth-preserving UNION; call sites audited in Phase 0.

## Out of scope

- The FHIR-complete 15-code vocabulary (only three codes for now).
- Any change to `"Unclear"` (stays a substantive value).
- Widening beyond the no-information representation and its direct consumers.
- Relaxing the finalize completeness gate.

## Evidence index (file:line)

- Recording coercion: `backend/app/services/section_extraction_service.py:1416-1492`
- Emptiness oracle: `backend/app/services/value_semantics.py`
- Finalize gate: `backend/app/services/run_lifecycle_service.py:330-453`;
  consensus key `:310-328`
- Dedup: `backend/app/services/extraction_suggestion_read_service.py:199-216`
- Export: `backend/app/services/exports/value_envelope.py:56,64,84-85`
  (exact-key-set branches + catch-all); legend
  `backend/app/services/extraction_export_service.py:1827-1832`; appraisal
  worst-case `extraction_export_service.py:276-339` + `_is_verdict` / severity
  rank in the appraisal-summary helper
- Seed dispositions (both encodings): `backend/app/seed.py:148-151`
  (`_YES_NO_*`), `:155` (`_PROBAST_SIGNALING` `NI`/`NA`), `:160,162` (QUADAS2),
  signaling fields `~:1451-1623` (+ inline `allowed=`)
- Field model (opt-in flag columns): `backend/app/models/extraction.py`
- Frozen version snapshot (migration scope source):
  `run_lifecycle_service.py:341` (`version.schema_`)
- LLM schema (value is `Literal[codes] | None`, status enum):
  `backend/app/llm/schema.py:48-125`; recording branch
  `backend/app/services/section_extraction_service.py:1431-1454`
- FE unwraps (all discard the sibling key): `frontend/services/aiSuggestionService.ts:45-49`,
  `frontend/services/extractionValueService.ts:27`,
  `frontend/lib/ai-extraction/valueParser.ts:14,52`,
  `frontend/components/runs/ConsensusPanel.tsx:115`
- FE predicate + copies: `frontend/lib/ai-extraction/suggestionUtils.ts:171`,
  `frontend/lib/extraction/progress.ts:127,192-200`
- Autosave: `frontend/hooks/runs/useAutoSaveProposals.ts`,
  `frontend/lib/extraction/autosaveDirty.ts`
- Screens: `frontend/pages/ExtractionFullScreen.tsx:506`,
  `frontend/pages/QualityAssessmentFullScreen.tsx:634`
- Constitution §IX (title `:149`, abstention bullet `:154`):
  `docs/reference/constitution.md`
