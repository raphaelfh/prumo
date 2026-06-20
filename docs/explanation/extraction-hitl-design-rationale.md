---
status: stable
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Why the extraction + HITL stack is shaped this way

> Design rationale (the *why*). For the current schema and run lifecycle see
> [extraction-hitl-architecture.md](../reference/extraction-hitl-architecture.md);
> for the decisions themselves see the ADRs linked below. The original
> 2026-04-27 design spec is preserved verbatim (original language included) under
> `docs/superpowers/specs/archive/2026-06-20-governance-sweep/2026-04-27-extraction-hitl-and-qa-design.md`.

## The fork in the road (2026-04)

Two evaluation models existed in parallel: the **extraction stack** — rich,
multi-instance, hierarchical templates, with real production data — and a
separate **"unified evaluation" (008)** skeleton built for human-in-the-loop
review (proposal → review → consensus → published) but only a flat 1:1 shape and
no production data. Quality Assessment (risk-of-bias appraisal) had no home at
all after the legacy assessment stack was dropped.

## The decision: unify around extraction

Rather than grow the 008 skeleton, the team **absorbed the HITL workflow into the
extraction stack and dropped 008**. Extraction already held the production data
and the richer model, so unifying there avoided a data migration and a second
modelling vocabulary. This is the root reason the codebase has one extraction
stack instead of two evaluation systems — and why `evaluation_*` survives only as
pre-rename vocabulary in a few places (for example the observability catalogue).

## Quality Assessment as a `kind`, not a parallel stack

Quality Assessment (PROBAST, QUADAS-2) was added by **reusing the entire
extraction stack** under a `kind=quality_assessment` discriminator rather than
duplicating tables and services. That discriminator is the single most
load-bearing shape decision in the schema — see
[ADR-0003](../adr/0003-kind-discriminator-for-hitl.md).

## How HITL actually gates (and what is inert)

The workflow is proposal → review → consensus → finalize, but the *enforcement*
is deliberately thin. Finalize requires at least one consensus decision
([ADR-0009](../adr/0009-extraction-finalize-completeness-gate.md)) plus, for
extraction, that every required field is resolved. Reviewer count and the
consensus rule are **stored for display and config but not enforced** as a
quorum — a single user can drive a run to finalized. Divergence ("needs
consensus") is a frontend-computed signal. The review stage
([ADR-0010](../adr/0010-extraction-review-stage-for-collaboration.md)) and
manager blind-review with reveal
([ADR-0012](../adr/0012-manager-blind-review-and-reveal.md)) layer on top.

## Pointers

- **Current state (what):** [extraction-hitl-architecture.md](../reference/extraction-hitl-architecture.md)
- **Decisions (why):** [ADR-0003](../adr/0003-kind-discriminator-for-hitl.md) ·
  [ADR-0009](../adr/0009-extraction-finalize-completeness-gate.md) ·
  [ADR-0010](../adr/0010-extraction-review-stage-for-collaboration.md) ·
  [ADR-0012](../adr/0012-manager-blind-review-and-reveal.md)
- **Original design spec (historical, verbatim):** under
  `docs/superpowers/specs/archive/2026-06-20-governance-sweep/`.
