---
status: draft
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# Citation Phase 0 — Entailment Gate + Abstention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `verified` mean "the cited source entails the value" (not "the quote exists"), add first-class abstention, and add a citation eval harness to measure it — backend only.

**Architecture:** After extraction writes evidence, a separate `gpt-4o-mini` judge (run outside the extraction retry loop) plus a deterministic numeric/date/unit check classify each evidence row as `entailed | weak | unsupported`, stored on `extraction_evidence.attribution_label`. The citation read service derives `verified` from that label. The LLM output gains a `status` (`found | not_found | ambiguous`) so the model abstains instead of hallucinating. An offline ALCE-style scorer measures citation precision/recall.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery, pydantic-ai v1.107 (OpenAI `gpt-4o-mini`, NativeOutput), pytest.

## Global Constraints

- **LLM:** pydantic-ai + NativeOutput on OpenAI; default model `gpt-4o-mini`; structured output preserved. Reuse `build_model(settings.LLM_PROVIDER, model, api_key=...)` and `extract_structured(...)`.
- **The entailment gate runs OUTSIDE the extraction retry loop** (a separate judge call), never as a `ModelRetry` validator. Keep `output_retries >= 1` on the extraction call.
- **Abstention, not failure:** zero surviving evidence ⇒ record `not_found` / no proposal; never hard-fail-and-reask.
- **Migrations:** App schema = Alembic only (run inside `backend/`). Revision id **≤ 32 chars**. A migration touching `extraction_*` requires updating the migration-head line + `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`, and bumping the head-pin in `test_migration_roundtrip`.
- **Layering (CI-enforced):** `api → services → repositories → models`. New endpoints use the `ApiResponse` envelope + a typed response model.
- **Tests:** integration over mocks against local Supabase Postgres; for LLM calls use pydantic-ai `TestModel`. English only for code/comments/docs.
- **Keep ADR-0013:** a parser's markdown is never adopted; this phase does not touch the parser.

---

### Task 1: Add `status` (abstention) to the field output schema + prompt

**Files:**

- Modify: `backend/app/llm/schema.py:88-110` (`_field_result_model`), `:16` (`_PROPERTIES_PER_FIELD`)
- Modify: `backend/app/llm/prompts/section_extraction.py` (SYSTEM_PROMPT), `backend/app/llm/prompts/quality_assessment.py` (`_SYSTEM_TEMPLATE`)
- Test: `backend/tests/unit/test_llm_schema.py`

**Interfaces:**

- Produces: each per-field result model now has `status: Literal["found","not_found","ambiguous"]` alongside `value/confidence/reasoning/evidence`; `dump_extraction` returns it under each field.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_llm_schema.py
from app.llm.schema import build_output_models, dump_extraction

class _F:
    def __init__(self, name): self.name = name; self.field_type = "text"; self.is_required = False; self.allowed_values = None; self.llm_description = None; self.description = None

class _ET:
    def __init__(self, fields): self.fields = fields

def test_field_model_has_status():
    [model] = build_output_models(_ET([_F("dose")]))
    assert "status" in model.model_fields["field_0"].annotation.model_fields
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_llm_schema.py::test_field_model_has_status -v`
Expected: FAIL (`'status' not in ...`).

- [ ] **Step 3: Add `status` to `_field_result_model` and bump the property budget**

In `backend/app/llm/schema.py`, inside `_field_result_model(...)`'s `create_model(...)` add:

```python
        status=(
            Literal["found", "not_found", "ambiguous"],
            Field(
                description=(
                    "found = the value is present and supported by the article; "
                    "not_found = the article does not contain it; "
                    "ambiguous = present but unclear/conflicting."
                ),
            ),
        ),
```

And change the budget so chunking stays correct (status adds one property per field):

```python
_PROPERTIES_PER_FIELD = 8  # value, confidence, reasoning, evidence{text,page}, status
```

- [ ] **Step 4: Add the abstention instruction to both prompts**

Append to `section_extraction.py` SYSTEM_PROMPT and `quality_assessment.py` `_SYSTEM_TEMPLATE`:

```text
If the article does not contain the value, set status="not_found", value=null, and evidence=null — do NOT invent a value or a quote. Use status="ambiguous" when the value is present but unclear or conflicting. Only set status="found" when you can quote a passage that supports the value.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_llm_schema.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/schema.py backend/app/llm/prompts/section_extraction.py backend/app/llm/prompts/quality_assessment.py backend/tests/unit/test_llm_schema.py
git commit -m "feat(extraction): add status field + abstention instruction to extraction schema"
```

---

### Task 2: Deterministic numeric/date/unit value-support check

**Files:**

- Create: `backend/app/llm/value_support.py`
- Test: `backend/tests/unit/test_value_support.py`

**Interfaces:**

- Produces: `numeric_value_supported(value: str, text: str) -> bool` (True iff the normalized numeric value appears in the normalized text); `is_numeric_like(value: str) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_value_support.py
from app.llm.value_support import numeric_value_supported, is_numeric_like

