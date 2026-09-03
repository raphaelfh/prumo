---
status: approved
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Repeating-group instance identity — design

> Brainstormed and approved 2026-08-23. Gives `cardinality='many'` entity
> types a declared identity key so an AI re-run reuses the instance it
> already created instead of forking a parallel one.
>
> Touches `extraction_fields` (one new column), both AI extraction services,
> the model-identification prompt, the portable-template bundle, the template
> inspector, and the CHARMS seeds. No change to the reviewer/consensus
> coordinate system, and no change to how values are protected on re-run —
> both already work (see §3).

## 1. Problem

Running AI extraction twice on the same article produces two parallel
instances for one real-world entity. Reviewer values land on whichever
instance was current when they worked, so the two halves never meet in
consensus.

The reported case: run 1 identified the model and labelled it *"XGBoost"*;
run 2 identified the same model and labelled it *"Gradient Boosting"*. Two
instances, each half-filled, for one model.

This was originally framed as a cross-reviewer problem (reviewer A and
reviewer B naming the same entity differently). It is not. The human path
already defends itself:

- `AddModelDialog` renders every existing sibling label as chips and rejects
  a case-insensitive exact duplicate.
- `_ensure_unique_model_label` (`model_hierarchy_service.py:188`) renames a
  colliding label to `"X (2)"` as a race guard.
- Instances are not `created_by`-filtered — every reviewer sees every
  sibling in the selector, and RLS on `extraction_instances` is plain
  `is_project_member`.

The machine forks the entity; the humans never did.

## 2. Root cause

`cardinality='many'` has no identity mechanism anywhere in the stack. The
database trigger that would enforce one bails out explicitly:

```sql
-- enforce_extraction_instance_cardinality, baseline_v1.sql:283
IF v_cardinality IS DISTINCT FROM 'one' THEN
    RETURN NEW;
END IF;
```

Every repeating group is therefore unprotected, and the hole surfaces three
different ways:

| Path | Today | Failure |
| --- | --- | --- |
| AI → model container | `_create_model_instances` (`model_extraction_service.py:556`) creates unconditionally | **Duplicates** the whole set on every re-run |
| AI → repeating section | `_get_or_create_instance` takes `instances[0]` (`section_extraction_service.py:1492`); `_find_instance_for_entity_type` likewise (`:767`) | **Collapses**: always writes the 1st repeat, never fills repeats 2..N |
| Human → repeating section | `onAddInstance` (`SectionAccordion.tsx:168`) calls `createInstance` bare | No dialog, no chips, no label check |

The duplication and the collapse are the same missing concept seen from two
sides: nothing tells the system *which* repeat a finding belongs to.

A declared key also cannot be retrofitted at consensus time cheaply:
`extraction_consensus_service.py:94` hard-guards that a selected decision
targets the same `(instance, field)` as the coordinate being resolved, so
re-anchoring values across instances is a structural change, not a UI tweak.
That is why this spec fixes creation, not reconciliation (§7).

## 3. What is already solved — do not rebuild

Re-run safety already exists one level below the instance:

- `skipFieldsWithHumanProposals` defaults to `true` from the frontend
  (`extractionRunService.ts:62`). The backend skips any field the human has
  settled on either track — a recent `human` proposal or a committed
  `ReviewerDecision` (`section_extraction_service.py:682`). The schema
  comment states the intent directly: *"so users can re-run AI without
  losing their work"* (`extraction.py:130`).
- `extraction_proposal_records` has no unique constraint on
  `(run_id, instance_id, field_id)`. Proposals are append-only: a re-run
  adds a fresh AI proposal, it never destroys the previous one.

So a re-run that lands on the *right* instance is already safe and already
non-destructive. **The only thing missing is instance-level identity.** This
spec adds exactly that and nothing else.

## 4. Decision — `is_entity_key`

Add a boolean `is_entity_key` to `extraction_fields`, default `false`. One
field per repeating entity type may carry it; that field's value is the
instance's identity within its `(article, entity_type, parent_instance)`
coordinate.

The concept is not new — the template author already wrote it in prose. The
description of `pnum_validation_type` reads *"Key of this performance block;
add one instance per type"* (`seed.py:2889`). This spec promotes that from
prose to schema so the extraction services can act on it.

### 4.1 Why a declared key and not fuzzy label matching

The reported pair is *"XGBoost"* and *"Gradient Boosting"*. No string
similarity metric links those two — the edit distance is enormous. Fuzzy
matching would be theater. The LLM that produced both names, however, can
align them when shown what already exists (§5.2).

### 4.2 Why the key alone is not enough

A declared key gives a **deterministic, auditable place to compare**. It does
not make the compared value stable:

- A `select` key (`pnum_validation_type`, constrained to
  apparent/internal/external) cannot drift between runs. Deterministic
  matching suffices on its own.
- A free-text key (`model_name`, `mdl_name`, `predictor_name`) drifts
  exactly as the label did. Run 2 writes "Gradient Boosting" into the key
  where run 1 wrote "XGBoost", the keys differ, and the duplicate is
  recreated one layer down.

