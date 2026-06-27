---
status: draft
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# Citation P1 — Multiple Citations per Extracted Value (Prose) Implementation Plan

> **Note for the agentic worker:** Execute one `- [ ]` step at a time, in order.
> Each step is a bite-sized TDD loop: write the failing test exactly as given,
> run the verify command and read its output (RED), then write the minimum
> implementation to make it pass and re-run (GREEN). Never batch steps. Never
> mark a step done without running its verify command and reading the output.
> Stop and report if a verify command behaves differently than the step
> predicts — do not "fix forward" past an unexpected signal. All paths are
> relative to the repo root unless prefixed with `backend/`. Backend commands
> run from `backend/` (`cd backend && uv run ...`); frontend commands run from
> the **repo root** (`npm run ...`). The worktree is
> `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/condescending-einstein-c5c778`
> on branch `claude/citation-p1-multi-evidence` (off `dev`, P0 already merged).

## Goal

Turn per-field AI evidence from a single optional `Evidence` into a **list**
(cap ~3 primary spans, corroboration deferred), persist N `ExtractionEvidence`
rows per proposal ordered by `rank`, and flow that list to the UI **through the
suggestion read path the frontend already uses** (`load_suggestions` /
`get_suggestion_history` → `AISuggestionService`), rendering a multi-citation
list with an entailment-aware green/amber state. Also surface the resolved model
(`run.parameters["model"]`) as a "Model used" column in the Excel AI-metadata
export for extraction **and** QA.

Scope is **prose only** (§4.2 / §4.4 / §4.8 / §5 of
`docs/superpowers/specs/2026-06-27-citation-provenance-design.md`). Corroboration
is **primary-only in v1** — the LLM may emit up to ~3 spans, ordered by `rank`;
there is NO deterministic corroboration pass.

**Deferred to focused follow-ups (NOT in P1):**
- The per-project **selectable-default model** mechanism (settings service +
  manager-gated endpoint + FE model selector). P1 ships only the export
  transparency column reading whatever model the run already snapshotted.
- `evidence_role` / `evidence_kind` / `match_method` provenance columns (always
  constant in primary-only P1) — defer to corroboration / P3 / P4.
- A standalone `GET /articles/{id}/citations` endpoint — the read-side P0
  `list_article_citations` service stays untouched in P1; the UI consumes the
  suggestion path instead, so no new endpoint is added.
- `block_id` injection, table cell grids, figures, CSS highlight — P2–P4.

## Architecture

The data path for one AI extraction call:

```
LLM (NativeOutput)                build_output_models / _field_result_model
  evidence: list[Evidence]   ─────────────────────────────────────────────┐
                                                                           │
dump_extraction → {field: {value, confidence, reasoning, evidence:[...],   │
                            status}}                                        │
                                                                           ▼
section_extraction_service._create_suggestions
  for field:                                                  evidence_is_plausible
    record_proposal(...)                                      (list-aware validator)
    for rank, item in enumerate(evidence_items[:3]):  ┌── ExtractionEvidence row ──┐
      build_anchor(quote) → position                  │ rank = 0..n (LLM order)    │
      ExtractionEvidence(rank=rank, ...)              │ attribution_label (P0 gate)│
    (legacy single-dict tolerance → one row, rank=0)  └────────────────────────────┘
  run_entailment_gate(specs) → labels  (one spec per found row)
                                                                           ▼
extraction_suggestion_read_service.load_suggestions / get_suggestion_history
  group evidence by proposal_record_id → ORDERED list[EvidenceResponse]
    (order by rank, then id)                  ┌── EvidenceResponse ──┐
                                              │ text_content,page_num│
                                              │ blockIds, rank       │
                                              │ attributionLabel (P0)│
                                              └──────────────────────┘
                                                                           ▼
AISuggestionItem.evidence: list[EvidenceResponse]   (length-1 for legacy proposals)
  → generate:api-types → schema.d.ts  (FE type becomes a list)
                                                                           ▼
aiSuggestionService → AISuggestion.evidence: EvidenceCitation[]  (length-1 legacy)
                                                                           ▼
AISuggestionEvidence.tsx  (primary first + "also cited (n)"; green=entailed,
                           amber=weak/unsupported; each row Locate-able)

Export transparency (orthogonal):
AIProposalRow.model_used ← run.parameters["model"] per proposal (extraction + QA)
  → "Model used" column in the AI-metadata Excel sheet
```

`extraction_evidence` is **already** 1:N per proposal (`proposal_record_id` FK,
no uniqueness). P1 adds **one** column (`rank`) + one Alembic migration, changes
the **write loop** from one row to N rows, and the **read grouping** from
first-row-wins to an ordered list.

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic
  v2, pydantic-ai (NativeOutput), structlog. Tests: pytest (integration against
  local Supabase Postgres; LLM via pydantic-ai `FunctionModel`).
- **Frontend:** TypeScript strict, React 19 + Vite (React Compiler,
  `panicThreshold: all_errors`), TanStack Query (key factory), shadcn/Radix,
  in-house i18n `frontend/lib/copy/`. Tests: Vitest + MSW.
- **Default model:** `gpt-4o-mini` (`settings.LLM_DEFAULT_MODEL`); per-project
  selection deferred (see Goal).