def test_percent_forms_match():
    assert numeric_value_supported("12.5%", "reduced HbA1c by 12.5 percent at week 12")
    assert numeric_value_supported("0.125", "a fraction of 12.5%")
    assert not numeric_value_supported("13.0%", "reduced by 12.5%")

def test_is_numeric_like():
    assert is_numeric_like("12.5%")
    assert not is_numeric_like("metformin")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_value_support.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the pure module**

```python
# backend/app/llm/value_support.py
"""Deterministic value-presence checks for numeric/date/unit fields.

NLI alone is unreliable on exact numbers, so the entailment gate pairs a judge
with this check for numeric-like values. Pure, no IO."""

from __future__ import annotations

import re
import unicodedata

_NUM = re.compile(r"-?\d+(?:[.,]\d+)?")

def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).casefold()

def is_numeric_like(value: str) -> bool:
    return bool(_NUM.search(value or ""))

def _candidates(value: str) -> set[str]:
    """Normalized numeric forms a value may appear as (raw, %<->fraction)."""
    out: set[str] = set()
    for m in _NUM.findall(_norm(value)):
        n = m.replace(",", ".")
        out.add(n.rstrip("0").rstrip(".") if "." in n else n)
        try:
            f = float(n)
            out.add(str(f / 100).rstrip("0").rstrip("."))   # 12.5 -> 0.125
            out.add(str(f * 100).rstrip("0").rstrip("."))    # 0.125 -> 12.5
        except ValueError:
            pass
    return {c for c in out if c}

def numeric_value_supported(value: str, text: str) -> bool:
    text_nums = {
        (m.replace(",", ".").rstrip("0").rstrip(".") if "." in m.replace(",", ".") else m.replace(",", "."))
        for m in _NUM.findall(_norm(text))
    }
    return bool(_candidates(value) & text_nums)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_value_support.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/value_support.py backend/tests/unit/test_value_support.py
git commit -m "feat(extraction): deterministic numeric value-support check"
```

---

### Task 3: Entailment judge (separate LLM call)

**Files:**

- Create: `backend/app/llm/entailment.py`
- Test: `backend/tests/unit/test_entailment_judge.py`

**Interfaces:**

