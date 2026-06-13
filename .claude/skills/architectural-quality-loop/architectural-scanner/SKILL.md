---
name: architectural-scanner
description: SCAN phase of the prumo architectural quality loop — dispatches 5 parallel Explore subagents (concept-drift, layered-arch, security, legacy-spotter, test-gaps) + runs the deterministic fitness scripts in scripts/fitness/. Emits findings.jsonl + telemetry.jsonl. Trigger when the user asks "scan for drift", "find legacy in <scope>", "audit extraction services", "what's wrong in this slice" — or as the SCAN phase of architectural-quality-loop. Standalone-invocable; produces a backlog you can act on manually without continuing into TRIAGE/PLAN/APPLY.
---

# Architectural Scanner (prumo)

Performs the SCAN phase of the architectural quality loop on a scoped slice. Two lanes run in parallel:

1. **Computational lane** — deterministic fitness scripts (`scripts/fitness/run_all.sh`), linters (`ruff`, `eslint`, `tsc`), `make db-lint-migrations` if migrations touched. Findings here have `confidence=1.0`.
2. **Inferential lane** — 5 Explore subagents in parallel, each specialised in one finding category. Findings here have shape-based confidence (≥ 0.7 floor).

Both lanes write to the same `findings.jsonl` with a shared schema; the orchestrator (the architectural-quality-loop meta-skill) reads it without caring which lane produced each row.

## When to use

- As the SCAN phase of `architectural-quality-loop`.
- Standalone, to produce a triaged backlog without running the loop: "scan `backend/app/services/extraction_*` and show me what's there."
- To verify a hypothesis: "is `frontend/types/extraction.ts` still referencing legacy concepts?"

## Output schema (`findings.jsonl`)

This is the **single contract** between the scanner and everything downstream. Every line is one JSON object. The orchestrator never invents fields; subagents and fitness scripts never deviate from this schema.

```json
{
  "run_id":            "2026-05-19-1430-extraction-services",
  "finding_id":        "f_001",
  "category":          "concept-drift|layered-arch|security|legacy|test-gaps|computational",
  "severity":          "high|medium|low",
  "confidence":        0.85,
  "file":              "backend/app/services/extraction_form_service.py",
  "line":              142,
  "evidence":          "...≤200 chars, verbatim quote when possible...",
  "suggested_action":  "...≤300 chars...",
  "source":            "subagent:concept-drift|fitness:check_legacy_concepts:<rule>|lint:ruff|lint:tsc",
  "glossary_term":     "extraction_entity_role",
  "blacklist_entry":   4,
  "fix_must_add":      "fitness-rule|regression-test|null"
}
```

Required: `run_id`, `finding_id`, `category`, `severity`, `confidence`, `file`, `line`, `evidence`, `suggested_action`, `source`.
Optional: `glossary_term`, `blacklist_entry`, `fix_must_add`.

**Confidence rubric:**
- `1.0` — deterministic (lint, fitness script, type error).
- `0.85` — glossary or blacklist exact match.
- `0.7..0.85` — shape-based LLM finding with concrete evidence quote.
- `< 0.7` — dropped to `findings_dropped.jsonl`; not in backlog.

## Dispatch mechanics

1. Resolve SCOPE to a list of file paths (expand glob from repo root).
2. **In parallel**, dispatch 5 Explore subagents (one per category below) AND run `scripts/fitness/run_all.sh --scope "<scope>"`.
3. Each subagent: 5-min timeout, 1 retry with the prior error as context. A retry failure emits one row with `severity=low confidence=0.5 source=subagent:<name>:failed` and `evidence="subagent timed out — see telemetry"`. Do **not** drop the failed subagent silently.
4. Aggregate all rows into `findings.jsonl`. Append a telemetry line per subagent + per fitness script to `telemetry.jsonl` (schema in `../references/telemetry-schema.md`).
5. Return path to the run-dir to the orchestrator.

## The 5 subagents

Each Explore subagent receives the SCOPE as `${SCOPE}` and the relevant reference files. Each must finish its response with a JSONL block where every line conforms to the schema above. The orchestrator parses lines after the marker `=== FINDINGS BEGIN ===` until `=== FINDINGS END ===`.