## Global Constraints

These are prumo invariants. Violating any one fails CI or review. Copy them into
your working memory before each task.

- **App schema = Alembic only.** Revision id **≤ 32 chars**
  (`alembic_version.version_num` is `varchar(32)`). A migration touching
  `extraction_*` ⇒ in the **same change** update the migration-head line +
  `last_reviewed` in `docs/reference/extraction-hitl-architecture.md` (head line
  at ~L109) **and** the `test_migration_roundtrip` head-pin (currently
  `0034_evidence_attr_label` at `tests/integration/test_migration_roundtrip.py`
  L270) **and** add a per-migration round-trip test that **downgrades to the
  explicit parent** `0034_evidence_attr_label` (never `downgrade -1`). Never
  apply app-schema DDL via the Supabase MCP. Backfill legacy rows via
  `server_default`.
- **No raw INSERT of evidence in tests.** `extraction_evidence` has NOT NULL FKs
  (`project_id`, `article_id`, `run_id`, `created_by`) and the
  `workflow_target_present` CHECK (one of proposal/reviewer/consensus). The SEED
  graph does **not** seed any evidence/proposal rows (verified: SEED stops at
  instance). So migration backfill is proven via the `server_default` at the
  schema/columnar level — not a data row — exactly as `test_migration_0034_round_trip`
  does (column presence, no data). Evidence rows in service/read tests are created
  through `_create_suggestions` / `record_proposal`, never hand-INSERTed.
- **Typed responses, no `dict`.** Pydantic response models stay typed
  (`EvidenceResponse`, `AISuggestionItem`) — never `dict[str, Any]` payloads.
- **Backend tests integration-over-mocks** against local Supabase Postgres (RLS,
  CHECK constraints, deferred triggers are invisible to mocks). LLM calls use
  pydantic-ai **`FunctionModel`** (NOT `TestModel` — it bypasses NativeOutput).
- **Frontend / React Compiler.** NO `try/finally`/`throw` in component or hook
  bodies (IO goes through `frontend/services/*` returning `ErrorResult`/`toResult`).
  ALL user-facing copy via `frontend/lib/copy/` (no hardcoded strings). ALL
  TanStack query keys via the factory in `frontend/lib/query-keys/extraction.ts`.
  Import API shapes from `frontend/types/api/schema.d.ts` (regenerate with
  `npm run generate:api-types` after any schema change and commit the diff — the
  FE `evidence` type only becomes a list once `schema.d.ts` is regenerated;
  skipping it fails `tsc --noEmit`).
- **pydantic-ai NativeOutput;** default model `gpt-4o-mini`.
- **Backward-compat single→list** across the read service / reader: always return
  a list (**length 1** for legacy proposals with a single evidence row). A legacy
  single-evidence proposal must render and resolve identically to before.
- **English only.** Conventional commits.
- **At harden, run the FULL backend unit suite** (`cd backend && uv run pytest
  tests/unit -q`), not a subset — a prior phase's `status` field broke wiring
  that only the full suite caught.

---

### Task 1 — Evidence list in the LLM contract (`schema.py`)

Make the LLM emit `evidence: list[Evidence]` (cap enforced by prompt + a hard
slice downstream, not by the schema), keep the P0 `status` field, and keep
`dump_extraction` shape stable (the list flows through `model_dump(by_alias=True)`
unchanged).

**Files**
- `backend/app/llm/schema.py` (modify `_field_result_model`; adjust the
  `_PROPERTIES_PER_FIELD` doc/budget comment)
- `backend/tests/unit/llm/test_schema.py` (existing)

**Interfaces**
```python
# _field_result_model: evidence field becomes a list (was Evidence | None)
evidence=(
    list[Evidence],
    Field(
        description=(
            "Up to 3 short verbatim quotes from the article supporting the "
            "value, most direct first; [] when status is not_found."
        ),
    ),
),
```
`Evidence` itself is unchanged (`text: str`, `page_number: int | None`). Keep
`_PROPERTIES_PER_FIELD = 8` (value, confidence, reasoning, status, evidence +
Evidence{text,page} ≈ unchanged); verify the budget math in the test.

- [ ] **RED — evidence is a list of Evidence.** Add to
  `backend/tests/unit/llm/test_schema.py`:
  ```python
  from typing import get_args, get_origin
  from app.llm.schema import Evidence, _field_result_model


  def _field(name="primary_outcome", field_type="text", required=True):
      class _F:  # minimal duck-typed extraction_fields row
          pass
      f = _F()
      f.name = name
      f.label = name
      f.field_type = field_type
      f.allowed_values = None
      f.is_required = required
      f.llm_description = None
      f.description = None
      return f


  def test_field_result_evidence_is_list_of_evidence():
      model = _field_result_model(_field(), index=0)
      ann = model.model_fields["evidence"].annotation
      assert get_origin(ann) is list, f"evidence must be a list, got {ann!r}"
      assert get_args(ann) == (Evidence,), f"list item must be Evidence, got {get_args(ann)!r}"


  def test_field_result_keeps_status_field():
      model = _field_result_model(_field(), index=0)
      assert "status" in model.model_fields, "P0 status field must be preserved"
  ```
  Verify (expect FAIL — evidence is currently `Evidence | None`):
  `cd backend && uv run pytest tests/unit/llm/test_schema.py -q -k "evidence_is_list or keeps_status"`