- Consumes: `extract_structured` (`backend/app/llm/extractor.py:66`), `Model` from pydantic-ai.
- Produces: `EntailmentVerdict(label: Literal["entailed","weak","unsupported"], rationale: str | None)`; `async judge_entailment(*, field_label: str, value: str, premise: str, model: Model) -> EntailmentVerdict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_entailment_judge.py
import pytest
from pydantic_ai.models.test import TestModel
from app.llm.entailment import judge_entailment

@pytest.mark.asyncio
async def test_judge_returns_label():
    model = TestModel(custom_output_args={"label": "entailed", "rationale": "states the dose"})
    v = await judge_entailment(field_label="dose", value="50 mg", premise="Patients got 50 mg twice daily.", model=model)
    assert v.label == "entailed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_entailment_judge.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the judge**

```python
# backend/app/llm/entailment.py
"""Entailment judge: does the cited passage SUPPORT the extracted value?

A separate gpt-4o-mini call, run OUTSIDE the extraction retry loop. Reuses the
structured-output path with a one-field verdict model for reliable parsing."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai.models import Model

from app.llm.extractor import extract_structured

NAME = "entailment_judge"
VERSION = "1"

_SYSTEM = (
    "You verify attribution. Given a CLAIM and a SOURCE passage, decide whether "
    "the source SUPPORTS the claim: 'entailed' (the source clearly states or "
    "directly implies the claim), 'weak' (related but does not establish it), or "
    "'unsupported' (the source does not support the claim). Judge only the source "
    "shown; do not use outside knowledge."
)

AttributionLabel = Literal["entailed", "weak", "unsupported"]

class EntailmentVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: AttributionLabel = Field(description="entailed | weak | unsupported")
    rationale: str | None = Field(description="One short sentence; null if none.")

async def judge_entailment(*, field_label: str, value: str, premise: str, model: Model) -> EntailmentVerdict:
    user = (
        f'CLAIM: "{field_label} = {value}"\n\n'
        f'SOURCE:\n"""\n{premise}\n"""\n\n'
        "Does the SOURCE support the CLAIM?"
    )
    verdict, _usage = await extract_structured(
        output_model=EntailmentVerdict,
        system_prompt=_SYSTEM,
        user_prompt=user,
        model=model,
        prompt_name=NAME,
        prompt_version=VERSION,
        output_retries=1,
    )
    return verdict
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_entailment_judge.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/entailment.py backend/tests/unit/test_entailment_judge.py
git commit -m "feat(extraction): entailment judge for evidence support"
```

---

### Task 4: `attribution_label` column on `extraction_evidence` + migration

**Files:**

- Modify: `backend/app/models/extraction.py:464-546` (`ExtractionEvidence`)
- Create: `backend/alembic/versions/0034_evidence_attr_label.py` (autogenerated)
- Modify: `docs/reference/extraction-hitl-architecture.md` (migration-head line + `last_reviewed`)
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head-pin)
- Test: `backend/tests/integration/test_extraction_evidence_model.py`

**Interfaces:**

- Produces: `ExtractionEvidence.attribution_label: Mapped[str | None]` (values `entailed|weak|unsupported`; null = legacy/ungated).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_extraction_evidence_model.py
from app.models.extraction import ExtractionEvidence

def test_evidence_has_attribution_label_column():
    assert "attribution_label" in ExtractionEvidence.__table__.columns
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_extraction_evidence_model.py -v`
Expected: FAIL (no such column).

- [ ] **Step 3: Add the column to the model**

In `backend/app/models/extraction.py`, in `ExtractionEvidence`, after `text_content`:

```python
    attribution_label: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Autogenerate + apply the migration**

```bash
cd backend && uv run alembic revision --autogenerate -m "evidence attribution_label"
```

Verify the generated file is named with id ≤ 32 chars (rename to `0034_evidence_attr_label` if needed) and contains `op.add_column("extraction_evidence", sa.Column("attribution_label", sa.Text(), nullable=True))`. Then:

```bash
cd backend && uv run alembic upgrade head
```

- [ ] **Step 5: Update the arch doc + roundtrip head-pin**

Bump the migration-head line and `last_reviewed: 2026-06-27` in `docs/reference/extraction-hitl-architecture.md`, and update the head-pin in `backend/tests/integration/test_migration_roundtrip.py` to the new revision id.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_extraction_evidence_model.py tests/integration/test_migration_roundtrip.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction.py backend/alembic/versions/0034_evidence_attr_label.py docs/reference/extraction-hitl-architecture.md backend/tests/integration/test_migration_roundtrip.py backend/tests/integration/test_extraction_evidence_model.py
git commit -m "feat(extraction): extraction_evidence.attribution_label + migration"
```

---

### Task 5: `gate_evidence` — combine numeric check + judge into a label

**Files:**

- Modify: `backend/app/llm/entailment.py`
- Test: `backend/tests/unit/test_gate_evidence.py`

**Interfaces:**

- Consumes: `numeric_value_supported`, `is_numeric_like` (Task 2), `judge_entailment` (Task 3).
- Produces: `async gate_evidence(*, field_label: str, value: str, premise: str, model: Model) -> AttributionLabel`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_gate_evidence.py
import pytest
from pydantic_ai.models.test import TestModel
from app.llm.entailment import gate_evidence

@pytest.mark.asyncio
async def test_numeric_absent_is_unsupported_without_calling_judge():
    # Judge would say entailed, but the number isn't in the premise -> unsupported.
    model = TestModel(custom_output_args={"label": "entailed", "rationale": "x"})
    label = await gate_evidence(field_label="dose", value="99 mg", premise="Patients got 50 mg.", model=model)
    assert label == "unsupported"

@pytest.mark.asyncio
async def test_text_value_uses_judge():
    model = TestModel(custom_output_args={"label": "weak", "rationale": "x"})
    label = await gate_evidence(field_label="drug", value="metformin", premise="They used a biguanide.", model=model)
    assert label == "weak"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_gate_evidence.py -v`
Expected: FAIL (`gate_evidence` undefined).

- [ ] **Step 3: Implement `gate_evidence`**

Append to `backend/app/llm/entailment.py`:

```python
from app.llm.value_support import is_numeric_like, numeric_value_supported

async def gate_evidence(*, field_label: str, value: str, premise: str, model: Model) -> AttributionLabel:
    """Numeric-like values must appear deterministically in the premise; then the
    judge decides entailed vs weak. Non-numeric values are judged directly."""
    if is_numeric_like(value) and not numeric_value_supported(value, premise):
        return "unsupported"
    verdict = await judge_entailment(field_label=field_label, value=value, premise=premise, model=model)
    return verdict.label
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_gate_evidence.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/entailment.py backend/tests/unit/test_gate_evidence.py
git commit -m "feat(extraction): gate_evidence combines numeric check + judge"
```

---

### Task 6: Wire the gate into `_create_suggestions` + honor abstention

**Files:**

- Modify: `backend/app/services/section_extraction_service.py:1207-1396` (`_create_suggestions`)
- Test: `backend/tests/integration/test_section_extraction_gate.py`

**Interfaces:**

- Consumes: `gate_evidence` (Task 5), `build_model` (`backend/app/llm/provider.py:17`), `self._anchor_blocks` / `AnchorMatch.block_ids` (from `build_anchor`).
- Produces: every `ExtractionEvidence` written by an AI run carries `attribution_label`; fields with `status != "found"` write no value proposal.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_section_extraction_gate.py
# Uses the autouse SEED fixture + db_session_real. Patches the judge model with TestModel.
import pytest
from pydantic_ai.models.test import TestModel
from app.services import section_extraction_service as ses

@pytest.mark.asyncio
async def test_evidence_gets_attribution_label(db_session_real, seed, monkeypatch):
    monkeypatch.setattr(ses, "build_model", lambda *a, **k: TestModel(custom_output_args={"label": "entailed", "rationale": "ok"}))
    # ... run extract_section against a seeded article whose block contains the value ...
    # assert the written ExtractionEvidence row has attribution_label == "entailed"
```

(Flesh out the run + assertion using the existing `test_section_extraction*` integration helpers in `backend/tests/integration/`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_gate.py -v`
Expected: FAIL (label is null — gate not wired).

- [ ] **Step 3: Honor abstention in the proposal loop**

In `_create_suggestions`, inside `for field_name, value in extracted_data.items():`, after unpacking, skip non-found fields:

```python
            if isinstance(value, dict) and value.get("status") in ("not_found", "ambiguous"):
                continue
```

(Values with `status="found"` but `value is None` are already skipped by the existing `if value is None` guard.)

- [ ] **Step 4: Run the gate over built evidence and set the label**

After the field loop builds `ExtractionEvidence` rows (before `await self.db.flush()`), collect each `(evidence_row, field_label, value_str, premise)` where `premise` is the cited block text plus its neighbours, resolved from `self._anchor_blocks` via the anchor's `block_ids`. Then:

```python
            llm_model = build_model(settings.LLM_PROVIDER, self._model, api_key=self._llm_api_key)
            labels = await asyncio.gather(*[
                gate_evidence(field_label=fl, value=v, premise=p, model=llm_model)
                for (_row, fl, v, p) in gated
            ])
            for (row, *_), label in zip(gated, labels):
                row.attribution_label = label
```

Bound concurrency with the existing pattern (`max_concurrency` on a shared agent or an `asyncio.Semaphore`); judge only `status="found"` fields that produced evidence.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_gate.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/integration/test_section_extraction_gate.py
git commit -m "feat(extraction): run entailment gate over AI evidence; honor abstention"
```

---

### Task 7: `verified = entailed` + expose `attributionLabel` in the read path

**Files:**

- Modify: `backend/app/services/citation_read_service.py:40-109`
- Test: `backend/tests/integration/test_citation_read_service.py`

**Interfaces:**

- Consumes: `ExtractionEvidence.attribution_label` (Task 4), `evidence_is_grounded` (legacy fallback).
- Produces: each citation dict has `verified: bool` (= label is `entailed`; legacy null label falls back to `evidence_is_grounded(position)`) and `attributionLabel: str | None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_citation_read_service.py
# Seed two evidence rows (attribution_label "entailed" and "weak") on one article.
@pytest.mark.asyncio
async def test_verified_follows_attribution_label(db_session_real, seed):
    rows = await list_article_citations(db_session_real, article_id)
    by_label = {r["attributionLabel"]: r for r in rows}
    assert by_label["entailed"]["verified"] is True
    assert by_label["weak"]["verified"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_citation_read_service.py -v`
Expected: FAIL (`attributionLabel` key missing; `verified` still position-based).

- [ ] **Step 3: Derive `verified` from the label**

In `list_article_citations`, where the row dict is built (currently `verified = evidence_is_grounded(position)`):

```python
        label = row.attribution_label
        verified = (label == "entailed") if label is not None else evidence_is_grounded(position)
        # ... add to the returned dict:
        "verified": verified,
        "attributionLabel": label,
```

Select `attribution_label` in the underlying query so it is loaded.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_citation_read_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/citation_read_service.py backend/tests/integration/test_citation_read_service.py
git commit -m "feat(extraction): verified=entailed; expose attributionLabel in citation read"
```

---

### Task 8: Citation eval harness (ALCE-style precision/recall)

**Files:**

- Create: `backend/scripts/citation_eval/__init__.py`, `backend/scripts/citation_eval/scoring.py`, `backend/scripts/citation_eval/manifest.py`
- Test: `backend/tests/unit/test_citation_eval_scoring.py`

**Interfaces:**

- Produces: pure scorers `citation_precision(pred, gold) -> float`, `citation_recall(pred, gold) -> float`, `value_accuracy(pred, gold) -> float`, over a frozen manifest shape `{doc_id, fields: [{name, gold_value, supporting_spans: [str]}]}` vs predictions `{name, value, evidence: [str]}`. A span "supports" iff its normalized text overlaps a gold supporting span (reuse `normalize_text` from `parsing_bakeoff.scoring`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_citation_eval_scoring.py
from citation_eval.scoring import citation_precision, citation_recall

def test_precision_penalizes_unsupported_citation():
    gold = {"dose": ["patients got 50 mg"]}
    pred = {"dose": ["patients got 50 mg", "unrelated sentence"]}
    assert citation_precision(pred, gold) == 0.5

def test_recall_rewards_finding_the_span():
    gold = {"dose": ["patients got 50 mg"]}
    pred = {"dose": ["50 mg twice daily was given"]}
    assert citation_recall(pred, gold) == 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_citation_eval_scoring.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the pure scorers**

```python
# backend/scripts/citation_eval/scoring.py
"""ALCE-style citation precision/recall over a gold span set. Pure, stdlib-only
(mirrors parsing_bakeoff.scoring) so it unit-tests without parsers or PDFs."""

from __future__ import annotations

import re
import unicodedata

def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s).casefold()).strip()

def _supports(pred_span: str, gold_spans: list[str]) -> bool:
    p = normalize_text(pred_span)
    return any(normalize_text(g) in p or p in normalize_text(g) for g in gold_spans)

def citation_precision(pred: dict[str, list[str]], gold: dict[str, list[str]]) -> float:
    total = supported = 0
    for name, spans in pred.items():
        for span in spans:
            total += 1
            if _supports(span, gold.get(name, [])):
                supported += 1
    return supported / total if total else 1.0

def citation_recall(pred: dict[str, list[str]], gold: dict[str, list[str]]) -> float:
    total = found = 0
    for name, gold_spans in gold.items():
        for g in gold_spans:
            total += 1
            if any(_supports(s, [g]) for s in pred.get(name, [])):
                found += 1
    return found / total if total else 1.0
```

Add `manifest.py` (loader for the gold JSON) and `__init__.py` mirroring `parsing_bakeoff` (the `pythonpath = ["scripts"]` pytest config already lets tests import `citation_eval.*`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_citation_eval_scoring.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/citation_eval/ backend/tests/unit/test_citation_eval_scoring.py
git commit -m "feat(eval): ALCE-style citation precision/recall scorer"
```

---

## Self-Review

- **Spec coverage (P0):** entailment gate (Tasks 3, 5, 6) ✓; `verified`=entailed (Task 7) ✓; deterministic numeric check (Task 2) ✓; abstention `found/not_found/ambiguous` (Tasks 1, 6) ✓; citation eval harness — ALCE precision/recall (Task 8) ✓. **Reslotted:** parser table metric (TEDS/bbox-IoU) → P3 (parser plan); frontend amber rendering → P1 (multi-citation UI); the API already exposes `attributionLabel` (Task 7) for it.
- **Gold-labelled corpus (20–50 PMC/PLOS papers):** Task 8 ships the scorer + manifest shape; provisioning the labelled set + a CI smoke subset is a data step folded into Task 8's manifest (no public fixtures are committed — same posture as `parsing_bakeoff`).
- **Type consistency:** `AttributionLabel` (`entailed|weak|unsupported`) is defined once in `entailment.py` and reused by `gate_evidence` and stored in `attribution_label`; `status` (`found|not_found|ambiguous`) is the schema field, distinct from the label. `gate_evidence`/`judge_entailment` keyword signatures match their call sites.
- **Constraints honored:** gate is a separate call outside the retry loop; `output_retries >= 1` untouched; abstention skips proposals rather than failing; migration id ≤ 32 chars; arch-doc + roundtrip head-pin updated.
