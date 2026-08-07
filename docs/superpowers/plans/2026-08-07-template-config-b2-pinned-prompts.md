---
status: draft
last_reviewed: 2026-08-07
owner: '@raphaelfh'
---

# Track B slice B-2 — AI prompts read the run-pinned snapshot

> Slice 2 of the track-B re-slicing
> (`docs/superpowers/plans/2026-08-07-template-config-b1-grid-shell.md`).
> Spec §1.1 finding 1. **Provably inert on merge**: every AI entry point
> hard-requires `stage == EXTRACT`, republish re-pins editable-stage runs
> on both its branches, and `run.version_id` is NOT NULL — so today every
> AI-eligible run is pinned to the active version and live == snapshot.
> The change becomes load-bearing when B-4 stops per-edit republishing.

## Goal

Extraction and model-identification prompts derive their template
structure (sections, fields, labels, descriptions, AI instructions) from
`run.version_id`'s snapshot — never from live template rows — with a
narrow/empty → live fallback chain, coordinate coherence against live
rows, and divergence-forcing tests that pin a run to an old version,
mutate live rows without republishing, and assert the prompt still
reflects the pinned version.

## Design

**One shared provider.** `_entity_types_for_run` in
`extraction_run_read_service` is already the canonical snapshot reader
(`RunViewEntityType.model_validate` over the snapshot dict, live ORM
fallback for narrow snapshots). Its core moves to
`app/services/extraction_snapshot.py` — the module that owns the snapshot
shape — as:

```python
async def entity_types_for_version(
    db: AsyncSession, *, version_id: UUID, template_id: UUID
) -> list[RunViewEntityType]
```

`extraction_run_read_service` keeps a thin wrapper. Both prompt services
consume the same function, so the fallback chain and the shape live in
exactly one place.

**Narrowness becomes per-element.** `_snapshot_is_narrow` checks only
`entity_types[0]` today; a heterogeneous snapshot (0017-patched first
element, unpatched later one) would pass the check and then blow up
`model_validate` on element N (`role` has no default). The moved copy
uses `any("role" not in et for et in entity_types)`. Empty stays narrow
(→ live) — that chain is what closes the inherited BLOCKING: an empty
pinned snapshot must never turn AI extraction into a green no-op run
(`section_extraction_service` short-circuits its all-failed guard on an
empty section list) nor the worklist into 100 % complete.

**Coordinate coherence, two independent layers.**
1. *Prompt layer:* fields sent to the LLM = snapshot fields ∩ live field
   ids, scoped per entity type (a pair intersection by construction —
   ids are matched inside one entity type's field set). A field deleted
   live is silently not extracted (today's behaviour); a field added
   live is invisible until publish (the B-4 contract).
2. *Write layer (already safe, verified):* `_create_suggestions`
   resolves field names → ids via a **live** `get_with_fields` fetch, so
   proposal writes always target live FK ids regardless of what the
   prompt said.

**Prompt content vs instance coordinates — the scope boundary.** In
`model_extraction_service`, only `_identify_models`' container label
feeds a prompt; `_get_model_container_entity_type_id` and
`_get_child_entity_types` produce coordinates for **instance creation**
(runtime writes FK-bound to live rows). Those stay on live reads.
*Deviation from the B-2 mapping, deliberate:* re-pointing materialization
is where two inherited BLOCKINGs live (ensure_instances × draft-deleted
sections), and B-4 owns materialization semantics. Snapshot-driven and
live-driven coordinates are identical today, so nothing is lost by
deferring.

**Phase-A gap closed.** `model_identification.render()` never gained
`general_instructions`, so the template-level ✨ instruction is not
applied to the model-identification prompt. Same treatment as the other
two prompts: leading `{general_instructions_section}` placeholder,
kwarg, VERSION canary; the service fetches via
`general_instructions_for_version(db, run.version_id)` (run in scope at
the call site).

## Out of scope (recorded)

- QA framework label: `extract_for_run` reads the LIVE template row for
  `_qa_framework_label` — template *metadata* is not in the snapshot;
  widening the shape is a separate decision (open question from the
  mapping, exists today).
- Frontend AI-dispatch helpers still read live rows to decide which
  sections to request — explicitly a B-4 item (the cheap fix rides
  B-3's endpoint).
- Instance materialization re-points (B-4), `derived_judgments` (not in
  any snapshot), QA assessment form live reads (B-3/B-4).

## Tasks

1. **Provider + narrowness** — move core into `extraction_snapshot.py`,
   per-element narrowness, wrapper in `extraction_run_read_service`.
   Tests (integration): snapshot path; empty → live; heterogeneous →
   live (new); divergence: pinned beats live.
2. **Section service** — `extract_for_run` top-level from provider;
   `_extract_one_entity_type_for_run` uses the snapshot entity for the
   prompt with the live fetch demoted to coherence source (existence +
   live field-id set), always passing `fields_override`;
   `extract_section`'s `_get_entity_type` snapshot-first with live
   fallback; `extract_all_sections` children from the provider tree.
   Tests: divergence per path (pinned label/description/llm_description
   win; live-only field not sent; snapshot-only field not sent).
3. **Model identification** — container label from provider;
   `general_instructions` param + canary on the prompt; service fetch.
   Tests: pinned container label wins over live rename; ✨ instruction
   present in the model-identification prompt.
4. **Harden + ship** — adversarial review workflow on the diff, full
   `make quality-scan`, PR → dev, auto-merge.

## Verify

`make quality-scan` green; divergence tests red-first against the
pre-change code where feasible; the existing `test_prompts.py` and
threading suites stay green (shape compatibility of `RunViewField` with
`build_output_models` is asserted by the service tests exercising the
real builder).