- [ ] **GREEN — make evidence a list.** In `backend/app/llm/schema.py`
  `_field_result_model`, replace the `evidence=(Evidence | None, Field(...))`
  tuple with the `list[Evidence]` interface above. Update the module docstring
  line that says `evidence{text, page_number}` to note it is now a list, and the
  `_PROPERTIES_PER_FIELD` comment to mention `status` + list evidence. Re-run the
  same command (expect PASS).
- [ ] **RED — dump_extraction round-trips a list.** Add to the same file:
  ```python
  from app.llm.schema import build_output_models, dump_extraction


  def _entity_with_one_field():
      class _E:
          pass
      e = _E()
      e.id = "et-1"
      e.fields = [_field()]
      return e


  def test_dump_extraction_emits_evidence_list():
      [model] = build_output_models(_entity_with_one_field())
      instance = model.model_validate(
          {
              "primary_outcome": {
                  "value": "OS",
                  "confidence": 0.9,
                  "reasoning": "stated",
                  "status": "found",
                  "evidence": [
                      {"text": "overall survival", "page_number": 3},
                      {"text": "OS was the primary endpoint", "page_number": 3},
                  ],
              }
          }
      )
      dumped = dump_extraction(instance)
      ev = dumped["primary_outcome"]["evidence"]
      assert isinstance(ev, list) and len(ev) == 2
      assert ev[0]["text"] == "overall survival"
  ```
  Verify:
  `cd backend && uv run pytest tests/unit/llm/test_schema.py -q -k dump_extraction_emits_evidence_list`

### Task 2 — List-aware extraction validator (`validators.py`)

`evidence_is_plausible` iterates each field's `.evidence` as a single object and
calls `evidence.text` — it will break on a list. Make it iterate the list and
keep abstention valid (`[]` is fine). **Lands before the persistence task.**

**Files**
- `backend/app/llm/validators.py` (`evidence_is_plausible` only)
- `backend/tests/unit/llm/test_validators.py` (existing)

**Interfaces**
```python
def evidence_is_plausible(output: Any) -> Any:
    for field_name, field_info in type(output).model_fields.items():
        label = field_info.alias or field_name
        field_result = getattr(output, field_name)
        evidence_list = getattr(field_result, "evidence", None) or []
        for idx, evidence in enumerate(evidence_list):
            if not evidence.text.strip():
                raise ModelRetry(
                    f"Field '{label}' evidence[{idx}]: evidence.text must be a "
                    "non-empty quote; omit the entry when there is no quote."
                )
            if evidence.page_number is not None and evidence.page_number < 1:
                raise ModelRetry(
                    f"Field '{label}' evidence[{idx}]: page_number must be a "
                    "1-based page number or null."
                )
    return output
```

- [ ] **RED — empty quote inside the list is rejected; empty list is OK.** Add to
  `backend/tests/unit/llm/test_validators.py` (reuse a `_field` helper — import
  from `test_schema` or duplicate the small factory):
  ```python
  import pytest
  from pydantic import ConfigDict, create_model
  from pydantic_ai import ModelRetry
  from app.llm.schema import _field_result_model
  from app.llm.validators import evidence_is_plausible


  def _output_with_evidence(ev_list):
      Field0 = _field_result_model(_field(), index=0)  # _field from Task 1
      Container = create_model(
          "C", __config__=ConfigDict(extra="forbid"),
          primary_outcome=(Field0, ...),
      )
      return Container.model_validate(
          {"primary_outcome": {"value": "x", "confidence": 1.0,
                               "reasoning": "r", "status": "found",
                               "evidence": ev_list}}
      )


  def test_plausible_rejects_blank_quote_in_list():
      out = _output_with_evidence([{"text": "ok", "page_number": 1},
                                   {"text": "  ", "page_number": 1}])
      with pytest.raises(ModelRetry):
          evidence_is_plausible(out)


  def test_plausible_accepts_empty_evidence_list():
      out = _output_with_evidence([])  # abstention
      assert evidence_is_plausible(out) is out
  ```
  Verify (expect FAIL — current code does `evidence.text` on a list):
  `cd backend && uv run pytest tests/unit/llm/test_validators.py -q -k "blank_quote_in_list or empty_evidence_list"`
- [ ] **GREEN — iterate the list.** Apply the `evidence_is_plausible` interface
  above. Re-run (expect PASS).

### Task 3 — Alembic migration: `extraction_evidence.rank`

Add a single `rank` column (Integer, `server_default "0"`) to
`extraction_evidence`, backfilling legacy rows to 0. Mirror the model. Update the
arch-doc head line + `last_reviewed`, bump the roundtrip head-pin, add a
round-trip test downgrading to the explicit parent `0034_evidence_attr_label`.

**Files**
- `backend/alembic/versions/0035_evidence_rank.py` (new — id `0035_evidence_rank`,
  18 chars, ≤ 32 OK)