`_identify_models` (`model_extraction_service.py:360`) builds its prompt from
the container label, the general instruction and the PDF text — it never sees
existing instances. **The declared key and the prompt grounding are therefore
inseparable.** Shipping either alone delivers nothing for the reported bug.

## 5. Mechanism

### 5.1 Match before create

Before creating an instance for a `cardinality='many'` entity type, the
service:

1. Resolves the entity type's key field (`is_entity_key = true`).
2. Reads the existing instances at the coordinate
   `(article_id, entity_type_id, parent_instance_id)` together with the
   key value **materialized on each instance row** (§5.1.1).
3. Normalizes both sides — trim, collapse internal whitespace, casefold.
4. On a match, reuses that `instance_id`. On no match, creates a new
   instance.

Applies to both AI paths: `_create_model_instances` (which today always
creates) and the repeating-section path (which today always takes
`instances[0]`). Fixing the second is what lets repeats 2..N ever be filled.

### 5.1.1 Identity is materialized on the instance, never read from values

The key value is written to `extraction_instances.metadata_->>'entity_key'`
(normalized) when the instance is created, and matching reads only that.

It must NOT be derived from the key field's *value*. During `extract`,
field values are per-reviewer and blind: the only resolver,
`resolve_caller_current_values`
(`extraction_run_read_service.py:261`), is caller-scoped and documents
itself as the 4th lockstep copy of migration 0025's blind predicate.
Deriving identity from it gives a choice of two failures — read it scoped
and reviewer B cannot see the value reviewer A entered, so the duplicate
is created anyway; read it unscoped and reviewer judgment leaks across the
blind boundary that ADR-0012 exists to hold.

Materializing on the instance avoids the choice: the row is already shared
(instance visibility is not reviewer-scoped), the value is present from
creation, and no reviewer-attributable table is touched. It is also
half-true today — the AI path already writes the model's name into
`label`; this makes the identity explicit and normalized instead of
implicit in a display string a human can rename.

`label` stays the human-facing, editable name. `entity_key` is the
identity and is not edited by hand.

Reuse means the instance row is reused. What happens to its field values is
already decided by the existing per-field guard (§3) and is not re-specified
here.

### 5.2 Ground the identification prompt

`_identify_models` receives the existing key values for the container and
instructs the model: if a finding is one of the entities already identified,
return its exact existing key value rather than a new name.

This is what closes the free-text case. For `select` keys it is redundant but
harmless, so the contract stays uniform.

### 5.3 Refuse rather than duplicate silently

A repeating group with no `is_entity_key` field declared cannot be matched.
The AI extraction refuses with a typed error naming the entity type, instead
of duplicating in silence.

The refusal is only honest because §6.4 ships the UI to satisfy it in the
same slice.

## 6. Scope — slice 1

### 6.1 Schema

- `extraction_fields.is_entity_key BOOLEAN NOT NULL DEFAULT false`.
- Partial unique index: at most one `is_entity_key` field per
  `entity_type_id`. The index is not conditioned on cardinality — a key
  declared on a `cardinality='one'` type is inert rather than rejected,
  which keeps the constraint simple and survives a section being toggled
  between `one` and `many`.
- Alembic migration numbered from the head at implementation time (do not
  pin it here — `dev` is at `0057` today and a second migration for the
  unrelated RLS work is in flight).

### 6.2 Seeded keys

Only the two **extraction** lineages need seeding. PROBAST+AI is
`kind='quality_assessment'` and has no repeating group.

| Template | Repeating group | Key field | Type |
| --- | --- | --- | --- |
| CHARMS `000c…0001` | `prediction_models` | `model_name` | text |
| CHARMS `000c…0001` | `final_predictors` | `predictor_name` | text |
| CHARMS + Multimodal `000e…0001` | `prediction_models` | `mdl_name` | text |
| CHARMS + Multimodal `000e…0001` | `numeric_performance` | `pnum_validation_type` | select |

### 6.2.1 The seed cannot reach existing installations — the migration backfills

`app.seed` guards every template with an early return: `seed.py:241`
(`_CHARMS_TEMPLATE_ID`) and `seed.py:2030` (`_MM_TEMPLATE_ID`) both read
`session.get(...)` and `return` on a hit. Production already has both
templates, so **editing the seed alone stamps nothing there** — and the
seed does not run on deploy in the first place.

Left uncorrected that is a production regression, not a no-op: the column
would exist, no CHARMS template would declare a key, and §5.3 would then
refuse AI re-runs on the primary workflow.

So the migration carries a **backfill**, and it is the part that actually
ships the fix:

- Stamp `is_entity_key` on the four coordinates of §6.2 in both **global**
  lineages, matched by `entity_type.name` + `field.name` (never by id —
  a project clone has fresh ids).
- Stamp the same coordinates on **project clones** derived from them,
  matched the same way, so existing projects keep working without a
  re-clone.
- Idempotent (`WHERE is_entity_key IS DISTINCT FROM true`) and guarded by
  the partial unique index, so a template that already declares a key for
  that entity type is left alone rather than conflicting.

The seed edit stays for **fresh** installations. Neither mechanism alone
is sufficient: the seed covers new databases, the backfill covers every
database that already exists.

