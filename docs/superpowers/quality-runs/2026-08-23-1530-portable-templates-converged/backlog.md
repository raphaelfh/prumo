# Backlog — 2026-08-23-1530-portable-templates

Computational lane: all 10 fitness checkers OK (0 findings). Inferential lane:
25 rows from 5 scanners, 0 below the 0.7 floor (`findings_dropped.jsonl` empty).
Deduped by `(file, line, category)`: the dead `createInitialInstances` was
reported by four scanners under different categories (cd_001, la_001/la_003,
sec_002, leg_001) — one backlog item, max severity **high** (blacklist #7).

Grouped into four iterations by file so each stays ≤ 300 LOC / ≤ 5 files
(the contract's one-finding-per-iteration is relaxed where findings share a
file; recorded here rather than hidden).

| # | Iteration | Findings | Sev |
| --- | --- | --- | --- |
| 001 | Evict `createInitialInstances` + the supabase pre-reads from `templateImportService.ts`; recurrence guard in `check_legacy_concepts.py` entry 7; `importGlobalTemplate` tests | cd_001, la_001, la_002, la_003, sec_002, leg_001, tg_005 | high |
| 002 | Backend vocabulary: `ExtractionCardinality` enum, shared `DEFAULT_ENTRY_LABEL`, one `Framework` alias, "extraction(s)" wording | cd_002, cd_003, cd_004, cd_005, cd_006 | medium |
| 003 | Transaction boundary: `set_template_active` stops committing; PATCH handler commits; PATCH endpoint tests | la_004, tg_004 | medium |
| 004 | Race-branch unit tests (`violates_constraint`, `flush_activation`, delete races); "+N more" overflow line; surfaced refresh error; client-side file-size cap; frontend failure-branch tests | tg_001, tg_002, tg_003, leg_002, sec_003, sec_001(partial), tg_006, tg_007, tg_008 | high |

## Quarantine (with reason)

- **sec_004** (0.7) — a confirm step previewing the file's `llm_*` text before activation is a UX feature the approved spec (§8) deliberately replaced with the trust notice; not a drift fix. Candidate follow-up.
- **leg_003** (0.7) — `TemplateDeleteRefusalDetails` is a declared contract (spec §5.4/§5.7) whose counts the 409 message already carries; keeping the typed payload costs nothing and removing it would un-declare the contract. No action.
- **tg_009** (0.8) — a two-session `FOR UPDATE NOWAIT` test needs committed fixtures (the conftest session is savepoint-isolated, so its rows are invisible to a second connection). The lock is asserted by code (`with_for_update()`); left for a dedicated concurrency harness.
- **sec_001 (server half)** — a Content-Length 413 gate is platform-wide middleware, outside this slice; the client-side size cap lands in 004 and the middleware is a spawned follow-up.