- `backend/app/models/extraction.py` (`ExtractionEvidence`)
- `backend/tests/unit/test_extraction_models.py` (new)
- `backend/tests/integration/test_migration_roundtrip.py` (head-pin + new test)
- `docs/reference/extraction-hitl-architecture.md` (head line ~L109 +
  `last_reviewed` frontmatter)

**Interfaces**
```python
# ExtractionEvidence — new column (after attribution_label)
rank: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
# order of an evidence span within its proposal (0 = primary/first; LLM order)
```

- [ ] **RED — model declares `rank` with the right default.** Create
  `backend/tests/unit/test_extraction_models.py`:
  ```python
  from app.models.extraction import ExtractionEvidence


  def test_evidence_has_rank_column():
      cols = ExtractionEvidence.__table__.c
      assert "rank" in cols
      # A bare-string server_default's .arg is the string itself (no .text).
      assert cols["rank"].server_default.arg == "0"
      assert cols["rank"].nullable is False
  ```
  Verify (expect FAIL):
  `cd backend && uv run pytest tests/unit/test_extraction_models.py -q -k rank_column`
- [ ] **GREEN — add the column to the model.** Insert the `rank` `mapped_column`
  into `ExtractionEvidence` (right after `attribution_label`). Re-run (PASS).
- [ ] **GREEN — autogenerate + hand-verify the migration.** Run
  `cd backend && uv run alembic revision --autogenerate -m "evidence rank"`,
  then **rename** the generated file to `0035_evidence_rank.py` and set inside it
  `revision = "0035_evidence_rank"` and
  `down_revision = "0034_evidence_attr_label"`. Confirm `upgrade()` is a single
  `op.add_column("extraction_evidence", sa.Column("rank", sa.Integer(),
  nullable=False, server_default="0"), schema="public")` and `downgrade()` drops
  it. Verify offline SQL compiles (also catches the ≤32-char id):
  `cd backend && uv run alembic upgrade 0034_evidence_attr_label:0035_evidence_rank --sql >/dev/null && echo OK`
- [ ] **RED — round-trip integration test + head-pin bump.** Append to
  `tests/integration/test_migration_roundtrip.py` (mirror
  `test_migration_0034_round_trip`):
  ```python
  _EVIDENCE_RANK_COL = text(
      "SELECT 1 FROM information_schema.columns "
      "WHERE table_schema = 'public' AND table_name = 'extraction_evidence' "
      "AND column_name = 'rank'"
  )


  @pytest.mark.asyncio
  async def test_migration_0035_round_trip(db_session: AsyncSession) -> None:
      """0035 adds extraction_evidence.rank (server_default '0', backfilling
      legacy rows to 0). Downgrade to the explicit parent 0034_evidence_attr_label
      drops it; upgrade head restores it. Backfill is proven by the server_default
      at the column level (no data: SEED seeds no evidence rows and a raw INSERT
      would violate the NOT NULL FKs + workflow_target_present CHECK)."""
      assert (await db_session.execute(_EVIDENCE_RANK_COL)).scalar() == 1, (
          "rank must exist at HEAD"
      )

      _run_alembic("downgrade", "0034_evidence_attr_label")
      try:
          await db_session.commit()
          assert (await db_session.execute(_EVIDENCE_RANK_COL)).scalar() is None, (
              "downgrade must drop rank"
          )
      finally:
          _run_alembic("upgrade", "head")

      await db_session.commit()
      assert (await db_session.execute(_EVIDENCE_RANK_COL)).scalar() == 1, (
          "upgrade head must restore rank"
      )
  ```
  Also bump the head-pin assertion (L270) from `0034_evidence_attr_label` to
  `0035_evidence_rank`. Verify (needs local Supabase up + `alembic upgrade head`):
  `cd backend && uv run pytest tests/integration/test_migration_roundtrip.py -q -k "0035 or head_is_expected"`
- [ ] **GREEN — column-level default backfill assertion + docs.** Add to
  `test_extraction_models.py` an explicit assertion that the default backfills
  legacy rows (column-level, no data):
  ```python
  def test_rank_default_backfills_legacy_rows_to_zero():
      # server_default "0" is what backfills pre-existing rows at migration time;
      # asserting it here is the backfill contract (SEED seeds no evidence; a raw
      # INSERT can't satisfy the FKs + workflow_target_present CHECK).
      assert ExtractionEvidence.__table__.c["rank"].server_default.arg == "0"
  ```
  Then update `docs/reference/extraction-hitl-architecture.md`: change the head
  line (~L109) to `0035_evidence_rank` and set `last_reviewed: 2026-06-27`.
  Verify:
  `cd backend && uv run pytest tests/unit/test_extraction_models.py -q && grep -n "0035_evidence_rank" ../docs/reference/extraction-hitl-architecture.md`

### Task 4 — Persist N evidence rows per proposal (`section_extraction_service.py`)

Change the write loop in `_create_suggestions` from one `ExtractionEvidence` to
one per evidence entry (cap 3), assigning `rank` 0..n in LLM order, **keeping a
legacy single-dict tolerance branch**, and feeding **each** found-with-quote row
to the entailment gate (P0 `run_entailment_gate`).

**Files**
- `backend/app/services/section_extraction_service.py` (`_create_suggestions`
  field loop ~L1349–1414; the `evidence_meta` block becomes a list build)
