---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0003'
supersedes: '008-unified-evaluation-model'
---

# Use a `kind` discriminator (extraction | quality_assessment) on HITL templates and runs

> **Status:** Accepted · Date: 2026-04-27 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Pre-2026-04, prumo had two parallel HITL stacks:

1. `extraction_*` — structured data extraction (CHARMS, AI suggestions,
   reviewer/consensus).
2. The 008 "unified evaluation model" skeleton — quality assessment
   (PROBAST, QUADAS-2) with its own `evaluation_*` / `proposal_records` /
   `consensus_*` / `published_states` / `evidence_records` tables.

They duplicated workflow concepts (proposals, decisions, consensus,
published state) under different schemas, making it impossible to share
UI, services, or audit infrastructure.

## Decision

Merge both into a single extraction-centric stack discriminated by `kind`
(`template_kind` enum: `extraction`, `quality_assessment`):

- A PROBAST domain is an `entity_type` with `kind=quality_assessment`.
- A signaling question is an `extraction_field`.
- The proposal → decision → consensus → published-state pipeline is
  shared.
- Sessions open through a single endpoint
  `POST /api/v1/hitl/sessions` parameterised by `kind`.

Implemented across migrations `0010` → `0018` (2026-04-27 → 2026-04-28).

## Consequences

- Good — One UI, one service layer, one set of audit invariants.
- Good — Adding a new HITL kind in the future is a `kind` enum value, not
  a parallel stack.
- Good — All 612 LOC of the 008 skeleton dropped (migration `0016`).
- Neutral — Quality-assessment domain language ("domain", "signaling
  question") is now expressed in extraction vocabulary; the mapping is
  documented in `docs/reference/extraction-hitl-architecture.md`.
- Bad — Migration trail required a synthetic-run backfill for legacy
  `extracted_values` rows; carefully documented in the original plan.

## Validation

- Migration `0016_drop_008_stack` deleted 612 LOC of skeleton code.
- 488 integration tests pass post-unification (see
  `docs/reference/test-strategy.md`).
- PROBAST + QUADAS-2 seeded and exercised end-to-end via
  `QualityAssessmentFullScreen`.

## More Information

- [Extraction + HITL architecture](../reference/extraction-hitl-architecture.md)
- [Original design spec (frozen)](../superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md)
- [Cancelled spec/008 placeholder](../superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model/spec.md)
