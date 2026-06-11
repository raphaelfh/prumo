---
status: frozen
last_reviewed: 2026-06-10
owner: '@raphaelfh'
---

# 2026-06-10 plan-directory sweep

Batch archive performed during the dev-workflow SOTA pass
(`docs/superpowers/plans/2026-06-10-dev-workflow-sota.md`): the active
plans directory held 24 files of which 13 were `status: shipped`
(point-in-time snapshots of completed work) and the 4 PDF-viewer
phase plans (3b/4/5/6 era) had sat `in_progress` since 2026-04-29 —
those are re-marked `status: paused` here. Resume them by moving the
file back to `docs/superpowers/plans/` and flipping the status.

Durable decisions from the shipped plans live in `docs/reference/` and
`docs/adr/`; these files are historical records only.