- `backend/tests/integration/test_section_extraction_evidence.py` (verify with
  `ls backend/tests/integration | grep -i section_extraction`; create if absent)

**Interfaces**
```python
EVIDENCE_CAP = 3  # module constant near the top of the service

# inside the field loop, replacing the single evidence_meta block:
raw_evidence = value.get("evidence") if isinstance(value, dict) else None
evidence_items: list[dict[str, Any]] = []
if isinstance(raw_evidence, list):
    for e in raw_evidence:
        if isinstance(e, dict) and (e.get("text") or "").strip():
            evidence_items.append(
                {"text": str(e["text"]).strip(), "page_number": e.get("page_number")}
            )
elif isinstance(raw_evidence, dict) and (raw_evidence.get("text") or "").strip():
    # LEGACY tolerance: old P0 shape was a single evidence dict → one row, rank 0.
    evidence_items.append(
        {"text": str(raw_evidence["text"]).strip(),
         "page_number": raw_evidence.get("page_number")}
    )
evidence_items = evidence_items[:EVIDENCE_CAP]

for rank, item in enumerate(evidence_items):
    quote = item["text"]
    pos = build_anchor(quote, _anchor_blocks) if _anchor_blocks and quote else None
    position = pos.model_dump(by_alias=True, mode="json") if pos is not None else {}
    page_num = pos.anchor.range.page if pos is not None else item.get("page_number")
    ev_row = ExtractionEvidence(
        project_id=project_id,
        article_id=article_id,
        article_file_id=_anchor_file_id if pos is not None else None,
        run_id=run.id,
        proposal_record_id=proposal.id,
        page_number=page_num,
        text_content=quote,
        position=position,
        rank=rank,
        created_by=UUID(self.user_id),
    )
    self.db.add(ev_row)
    if isinstance(value, dict) and value.get("status") == "found":
        _gate_specs.append(GateSpec(
            field_label=field_label_map.get(field_name, field_name),
            value_str=str(inner_value), quote=quote, pos=pos,
            anchor_blocks=_anchor_blocks,
        ))
        _gate_rows.append(ev_row)
```
The gate fan-out + `zip(_gate_rows, labels, strict=True)` block stays as-is — it
now assigns labels across all rows.

- [ ] **RED — two evidence entries write two ranked rows.** Add an integration
  test that drives `_create_suggestions` (or the public `extract_section` path
  with a `FunctionModel` returning two evidence quotes) and asserts two
  `ExtractionEvidence` rows exist for the proposal with `rank` 0 and 1. Mirror the
  fixture style of the existing section-extraction integration tests (autouse
  `SEED`, scope by `project_id`). Verify (expect FAIL — current loop writes one
  row):
  `cd backend && uv run pytest tests/integration/test_section_extraction_evidence.py -q -k two_ranked_rows`
- [ ] **GREEN — loop over evidence_items.** Apply the interface above to
  `_create_suggestions`, adding the `EVIDENCE_CAP` constant. Re-run (PASS).
- [ ] **RED — legacy single-dict shape writes one row at rank 0.** Add a test that
  feeds `value["evidence"]` as a **single dict** (the old P0 shape, not a list)
  and asserts exactly one `ExtractionEvidence` row with `rank == 0`. Verify
  (expect PASS only with the legacy branch present — this guards it):
  `cd backend && uv run pytest tests/integration/test_section_extraction_evidence.py -q -k legacy_single_dict`
- [ ] **RED — abstention writes zero rows; cap caps at 3.** Add two cases: a
  `not_found` field writes no evidence rows; a field with 5 quotes writes exactly
  3 (`rank` 0–2). Verify:
  `cd backend && uv run pytest tests/integration/test_section_extraction_evidence.py -q -k "abstention_no_rows or caps_at_three"`
- [ ] **GREEN — confirm cap + abstention.** The `[:EVIDENCE_CAP]` slice and the
  existing status skip satisfy both. Re-run (expect PASS).

### Task 5 — Suggestion read path returns an ordered evidence list

Update the suggestion read service (the path the UI actually uses) to group
evidence by `proposal_record_id` into an **ordered** `list[EvidenceResponse]`
(order by `rank`, then `id`) instead of taking only the first row, and widen the
schema. Add `rank` + `attributionLabel` (from P0) to `EvidenceResponse`. Legacy
proposals with a single evidence row yield a length-1 list.

**Files**
- `backend/app/services/extraction_suggestion_read_service.py` (`load_suggestions`
  step 3 + step 5; `get_suggestion_history` evidence grouping + item build)
- `backend/app/schemas/extraction_suggestion.py` (`EvidenceResponse`,
  `AISuggestionItem.evidence`, `AISuggestionHistoryItem.evidence`)
- `backend/tests/integration/test_suggestion_read.py` (existing — verify with
  `ls backend/tests/integration | grep -i suggestion`)