### `concept-drift`

> **Subagent prompt** (parameterised):
>
> You are the **concept-drift** scanner for prumo's architectural quality loop. Scope: `${SCOPE}`.
>
> Read `.claude/skills/architectural-quality-loop/references/concept-glossary.md` — it is the **only** source of canonical vocabulary. Then read every file in scope and find:
> 1. Identifiers, comments, or strings that contradict the glossary (e.g. calling something an `assessment` when the glossary calls it a `quality_assessment Run`).
> 2. Hardcoded magic strings or numbers that the glossary has promoted to enum/role (e.g. `name == 'prediction_models'` instead of role enum).
> 3. Domain words used in the wrong layer (e.g. "AI suggestion" vocabulary in a service that should speak in `ProposalRecord` terms).
>
> Emit one JSONL row per finding using the schema in §Output schema of `architectural-scanner/SKILL.md`. Set `category="concept-drift"`, `source="subagent:concept-drift"`, populate `glossary_term` when applicable. Bound `evidence` to 200 chars (a verbatim line is best). Confidence ≥ 0.7 only — drop softer hunches.
>
> Bracket your findings with `=== FINDINGS BEGIN ===` and `=== FINDINGS END ===`. Nothing else after the closing marker.

### `layered-arch`

> **Subagent prompt** (parameterised):
>
> You are the **layered-arch** scanner. Scope: `${SCOPE}`.
>
> The prumo backend layering (per `docs/reference/constitution.md` Principle I):
> - `app/api/v1/**` → may import from `app/services/**`, `app/schemas/**`, `app/core/**`, `app/utils/**`. Never from `app/repositories/**` or `app/models/**` directly.
> - `app/services/**` → may import from `app/repositories/**`, `app/schemas/**`, `app/models/**`, `app/core/**`, `app/utils/**`, other `app/services/**`. Never from `app/api/**`.
> - `app/repositories/**` → may import from `app/models/**`, `app/schemas/**`, `app/core/**`. Never from `app/services/**` or `app/api/**`.
> - `app/models/**` → no business logic; only ORM + relationships.
> - Cross-cutting OK: `app/core/**`, `app/utils/**`, `app/config/**`, `app/exceptions/**`, `app/domain/**`.
>
> Find imports or call sites that violate this DAG. Find routers that contain business logic (not just orchestration). Find services that call other services in cycles. Find repositories that hand-roll SQL when the model has a relationship. Find models with method bodies that smell like business logic.
>
> Emit one JSONL row per finding. `category="layered-arch"`, `source="subagent:layered-arch"`. Bracket with `=== FINDINGS BEGIN ===` / `=== FINDINGS END ===`.

### `security`

> **Subagent prompt** (parameterised):
>
> You are the **security** scanner. Scope: `${SCOPE}`.
>
> prumo is multi-tenant; every bug in `runs`, `extraction_*`, `hitl_*` is a candidate RLS/BOLA bug until proven otherwise. Look for:
> 1. **BOLA**: endpoints that take an entity id (project_id, run_id, article_id) but do not call `is_project_member(<id>, auth.uid())` or equivalent.
> 2. **TOCTOU on Run state**: code that reads `run.stage`, then mutates without `SELECT ... FOR UPDATE` or a database CHECK constraint guarding the transition.
> 3. **Missing RLS**: SQL inserts/updates into `extraction_*` or `project_*` tables outside an `is_project_*` policy context.
> 4. **Secret / PII in logs**: `structlog.info(... )` calls that include `api_key`, `password`, `pdf_url`, `extracted_text` (likely contains PII).
> 5. **Error swallowing**: `try ... except: pass`, `except Exception: return None`, `.catch(() => undefined)` that hides server errors from the user.
>
> Emit JSONL with `category="security"`, `severity="high"` for BOLA/TOCTOU/missing-RLS, `severity="medium"` for the others. `source="subagent:security"`. Bracket with markers.

### `legacy-spotter`