### 6.3 Portable bundle

`PortableField` (`template_portable.py:52`) is an explicit field-by-field
allowlist. `is_entity_key` must be added to it, or an export→import round
trip silently drops the key and the imported template degrades to
"no key declared" — refused by §5.3. This is a correctness requirement of
the slice, not a follow-up: portable import/export reached production
2026-08-23 (#669/#670).

### 6.4 Template inspector

The section inspector already edits repeating-section properties and already
offers `cardinality: many` (`TemplateInspectorSectionPane.tsx:183`). Add a
key-field selector there, listing the section's own fields. Without it, a
hand-built repeating section hits §5.3's refusal with no way to satisfy it.

## 6.5 Shipped in slice 1, and what is not

Slice 1 ships the schema and backfill, the seed, the portable bundle, the
matcher, **the model-container AI path**, the prompt grounding, the API,
and the inspector control.

**The repeating-section AI path is deferred to slice 2.** Its bug is real
and described in §2 — `_get_or_create_instance` and
`_find_instance_for_entity_type` take `instances[0]`, so repeats 2..N are
never filled — but it is not the reported bug, it opens no dead end (no
refusal fires on that path today), and the change lands in
`_create_suggestions`, the single choke-point through which **every** AI
proposal flows for both extraction and quality assessment. Trading that
blast radius for an unrequested fix is the wrong bet inside an
unattended promotion. Slice 2 does it with its own verification.

Consequence to state plainly: after slice 1 a repeating section still
collapses onto its first repeat under AI extraction. Nothing regresses —
that is today's behaviour — but the spec is not fully delivered until
slice 2 lands.

> **Slice 2 landed (2026-09-03).** Every `cardinality='many'` section is
> an entry group: `section_extraction_service` routes it through
> `entry_group_extraction.extract_into_instances` — identify →
> `entity_key.resolve_instance` per entry → extract per entry with the
> prompt scoped to that entry — on all three paths (single section,
> full-run sweep, per-model batch). The key is read from the run's pinned
> tree (`key_field_of`), which also closes the live-read residual.

## 7. Out of scope

- **Merging or re-anchoring existing instances.** A manager-side tool to
  pair instance X with instance Y and re-anchor values is a separate,
  much larger slice — it has to move decisions, published states and AI
  links across a coordinate the consensus service explicitly pins
  (`extraction_consensus_service.py:94`). Slice 1 removes the cause; a
  future slice may reconcile history.
- **Existing duplicates.** The fix is forward-only. Duplicates already in
  the database are removed by hand through the affordances that already
  exist — `RemoveModelDialog` for models, the remove button on
  `InstanceCard:158` for repeats, both backed by
  `deleteOne('extraction_instances', …)` with the delete cascade hardened
  in #502. No data migration: deciding which instance survives and which
  values win is exactly the editorial judgment the constitution §IX
  requires to stay a recorded human choice.
- **Human duplicate prevention on repeating sections.** `onAddInstance`
  creates without a dialog. That is a real gap, but it is not the reported
  bug and no AI path touches it.
- **Per-field value protection on re-run.** Already implemented (§3).

## 8. Testing

Backend integration (pytest against real Postgres):

- **The regression:** run AI model extraction twice on one article; assert
  the instance count is unchanged and the same `instance_id` is reused.
  Without the fix this test sees `2N` instances — it must be written first
  and observed failing.
- Repeating section with a `select` key: repeats 2..N are filled on their
  own instances, proving the `instances[0]` collapse is gone.
- Key normalization: `" xgboost "` matches `"XGBoost"`.
- Refusal path: a repeating group with no declared key raises the typed
  error rather than creating.
- Partial unique index: a second `is_entity_key` field on one entity type
  raises `IntegrityError`.
- Migration round trip: `alembic upgrade head` then `downgrade -1`.

Unit:

- `_identify_models` prompt contains the existing key values.
- Portable round trip: a template with a declared key exports and re-imports
  with the key intact (extend `test_template_portable_schema.py` and the
  service tests).
- Seed pinning: the four keys of §6.2 are declared. Follow the existing
  seed-pinning pattern — do not query a database that assumes the seed ran.

Frontend (vitest):

- The inspector's key selector lists the section's fields, sets the key, and
  is absent on `cardinality='one'` sections.

Sequencing note: the local E2E suite is stateful and reruns report a
different failure each time. Run `make db-fresh` and then exactly one pass.
The local Supabase stack is shared across worktrees — message live peer
sessions and wait for an explicit OK before any `db-fresh`.

## 9. Risks

- **Free-text keys still depend on the LLM cooperating.** Grounding makes
  alignment likely, not certain. A drifted key produces a new instance —
  the current behaviour, not a regression. The `select` key is immune.
- **The refusal is a behaviour change.** A project with a hand-built
  repeating group and no declared key loses AI re-run until someone sets
  the key. §6.4 makes that a single control, and §6.2 covers every seeded
  template.
- **The partial unique index bites on import.** A bundle authored against a
  future version that marks two key fields would fail the import loudly
  rather than silently pick one. That is the intended failure mode.