**Interfaces**
```python
# app/schemas/extraction_suggestion.py — EvidenceResponse gains rank + label
class EvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    proposal_record_id: UUID | None
    text_content: str | None
    page_number: int | None
    block_ids: list[int] = Field(default_factory=list, alias="blockIds", ...)
    rank: int = 0
    attribution_label: str | None = Field(default=None, alias="attributionLabel")

# AISuggestionItem + AISuggestionHistoryItem
    evidence: list[EvidenceResponse]  # was EvidenceResponse | None; [] when none
```
```python
# extraction_suggestion_read_service.py — group into an ordered list
# (replaces evidence_by_proposal: dict[UUID, ExtractionEvidence] taking first row)
evidence_by_proposal: dict[UUID, list[ExtractionEvidence]] = {}
for ev in evidence_rows:
    if ev.proposal_record_id:
        evidence_by_proposal.setdefault(ev.proposal_record_id, []).append(ev)
for rows in evidence_by_proposal.values():
    rows.sort(key=lambda e: (e.rank, str(e.id)))

# item build (both load_suggestions and get_suggestion_history):
evidence_list = [
    EvidenceResponse(
        proposal_record_id=p.id,
        text_content=ev.text_content,
        page_number=ev.page_number,
        blockIds=_extract_block_ids(ev),
        rank=ev.rank,
        attributionLabel=ev.attribution_label,
    )
    for ev in evidence_by_proposal.get(p.id, [])
]
# ...AISuggestionItem(..., evidence=evidence_list, ...)
```

- [ ] **RED — load_suggestions returns ordered list with rank + label.** In
  `test_suggestion_read.py`, seed (via `_create_suggestions` / `record_proposal`,
  never raw INSERT) a proposal with two evidence rows (rank 1 then 0, one labelled
  `entailed`), call `load_suggestions`, and assert the item's `evidence` is a
  length-2 list ordered rank 0 then 1, with `attribution_label` preserved. Verify
  (expect FAIL — service returns a single `EvidenceResponse | None`):
  `cd backend && uv run pytest tests/integration/test_suggestion_read.py -q -k ordered_list`
- [ ] **GREEN — group + widen schema.** Apply both interfaces (schema +
  service, in `load_suggestions` and `get_suggestion_history`). Re-run (PASS).
- [ ] **RED — legacy single-evidence proposal → length-1 list.** Seed a proposal
  with one evidence row (default `rank=0`, NULL `attribution_label`) and assert
  `evidence` is a length-1 list with `rank == 0` and `attribution_label is None`.
  Verify (locks backward-compat):
  `cd backend && uv run pytest tests/integration/test_suggestion_read.py -q -k legacy_length_one`
- [ ] **GREEN — regenerate API types (FE list type).** From repo root run
  `npm run generate:api-types` and commit the `frontend/types/api/{openapi.json,
  schema.d.ts}` diff. The FE `AISuggestionItem.evidence` must now be a list —
  verify:
  `grep -n "EvidenceResponse" frontend/types/api/schema.d.ts && git -C .. diff --stat frontend/types/api/`

### Task 6 — Frontend: multi-citation render (primary first + "also cited (n)")

Change `AISuggestion.evidence` from a single object to a list, map it in the
service from the new server list, and render the list in `AISuggestionEvidence.tsx`
with green (entailed) vs **amber** (weak/unsupported) state per row and per-row
Locate. Length-1 for legacy.

**Files**
- `frontend/types/ai-extraction.ts` (`AISuggestion.evidence` → list type)
- `frontend/services/aiSuggestionService.ts` (map server list → `EvidenceCitation[]`)
- `frontend/components/extraction/ai/AISuggestionEvidence.tsx` (render list +
  amber/green)
- `frontend/lib/copy/extraction.ts` (verify path; add copy keys
  `evidenceAlsoCited`, `attributionWeak`, `attributionUnsupported`,
  `attributionEntailed`)
- Tests: `frontend/components/extraction/ai/AISuggestionEvidence.test.tsx`
  (new/extend), `frontend/services/aiSuggestionService.test.ts` (extend)

**Interfaces**
```ts
// types/ai-extraction.ts
export interface EvidenceCitation {
  text: string;
  pageNumber?: number | null;
  blockIds: number[];
  attributionLabel?: 'entailed' | 'weak' | 'unsupported' | null;
  rank: number;
}
export interface AISuggestion {
  // ...unchanged fields...
  evidence?: EvidenceCitation[];  // [] / undefined when none; length-1 for legacy
}
```
`aiSuggestionService.ts`: `item.evidence` is now a server **list**; map it to
`EvidenceCitation[]` sorted by `rank` (fall back to `[]` when empty/absent).
`AISuggestionEvidence.tsx`: accept `evidence: EvidenceCitation[]`; render the
first (lowest-`rank`) item as the primary block (existing layout), and when
`length > 1` render the rest collapsed under a
`t('extraction','evidenceAlsoCited').replace('{{n}}', String(length-1))` toggle.
Per item, choose the left-border + badge tone: `attributionLabel === 'entailed'`
→ green; `weak`/`unsupported` → **amber** (with the matching copy key);
`null`/legacy → existing neutral primary tone. No `try/finally`/`throw` — keep the
existing clipboard `.then/.catch`. `onLocate?: (rank: number) => void` so each row
locates its own span.