> **Subagent prompt** (parameterised):
>
> You are the **legacy-spotter** scanner. Scope: `${SCOPE}`.
>
> Read `.claude/skills/architectural-quality-loop/references/legacy-patterns.md` — the 16-entry blacklist of concepts that have been removed and must not return. Find:
> 1. Live references (code, not comments) to any blacklisted concept.
> 2. Dead exports: a symbol exported from a module but with zero importers in the rest of the scope.
> 3. Orphan files: a file with no importers and no role as a CLI / entry point.
> 4. `// removed`, `# removed`, `_unused` rename hacks, `is_*` flags that are never read.
> 5. Block-level comments that read like an "old way" reminder but with no live code referencing them — those comments themselves drift.
>
> Set `category="legacy"`, `source="subagent:legacy-spotter"`, populate `blacklist_entry` (1..16) when applicable. Confidence: live code reference to a blacklisted concept = 0.95; dead export with no importers = 0.85; orphan file = 0.8; suspicious comment = 0.7.

### `test-gaps`

> **Subagent prompt** (parameterised):
>
> You are the **test-gaps** scanner. Scope: `${SCOPE}`.
>
> For every public function/endpoint/router in scope, find whether at least one integration test (`backend/tests/integration/`) or vitest file in `frontend/test/` covers the **golden path**. Critical paths that must be covered:
> - HITL session open/close (`hitl_session_service.open_session`, `close_session`)
> - Run stage transitions (`run_lifecycle_service.advance_stage`)
> - ProposalRecord → ReviewerDecision → ConsensusDecision → PublishedState flow
> - RLS policy enforcement on `extraction_*` writes (a test that asserts a non-member is denied)
> - Template clone happy path + heal path
>
> If a critical path is uncovered, emit a finding with `category="test-gaps"`, `severity="high"`, `confidence=0.85`. Cite the public symbol and the missing test file path (where the test *would* live). `source="subagent:test-gaps"`.

## How to read `findings.jsonl` standalone

If you run this skill without the full loop, here is how to read what came back:

```bash
# How many findings by category?
jq -s 'group_by(.category) | map({category: .[0].category, count: length})' \
  docs/superpowers/quality-runs/<run-id>/findings.jsonl

# Top 10 highest-severity, highest-confidence:
jq -s 'sort_by(-.confidence, .severity != "high") | .[0:10]' \
  docs/superpowers/quality-runs/<run-id>/findings.jsonl

# All findings on one file:
jq 'select(.file == "backend/app/services/extraction_form_service.py")' \
  docs/superpowers/quality-runs/<run-id>/findings.jsonl

# Dropped (below confidence floor) — audit trail:
jq -s 'length' docs/superpowers/quality-runs/<run-id>/findings_dropped.jsonl
```

## Dedupe / aggregation note

The scanner itself does **not** dedupe — that is TRIAGE's job. The scanner writes every row from every subagent + every fitness script verbatim. If two subagents both flag `extraction_form_service.py:142`, both rows appear in `findings.jsonl`; TRIAGE will merge them via the `(file, line, category)` key with `max(severity, confidence)` and `evidence` concatenation.

This split keeps the scanner stateless and idempotent: re-running on the same tree produces the same `findings.jsonl`. Reproducibility is the gate property; if you observe non-determinism, that is a bug in a subagent prompt and must be fixed.

## Failure modes and recovery

| Mode | What you see | Recovery |
|---|---|---|
| Subagent times out (5 min) | Telemetry row `gate:"subagent:<name>" exit_code:124`; finding row with `confidence=0.5 source=...:failed` | Retry once with smaller scope; if still fails, the orchestrator continues with 4-of-5 lanes |
| Fitness script crashes | Telemetry row `exit_code` != 0 or 1 | Treat as a hard finding `category="computational" severity="high"` referencing the script; orchestrator surfaces in backlog |
| JSONL malformed | Orchestrator drops the malformed line and logs `parse_error` in telemetry | The subagent prompt's JSONL discipline failed — fix the prompt, do not band-aid the parser |
| `findings.jsonl` empty | Either the scope is genuinely clean OR all subagents dropped findings below confidence floor — check `findings_dropped.jsonl` to confirm | If `findings_dropped.jsonl` is also empty, scope is clean → orchestrator hands to CONVERGE |
