# Summary — 2026-05-20-0200-hitl-session

**Status:** `scan_complete` (SCAN-only proof of the inferential lane on a fresh scope; 5 real findings ready for triage; APPLY deferred to the next session).

## Scope

`concept:hitl-session` (resolved) — 2 backend files, 514 LOC:
- `backend/app/services/hitl_session_service.py` (422 LOC)
- `backend/app/api/v1/endpoints/hitl_sessions.py` (92 LOC)

## SCAN results

| Category | Count | High | Medium |
|---|---:|---:|---:|
| concept-drift | 0 | 0 | 0 |
| layered-arch | 0 | 0 | 0 |
| **security** | **2** | **2** | 0 |
| legacy | 0 | 0 | 0 |
| test-gaps | 3 | 0 | 3 |
| **Total** | **5** | **2** | **3** |

All 5 findings have `confidence ≥ 0.75`. 0 dropped below the 0.7 floor.

## High-severity findings (the headline)

### f_001 / f_002 — **BOLA on article_id ownership** 🚨

Two complementary findings from the security subagent:

- **f_001** (`hitl_sessions.py:59`, `confidence=0.95`): The endpoint validates project membership via `ensure_project_member(db, body.project_id, current_user_sub)` but never checks that `body.article_id` belongs to `body.project_id`. A member of project A could call `POST /hitl/sessions` with `{ project_id: A, article_id: <article-from-project-B> }` and the session would open over the cross-project article.
- **f_002** (`hitl_session_service.py:146`, `confidence=0.90`): `_resolve_project_template` checks `tpl.project_id == project_id` (good — template ownership is enforced) but `open_or_resume` never validates that `article_id` belongs to the same project before `_ensure_instances` creates `ExtractionInstance` + `ExtractionRun` rows pointing at the cross-project article.

**Suggested fix shape** (next session): introduce an `ensure_article_in_project(db, article_id, project_id)` helper analogous to `ensure_project_member`, call it from the endpoint after the membership check, and from the service before `_ensure_instances`. Add an integration test that opens a session with a cross-project article ID and asserts 403/404.

## Medium-severity findings

### f_003 / f_004 / f_005 — test-gaps on guarded branches

- **f_003** (`hitl_session_service.py:147`): `_resolve_project_template` raises `HITLSessionInputError` for a template ID that exists but is in a different project; no integration test exercises that branch.
- **f_004** (`hitl_session_service.py:151`): Same function raises on `kind` mismatch (extraction vs quality_assessment); no test exercises it.
- **f_005** (`hitl_session_service.py:118`): `_reuse_or_create_run` captures `hitl_config_snapshot` via `RunLifecycleService.create_run`; no test asserts the snapshot is actually populated on the resulting Run.

## What the SCAN earned

This is the FIRST real-world demonstration of the inferential lane (5 parallel LLM subagents) on a scope the deterministic checks have already declared clean. The deterministic lane reports 0 violations for `hitl-session`, but the LLM scanner surfaced a **high-severity BOLA** that no regex / AST check would have caught — the bug is "missing ownership check on a parameter", which requires understanding the data flow + project-membership invariant.

This validates the design's claim that **deterministic + inferential lanes are complementary, not redundant**. The deterministic gates enforce known invariants; the LLM scanners discover *new* patterns of risk that the team hasn't yet codified as a fitness function.

A natural follow-up: when the BOLA fix lands in a future iteration, add `check_article_ownership.py` to `scripts/fitness/` (an AST-based check that flags any endpoint accepting both `project_id` and `article_id` without `ensure_article_in_project`). That promotes the LLM finding into a deterministic guard for future endpoints.

## Telemetry

- Wall-clock total (5 subagents parallel): ≈ 62 s
- Subagent calls: 5 (well under 150-cap)
- Tokens used: ≈ 20 500 (well under 500k-cap)
- Findings emitted at confidence ≥ 0.7: 5 (0 dropped to `findings_dropped.jsonl`)

## Status / Next session

**This run-dir stops at `scan_complete`** — same pattern as the original Phase 2 SCAN on extraction services. APPLY phases (driving each finding through a verified iteration) are the next session's work. Suggested order:
1. `f_001 + f_002` (BOLA) — single batched iteration: helper + endpoint check + service check + integration test asserting cross-project denial.
2. `f_003` and `f_004` — small test additions (~30 LOC each).
3. `f_005` — adds an assertion to an existing test.

Total predicted next-session work: 1 high-priority commit (BOLA) + 3 small test commits.
