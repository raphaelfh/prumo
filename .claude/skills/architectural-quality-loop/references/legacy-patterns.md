# Legacy patterns blacklist

Every entry is a concept that has been explicitly removed from prumo and must not return. The numbering matches the `blacklist_entry` field in `findings.jsonl` and the `Pattern.blacklist_entry` constant in `scripts/fitness/check_legacy_concepts.py`.

Two tiers:

- **Hard** (4 entries) — re-introduction fails `scripts/fitness/check_legacy_concepts.py` and blocks the gate.
- **Warn** (12 entries) — reported in the JSONL but does not fail. Graduates to hard once the false-positive rate is low enough.

## Hard tier — gate-blocking

| # | Pattern | Where it lived | First removed in | Replacement |
|---|---|---|---|---|
| 1 | `ai_suggestions` SQL identifier (`FROM/JOIN/INTO/TABLE/UPDATE/DELETE FROM ai_suggestions`) | `public.ai_suggestions` table | migration `20260428_0019` (archived) | `extraction_proposal_records` with `source='ai'`. `aiSuggestionService.ts` (camelCase frontend service) remains legitimate and aggregates over the proposal-records table. |
| 2 | `extracted_values` SQL identifier (same shapes) | `public.extracted_values` table | migration `0002_drop_extracted_values` | `extraction_reviewer_decisions` (per-user in-flight) + `extraction_published_states` (canonical post-consensus). Frontend `ExtractionValueService` is the single entry point. |
| 4 (py) | `name == 'prediction_models'` equality check in Python | `backend/app/services/*.py` historic | migration `20260418_0016` + 2026-05-19 cleanup wave | `extraction_entity_role` enum (`study_section`/`model_container`/`model_section`). Backend: `ExtractionEntityTypeRepository.get_by_role()`. Frontend: `partitionEntityTypes` in `frontend/lib/extraction/entityTypeRoles.ts`. |
| 4 (ts) | `name === 'prediction_models'` equality check in TypeScript | `frontend/components/extraction/*` historic | migration 0016 + 2026-05-19 cleanup | same — see partitionEntityTypes. |

## Warn tier — reported, does not block

| # | Pattern | First removed in | Rationale (why it must not return) |
|---|---|---|---|
| 3 | `extraction_evidence.target_type` / `extraction_evidence.target_id` | migration `20260413_0017` | Replaced by polymorphic CHECK constraint pointing Evidence at exactly one of `proposal_record_id` / `reviewer_decision_id` / `consensus_decision_id`. |
| 5 | `suggestion_status` enum | migration `20260428_0019` | Status now derived from reviewer_state's current decision. Proposal records are status-less append-only. |
| 6 | `extraction_source` enum | migration `0002_drop_extracted_values` | Replaced by `extraction_proposal_source` (ai/human/system). |
| 7 | `initializeArticleInstances` (frontend hook) | commit `77bc471` | Backend owns instance creation via `hitl_session_service`. Frontend no longer pre-seeds. |
| 8 | `calculate_model_progress` calling dropped tables (`extracted_values` or `ai_suggestions`) | 2026-05-17 bug hunt | Locked by `test_schema_drift.py::test_calculate_model_progress_signature_locked`. The function silently referenced dropped tables — schema-drift regression guard exists to catch it. |
| 9 | `EntityTreeNode` frontend type | commit `04040d5` | Unused after extraction-hooks consolidation. `ExtractionEntityTypeWithFields` is the canonical type. |
| 10 | `/api/v1/projects/{id}/qa-templates` endpoint | 2026-04-27 unification | Merged into `POST /api/v1/hitl/sessions` with `kind=quality_assessment`. |
| 11 | `/api/v1/qa-assessments` endpoint | 2026-04-27 unification | Same — merged into `POST /api/v1/hitl/sessions`. |
| 12 | `qa_template_clone_service` module | 2026-04-27 unification | Merged into `template_clone_service` (kind-parametrized). |
| 13 | `qa_assessment_session_service` module | 2026-04-27 unification | Merged into `hitl_session_service`. |
| 14 | `@react-pdf-viewer/*` packages | commit `a4335c3` + 2026-04-15 | Replaced by `pdfjs-dist` directly + custom `PdfJsEngine` in `@prumo/pdf-viewer`. |
| 15 | `response_formatter` module imports | commit `344dbcb` | Dead utility — endpoints handle serialization. Service returns domain objects. |
| 16 | Hardcoded user-facing strings outside `frontend/lib/copy/` | constitution §VI | All UI copy must route through `lib/copy/*` + `t(ns, key)` helper. Strings embedded in components violate the centralised i18n contract. (Tracked by code-review skill, not yet enforced by a deterministic check — too noisy without AST.) |

## Editing this file

- Adding an entry: pick the next free number (NOT the next available — preserve the historical ordering of `blacklist_entry` IDs). Update `scripts/fitness/check_legacy_concepts.py` with the regex + rationale + blacklist_entry. Add the canary fixture to `backend/tests/unit/scripts/test_check_legacy_concepts_canary.py`.
- Promoting from warn → hard: move the row from the warn table to the hard table; flip `tier="hard"` in the script; run the full pytest suite to confirm no false positives.
- Removing an entry: only if the underlying concept is truly back in canonical use (extremely rare). Add a migration note in `docs/reference/migrations.md` explaining why.
