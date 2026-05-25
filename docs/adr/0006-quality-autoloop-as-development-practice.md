---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0006'
---

# Adopt the architectural quality autoloop as a first-class development practice

> **Status:** Accepted · Date: 2026-05-19 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

AI-assisted development tends to introduce silent architectural drift —
concept-vocabulary inconsistencies, layered-architecture violations,
missing tests, security gaps. Manual review catches some of these but
does not scale; running standard linters catches none.

## Decision

Treat the architectural quality autoloop (under
`.claude/skills/architectural-quality-loop`) as a first-class part of the
development workflow:

- Outputs land under `docs/superpowers/quality-runs/<datetime-scope>/`
  with `scope.md`, iteration files, and a `summary.md`.
- Each iteration converges through deterministic gates plus an LLM judge.
- Recurring incident classes (BOLA, TOCTOU, envelope drift, RLS gaps)
  become explicit checks in the `code-review` skill's prumo-specific
  checklist.

## Consequences

- Good — Drift is caught within a small number of iterations rather than
  surfacing in production incidents.
- Good — `docs/superpowers/quality-runs/` doubles as an audit trail for
  architectural decisions and their drivers.
- Neutral — Each run produces a folder of artefacts; the volume is
  manageable because runs are scoped (one slice at a time).
- Bad — The loop is only as good as the gate definitions; gates need
  periodic review.

## Validation

- 9 converged runs landed between 2026-05-19 and 2026-05-20 covering
  extraction services, frontend query-keys, the backend envelope batch,
  layered architecture, and the HITL session refactor (see
  `docs/superpowers/quality-runs/`).
- Each iteration includes pre/post snapshots demonstrating the gate
  delta.

## More Information

- [Quality runs index](../superpowers/quality-runs/README.md)
- Skill: `.claude/skills/architectural-quality-loop`
- [Original design spec](../superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md)
