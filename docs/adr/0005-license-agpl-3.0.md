---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0005'
---

# Release prumo under the GNU AGPL-3.0-only

> **Status:** Accepted · Date: 2025-Q4 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Prumo is a research-platform SaaS. Without a copyleft licence, a hosted
fork could differentiate from the canonical project without contributing
back, weakening the upstream community.

## Decision

Release under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**.

Anyone running a modified version of prumo as a network service must
release their modifications under the same licence.

## Consequences

- Good — Hosted forks cannot strip community-facing improvements.
- Good — Aligns with comparable scientific-software projects.
- Neutral — Some commercial integrators will need to negotiate a separate
  licence; offer that explicitly if it becomes relevant.
- Bad — Slightly higher friction for adoption by closed-source SaaS
  vendors; intentional.

## Validation

- `LICENSE` file at the repo root contains the full AGPL-3.0 text.
- README badge and footer cite the licence.
- All source headers fall under the licence by virtue of the repo-level
  `LICENSE`; no per-file headers needed (industry norm).

## More Information

- License text: [`LICENSE`](../../LICENSE)
- AGPL FAQ: <https://www.gnu.org/licenses/agpl-3.0.html>