- [ ] **RED — service maps a citation list.** In `aiSuggestionService.test.ts`,
  feed a server item whose `evidence` is the new list shape (two entries, ranks
  0/1, labels `entailed`/`weak`) and assert `mapItemToSuggestion` returns
  `evidence` as a length-2 array, primary first, with `attributionLabel`
  preserved; feed an item with `evidence: []` and assert `evidence` is `[]`.
  Verify (expect FAIL — mapper builds a single object from `item.evidence.text_content`):
  `npm run test:run -- aiSuggestionService`
- [ ] **GREEN — map to list.** Update `mapItemToSuggestion` /
  `mapHistoryItemToSuggestion` to build `EvidenceCitation[]` from the server
  evidence list (sorted by `rank`). Update the `AISuggestion.evidence` type and
  add the `EvidenceCitation` export. Re-run (expect PASS).
- [ ] **RED — component renders primary + "also cited" + amber + legacy.** In
  `AISuggestionEvidence.test.tsx` render with two citations (one `entailed`, one
  `weak`); assert the primary quote is visible, an "also cited (1)" affordance is
  present, and the weak row carries the amber attribution copy
  (`t('extraction','attributionWeak')`). Add a legacy case: a length-1 list with
  `attributionLabel: null` renders exactly the old single-block layout (no "also
  cited"). Verify (expect FAIL — component takes a single `evidence` object):
  `npm run test:run -- AISuggestionEvidence`
- [ ] **GREEN — render the list + tones + copy.** Add the copy keys to
  `frontend/lib/copy/extraction.ts`, and rewrite `AISuggestionEvidence` per the
  interface. Update all call sites passing the old single-object prop to pass the
  list (search: `grep -rn "AISuggestionEvidence" frontend/components frontend/pages`).
  Re-run (expect PASS).
- [ ] **GREEN — typecheck + lint clean (React Compiler gate).** Verify:
  `npm run lint && npx tsc --noEmit`

### Task 7 — Export transparency: "Model used" column (extraction + QA)

Add a `model_used` field to `AIProposalRow` (resolved from
`run.parameters["model"]` per proposal) and a "Model used" header to the
AI-metadata sheet, for extraction **and** QA exports. (Per-project model
*selection* is deferred — this task only surfaces whatever model the run already
snapshotted.)

**Files**
- `backend/app/services/extraction_export_service.py` (`AIProposalRow` dataclass
  ~L195; `_resolve_ai_proposal_rows` row build ~L1783 — needs run→model lookup)
- `backend/app/services/exports/extraction/ai_metadata.py` (`_HEADERS` ~L26;
  `_VALUE_COLS` / `_TIMESTAMP_COL` 1-based index constants)
- `backend/tests/unit/test_extraction_ai_metadata_builder.py` (existing — its
  assertions use 0-based tuple indices: `row[9]`=timestamp, `row[10]`=outcome,
  `row[11]`=final value; these SHIFT when "Model used" is inserted)
- `backend/tests/integration/test_extraction_export*.py` (extend the AI-metadata
  case)

**Interfaces**
```python
# AIProposalRow — insert model_used AFTER proposed_at, BEFORE reviewer_outcome
# (keeps "Final value used" last; field order == header order via astuple):
    proposed_at: datetime
    model_used: str          # resolved run.parameters["model"], "" if absent
    reviewer_outcome: str
    final_value_used: Any
```
```python
# ai_metadata.py _HEADERS — insert "Model used" between "Proposed at" (col 10)
# and "Reviewer outcome". Resulting 1-based columns:
#   10 = "Proposed at"; 11 = "Model used"; 12 = "Reviewer outcome";
#   13 = "Final value used".
_VALUE_COLS = frozenset({5, 13})   # AI proposed value + Final value used
_TIMESTAMP_COL = 10                # unchanged
```
In `_resolve_ai_proposal_rows`, build `model_by_run: dict[UUID, str]` from the
in-scope runs (`run.parameters.get("model", "")`) and set
`model_used=model_by_run.get(rid, "")` on each row. The builder is `kind`-agnostic,
so QA gets the column for free — assert it.

- [ ] **RED — header + row carry the model (pure builder).** In
  `test_extraction_ai_metadata_builder.py`: add `"model_used": "gpt-4o"` to the
  `_proposal` factory's base dict, then update the existing 0-based index
  assertions for the shifted layout and add the new column. After the insert the
  AI-metadata headers are (0-based): 0 Article … 9 "Proposed at",
  10 "Model used", 11 "Reviewer outcome", 12 "Final value used". So assert:
  ```python
  # no-rows / header case:
  assert spec.rows[0][10].value == "Model used"
  assert spec.rows[0][12].value == "Final value used"
  # one-row case:
  assert row[9].value == "2026-05-23T10:00:00+00:00"   # timestamp unchanged
  assert row[10].value == "gpt-4o"                       # NEW
  assert row[11].value == "accepted"                     # was row[10]
  assert row[12].value == "Yes"                          # was row[11]
  ```
  Verify (expect FAIL — field absent, indices off):
  `cd backend && uv run pytest tests/unit/test_extraction_ai_metadata_builder.py -q`
- [ ] **GREEN — add field + header + index shift.** Add `model_used` to
  `AIProposalRow` (after `proposed_at`), insert `"Model used"` into `_HEADERS`
  (between "Proposed at" and "Reviewer outcome"), and update `_VALUE_COLS` to
  `{5, 13}`. Re-run (expect PASS).
- [ ] **RED — resolver fills model from run.parameters (extraction + QA).**
  Extend the export integration test: an extraction run with
  `parameters["model"]="gpt-4o-mini"` and a QA run with
  `parameters["model"]="gpt-4o"` both surface their model in the AI-metadata
  sheet's "Model used" column. Verify (expect FAIL — `_resolve_ai_proposal_rows`
  doesn't set it):
  `cd backend && uv run pytest "tests/integration/test_extraction_export*.py" -q -k model_used`
- [ ] **GREEN — wire model_by_run.** Build `model_by_run` in
  `_resolve_ai_proposal_rows` and set `model_used` on every `AIProposalRow`.
  Re-run (expect PASS).

### Task 8 — Harden & verify (whole-phase gate)

- [ ] **Full backend unit suite (the wiring guard).** A prior phase's `status`
  field broke wiring only the full suite caught — run all unit tests, not a
  subset. Verify:
  `cd backend && uv run pytest tests/unit -q`
- [ ] **Backend integration suite (DB-backed).** Local Supabase up + `alembic
  upgrade head` first (advisory-lock: never run concurrently). Verify:
  `cd backend && uv run alembic upgrade head && uv run pytest tests/integration -q`
- [ ] **Backend lint/format.** Verify:
  `make lint-backend`
- [ ] **Frontend tests + lint + typecheck.** From repo root. Verify:
  `npm run test:run && npm run lint && npx tsc --noEmit`
- [ ] **API contract is committed.** The widened `EvidenceResponse` /
  `AISuggestionItem.evidence` list landed in the generated schema. Verify
  (expect no diff):
  `npm run generate:api-types && git -C .. diff --exit-code frontend/types/api/`
- [ ] **Migration head is consistent everywhere.** Confirm the head-pin, the
  arch-doc head line, and the actual head agree. Verify:
  `cd backend && uv run alembic heads && grep -n "0035_evidence_rank" tests/integration/test_migration_roundtrip.py ../docs/reference/extraction-hitl-architecture.md`
- [ ] **Manual smoke (optional, evidence-backed).** Run the local stack, open a
  run with an AI proposal that produced ≥2 evidence spans, and confirm the
  suggestion shows the primary quote + an "also cited (n)" toggle, an amber row
  for a weak label, and that the Excel export's AI-metadata sheet has a populated
  "Model used" column. Capture a screenshot or the cell value as evidence.

---

## Self-Review

Before opening a PR, confirm each of these against **run output**, not memory:

- **TDD discipline.** Every implementation step was preceded by a RED run whose
  failure you read, and followed by a GREEN run whose pass you read. No step was
  marked done on assertion alone (`verification-before-completion`).
- **Migration invariants (Task 3).** Revision id `0035_evidence_rank` is ≤ 32
  chars; `down_revision = "0034_evidence_attr_label"`; the round-trip test
  downgrades to that **explicit parent** (not `-1`); the head-pin (L270), the
  arch-doc head line (~L109), and `last_reviewed` were all bumped in the same
  change; `rank` backfills via `server_default "0"` (asserted at the column level
  — `.server_default.arg == "0"`, NOT `.arg.text`); no data migration and no raw
  evidence INSERT (NOT NULL FKs + `workflow_target_present` CHECK; SEED seeds no
  evidence).
- **No new endpoint.** P0's `list_article_citations` is untouched; the evidence
  list reaches the UI through `extraction_suggestion_read_service` — the path the
  frontend already consumes. No BOLA/typed-anchor/`ProjectNotFoundError` surface
  was added.
- **LLM testing.** Any test exercising the extraction call uses pydantic-ai
  `FunctionModel`, never `TestModel`.
- **Legacy single-dict + single-row compatibility.** The persistence loop keeps a
  single-dict tolerance branch (Task 4 has a `legacy_single_dict` test asserting
  one row at rank 0); the read service returns a **length-1** list for a
  single-evidence proposal (Task 5 `legacy_length_one`); the component renders a
  length-1 list as the old single-block layout (Task 6 legacy case).
- **API types regenerated + committed.** The FE `evidence` type is a list because
  `schema.d.ts` was regenerated (Task 5 GREEN); `tsc --noEmit` is clean.
- **Frontend constraints.** No `try/finally`/`throw` in component/hook bodies;
  all new copy lives in `frontend/lib/copy/`; query keys (if any added) come from
  the factory; API shapes imported from `schema.d.ts`; `npm run lint` and
  `tsc --noEmit` clean (React Compiler `all_errors` gate).
- **Scope honesty.** One migration column (`rank`) only — `evidence_role` /
  `evidence_kind` / `match_method` deferred. Per-project model **selection**
  (settings service + endpoint + FE selector) deferred; only the export
  transparency column ships. No `block_id`, table, figure, or highlight work.
- **Whole-suite harden.** The FULL backend unit suite ran green (Task 8), not a
  per-task subset.
- **Layering.** Services touch models/repositories only (no `api` imports, no HTTP
  objects); the read service returns typed Pydantic models, never ORM rows.
