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
| [Extraction E2E observability](./how-to/observability-extraction.md) | Debugging extraction latency / errors across browser → API → DB |

## Reference — *information lookup*

| Reference | What's inside |
| --- | --- |
| [Deployment](./reference/deployment.md) | Topology, env vars, rollback, Railway specifics |
| [Migrations](./reference/migrations.md) | Alembic vs Supabase split, squash recipe, RLS conventions |
| [Extraction + HITL architecture](./reference/extraction-hitl-architecture.md) | Canonical schema, run lifecycle, RLS posture |
| [Test strategy](./reference/test-strategy.md) | Load-bearing tests, pyramid layout |
| [CHARMS template (v1.1)](./reference/templates/charms-v1.1-complete.md) | Field-by-field spec of the global CHARMS template |
| [CHARMS visual hierarchy](./reference/templates/charms-v1.1-hierarchy.md) | Tree view of CHARMS entities |

## Explanation — *understanding the why*

| Doc | What it explains |
| --- | --- |
| [ADR index](./adr/) | Architecture decisions (MADR 4.0) |
| [Roadmap pointer](./ROADMAP.md) | Active milestones and link to GitHub Projects |

## Internal tooling

| Path | Purpose |
| --- | --- |
| [`docs/superpowers/specs/`](./superpowers/specs/) | Active design specs |
| [`docs/superpowers/plans/`](./superpowers/plans/) | Active implementation plans |
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

- Every file under `docs/` carries YAML frontmatter (`status`, `last_reviewed`, `owner`) and a visible status line at the top.
- Status values: `stable` · `draft` · `deprecated` · `shipped` · `frozen` · `in_progress`.
- CI (`.github/workflows/docs-ci.yml`) enforces markdownlint, cspell, link check, and frontmatter presence on every PR that touches `**/*.md`.
- Docs older than 180 days trigger a `staleness` warning (set `STALENESS_FAIL=1` in CI to harden later).
