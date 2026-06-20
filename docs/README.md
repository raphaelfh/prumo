---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Documentation Index

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

This tree follows the [Diátaxis](https://diataxis.fr) framework. Pick the
quadrant that matches what you need.

## Tutorials — *learning by doing*

> Start here if you are new. Each tutorial takes you from zero to a
> known-good outcome.

*None yet — see the root [`README.md`](../README.md) for setup until a real
tutorial lives here.*

## How-to guides — *task recipes*

| Guide | When to read |
| --- | --- |
| [Seed the database](./how-to/seed-database.md) | After `make reset-db` or when bootstrapping a new env |

## Reference — *information lookup*

| Reference | What's inside |
| --- | --- |
| [Deployment](./reference/deployment.md) | Topology, env vars, rollback, Railway specifics |
| [Migrations](./reference/migrations.md) | Alembic vs Supabase split, squash recipe, RLS conventions |
| [Constitution](./reference/constitution.md) | Non-negotiable architectural principles (layering, typed everything, split migration ownership) |
| [Extraction + HITL architecture](./reference/extraction-hitl-architecture.md) | Canonical schema, run lifecycle, RLS posture |
| [Test strategy](./reference/test-strategy.md) | Load-bearing tests, pyramid layout |
| [Extraction observability](./reference/observability-extraction.md) | Metrics + structured events; debugging extraction latency/errors (browser → API → DB) |
| [CHARMS template (v1.1)](./reference/templates/charms-v1.1-complete.md) | Field-by-field spec of the global CHARMS template |
| [CHARMS visual hierarchy](./reference/templates/charms-v1.1-hierarchy.md) | Tree view of CHARMS entities |

## Explanation — *understanding the why*

| Doc | What it explains |
| --- | --- |
| [ADR index](./adr/) | Architecture decisions (MADR 4.0) |
| [Extraction + HITL design rationale](./explanation/extraction-hitl-design-rationale.md) | Why the extraction stack absorbed HITL + QA (the `kind` discriminator) |
| [Roadmap pointer](./ROADMAP.md) | Active milestones and link to GitHub Projects |

## Internal tooling

| Path | Purpose |
| --- | --- |
| [`docs/superpowers/specs/`](./superpowers/specs/) | Design specs (lifecycle in each file's frontmatter; shipped → `specs/archive/`) |
| [`docs/superpowers/plans/`](./superpowers/plans/) | Implementation plans (lifecycle in each file's frontmatter; shipped → `plans/archive/`) |
| [`docs/superpowers/quality-runs/`](./superpowers/quality-runs/) | Outputs of the architectural quality autoloop |
| [`docs/superpowers/design-system/`](./superpowers/design-system/) | Component design briefs |
| [`docs/design-references/`](./design-references/) | Visual references (Linear UX) |

## Community files

| File | Lives in |
| --- | --- |
| Contributing | [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) |
| Code of Conduct | [`.github/CODE_OF_CONDUCT.md`](../.github/CODE_OF_CONDUCT.md) |
| Security policy | [`.github/SECURITY.md`](../.github/SECURITY.md) |
| Support | [`.github/SUPPORT.md`](../.github/SUPPORT.md) |

## Doc conventions

- Every file under `docs/` carries YAML frontmatter (`status`, `last_reviewed`, `owner`) — the **single source of truth** (the staleness gate reads frontmatter). A visible status line in the body is optional and must not restate `last_reviewed` (the duplicated date drifts).
- Status values: `stable` · `draft` · `deprecated` · `shipped` · `frozen` · `in_progress`.
- CI (`.github/workflows/docs-ci.yml`) enforces markdownlint, cspell, link check, and frontmatter presence on every PR that touches `**/*.md`.
- Docs older than 180 days trigger a `staleness` warning (set `STALENESS_FAIL=1` in CI to harden later).
