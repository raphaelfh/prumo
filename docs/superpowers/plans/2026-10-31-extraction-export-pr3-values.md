# Export values and rule inputs (PR3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every export value becomes one typed `ExportValue`, built once from the stored envelope. Units, codes and labels stay apart (§4.6). Scope rules and appraisal read raw envelopes. A scope rule no longer overwrites a recorded answer.

**Architecture:**
- **`exports/values.py` (new).** Holds the single envelope→value projection (`to_export_value`), the matrix display projection (`display_value`), the option-label chain, and `peel_envelope` (moved).
- **Value map.** `ExportLayout.value_map` becomes `dict[ValueKey, ExportValue]`, keyed by one `value_key()` with no per-mode arity. `rater=None` is consensus only; every reviewer slot, single_user included, is keyed by its `reviewer_id` (R1).
- **One slot selector.** `exports/descriptors.primary_rater(mode, reviewer_id)` names the slot every single-slot reader reads: Matrix (non-all_users axis), Summary, tidy tables, AI rows, scope marking and the appraisal model. `ExportLayout.reviewer_id` carries the single_user target to the sheet builders.
- **Readers.** Matrix, Summary, tidy tables and AI rows render through `display_value`. The appraisal model keeps `ExportValue` verdicts (R3); the Appraisal sheet builder renders them through `display_value`. The scope rules and the derived judgments read `ExportValue.raw`.
- **Deleted.** `exports/value_envelope.py` and `derived_judgment_service._LABEL_TO_ABSENT_REASON`.

**Tech Stack:** Python 3.11, SQLAlchemy 2 async, pytest. Unit tests cover the pure functions; the DB paths are covered by integration tests against real Postgres.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md` §4.1 (closed value sets), §4.6, §5 rules 5 and 8, §8 rows `values.py` / `value_envelope.py` / `extraction_scope_marking.py` / `derived_judgment_service.py`, §11 row 3.

**Depends on:** PR1 (Delivery and safety) merges first in the §11 order. It re-signs the builders to `build_<x>(layout, titles)`, edits `matrix.py`/`workbook.py`, and renames the fixed titles ("Appraisal", "AI proposals"; R7), so rebase this branch on it. Line numbers below are against dev @ 4ad80f98. No dependency on PR2.

**Consumed later by:**
- PR4: `value_key`, `primary_rater` (level sheets, README counts), `display_value(v, field)` without `target` (R2), `build_option_labels` (PR4 adds defaulted `pinned_latest_first`; PR3 callers unchanged), `tests/unit/test_export_values.py` (R20).
- PR5: `ExportValue`, `to_export_value`, `OptionLabels`; PR5 deletes `_untyped_field` and its test (R15).
- PR6: adds `*, target` to `display_value` and updates every caller (R2); renders `AppraisalRow.domain_verdicts` (`ExportValue`) with `AppraisalModel.domain_fields` for Publication (R3).

**Branch:** `feat/export-values` off `dev`, in its own worktree (`git -C "$WT"` for every git call).

---

## Global Constraints

These are verbatim from the spec, limited to what this PR touches.

- **`status` closed set:** `answered`, `absent` (an absent marker), `rejected` (a real `reject` decision), `cleared` (an edit to null), `nonconforming` (legacy text that does not fit the field type; raw text kept in `value_text`).
- **`absent_code`:** the stored codes (`no_information`, `not_applicable`, `not_evaluated`).
- **Scope stamp:** "A scope-rule stamp is `status=absent`, `absent_code=not_applicable`, `out_of_scope=true`, `origin=rule`." `origin` lands in PR5.
- **§4.6 Matrix display:**

  | Type | Display |
  |---|---|
  | number | "7394 participants" |
  | select | the label (§4.4 chain), else the raw code |
  | multiselect | labels joined with `"; "` |
  | other | "Other: …" |
  | boolean | Yes / No |
  | date | ISO text |
  | absent marker | Matrix: the full label |
  | out-of-scope recorded value | the scope marker |
  | rejected / cleared | blank |

  On the machine side: number → `value_num` with the unit in `unit`, and text that does not parse → `nonconforming`. Select → the code in `value_text`.
- **D9 (owner default):** a single `other` answer leaves `value_text` blank, with the text in `other_text`. `unit` is the envelope unit only; the field's fixed unit is a display fallback. Derived overalls stay code-based.
- **R1 slots:** `value_key(run, instance, field, rater)`; `rater=None` is consensus only; every reviewer slot, single_user included, uses `rater=reviewer_id`. Single-slot readers call `primary_rater(mode, reviewer_id)`, never a literal `None`.
- **§5 rule 5:** "Nothing is read by name." Scope behaviour comes only from the frozen snapshot's `scope_rules`.
- **§5 rule 8:**
  - "Ranking is by option label, read from raw envelopes."
  - "'Overall (worst domain)' … ignores out-of-scope values."
  - **PR3 scope of rule 8:** the Appraisal domain columns and the legacy Overall (`_appraisal_overall`) rank `display_value` labels. The derived `worst_domain` / `signaling_worst` overalls (`derived_judgment_service.judgment_of:214-224`, `JUDGMENT_SEVERITY:62`) stay code-based (D9), on screen and workbook alike, so parity holds.
- **§8 scope marking:** "each slot uses its own classifier; stamp only empty cells; set `out_of_scope`".
- **§8 derived judgments:** `derived_judgment_service.py` "takes raw envelopes; delete `_LABEL_TO_ABSENT_REASON`".
- **`canonical_key` (§7, listed in §8's `values.py` row) is not in this PR.** The contract puts it in PR5, the PR that has its consumers (`origin_of`, Verification `match`).
- **Behaviour change, intentional:** an empty-string or empty-list payload (`{"value": ""}`, `{"value": []}`) was rendered as `""` and counted as filled in Summary (`summary.py:57-63`). It is now `cleared`: blank, and counted as empty.
- **Transitional code (R19):** the three value-map builders, `_load_ai_proposal_rows` and `_build_tidy_tables` get minimal rewrites that PR4 (tidy) and PR5 (value maps, AI rows) delete. Rewrite only the key and payload; no restructuring.
- **No DDL, no data migration.** Template-agnostic: no new name lookups.
- **House rules (contract):**
  - `ExportValue` is `@dataclass(frozen=True, slots=True)`.
  - `values.py` sits under `exports/`, never `exports/extraction/` (import cycle, `exports/extraction/__init__.py:12`). Service and sheet types are imported under `TYPE_CHECKING` only. The same holds for `exports/descriptors.py`: `ExportMode` (`extraction_export_service.py:89`) is a `TYPE_CHECKING` import there, so `primary_rater` compares the `StrEnum` by value.
- **Gates:**
  - `extraction_export_service.py` (2166 lines today) stays ≤ 2194 (`scripts/fitness/check_file_size.baseline:4`). New files are capped at 800 lines.
  - The mypy and vulture baselines only shrink.
  - ruff `ARG` is enabled (`backend/pyproject.toml:106`), so no unused parameters: `display_value` ships without `target` (R2) and `build_option_labels` without `pinned_latest_first` (PR4 adds it as a defaulted second parameter with its first input; PR3 callers stay valid).

## Review Focus

Each item below gets a test in the task that owns it.

1. **Non-finite numeric text** (`"nan"`, `"inf"`) in a NUMBER field must be `nonconforming`, never `value_num=nan`. `float("nan")` parses. (Task 1)
2. **A `bool` in a NUMBER field** (`bool` is an `int`) must be `nonconforming`, never `value_num=1`. (Task 1)
3. **Summary completeness.** An absent marker and a scope stamp count as filled. A cleared value counts as empty, and so does an empty string, which was filled before. (Task 2)
4. **single_user values live under the reviewer key and every reader finds them** (R1): matrix, Summary, AI rows, appraisal. No reader of a single_user layout looks up `rater=None`. (Task 2)
5. **Appraisal verdicts stay `ExportValue`** (R3); the Overall ranks their labels, so coded `L/U/H` verdicts still roll up. (Task 2)
6. **A cleared value in an out-of-scope section is recorded, not empty.** It is kept with `out_of_scope=True`, not replaced by a stamp. (Task 3)
7. **The classifier section is never stamped in a reviewer slot either,** under per-slot classification, even when the rule lists it. (Task 3)

## Tasks

### Task 1: `exports/values.py` — `ExportValue`, label chain, projections, `peel_envelope` moved

**Files:**
- Create: `backend/app/services/exports/values.py`
- Create: `backend/tests/unit/test_export_values.py` (R20: the one unit file for `values.py`)
- Modify: `backend/app/services/exports/value_envelope.py:16-76`. Delete the `PeeledValue`/`peel_envelope` bodies and import both from `values`. This is temporary: the whole file goes in Task 2.
- Modify: `backend/app/services/mcp_value_render.py:20`, repointed to `app.services.exports.values`.
- Modify: `backend/tests/unit/test_mcp_value_render.py:11`, repointed the same way.

**Interfaces — Produces** (`app.services.exports.values`):

```python
ExportStatus = Literal["answered", "absent", "rejected", "cleared", "nonconforming"]
OptionLabels = Mapping[tuple[UUID, str], str]          # (field_id, code) -> label

@dataclass(frozen=True, slots=True)
class PeeledValue: value: Any; unit: str | None; absent_reason: str | None   # moved verbatim
def peel_envelope(raw: Any) -> PeeledValue                                   # moved verbatim

@dataclass(frozen=True, slots=True)
class ExportValue:
    raw: Any                      # the stored envelope, untouched
    status: ExportStatus
    value_num: int | float | None = None
    value_text: str | None = None
    value_bool: bool | None = None
    value_label: str | None = None
    unit: str | None = None       # the ENVELOPE's unit only (D9)
    other_text: str | None = None
    absent_code: str | None = None
    out_of_scope: bool = False

def build_option_labels(active: Sequence[SectionDescriptor]) -> OptionLabels           # PR4 adds defaulted 2nd param pinned_latest_first
def to_export_value(raw: Any, field: FieldDescriptor, labels: OptionLabels, *, rejected: bool = False) -> ExportValue
def display_value(v: ExportValue, field: FieldDescriptor) -> CellValue                 # matrix rules; PR6 adds `*, target` (R2)
```

**Pinned projection.** The steps below are applied after `peel_envelope(raw)`, which also strips `verification` and peels double wraps.

| input | status | fields set |
|---|---|---|
| `rejected=True` | `rejected` | none; `raw` kept |
| marker `absent_reason` | `absent` | `absent_code` |
| peeled `None`, `""`, `[]` | `cleared` | none |
| NUMBER: `int`/`float` (not `bool`), finite | `answered` | `value_num`, `unit` |
| NUMBER: `str` that `int()` or else `float()` parses to a finite number | `answered` | `value_num` (`"22"` → `22`) |
| NUMBER: anything else | `nonconforming` | `value_text=str(payload)` |
| TEXT / DATE: `str`, `int` or `float` | `answered` | `value_text=str(payload)` |
| BOOLEAN: `bool` | `answered` | `value_bool` |
| SELECT: `str` code | `answered` | `value_text=code`, `value_label=labels.get((fid, code), code)` |
| SELECT: `{"selected":"other","other_text":t}` | `answered` | `other_text=t` (`value_text` stays `None`, D9) |
| MULTISELECT: `list[str]` | `answered` | `value_text="; ".join(codes)`, `value_label="; ".join(labels.get(c, c))` |
| MULTISELECT: `{"selected":[...],"other_texts":[...]}` | `answered` | the same for the codes, plus `other_text="; ".join(texts)` |
| any other shape (a dict where the type takes none, etc.) | `nonconforming` | `value_text=json.dumps(payload, sort_keys=True, ensure_ascii=False)` |

`display_value` rules, in order:
1. `out_of_scope` → `ABSENT_REASON_LABELS["not_applicable"]`.
2. `absent` → `ABSENT_REASON_LABELS[absent_code]`.
3. `rejected` / `cleared` → `None`.
4. `nonconforming` → `value_text`.
5. number → `f"{value_num} {unit}"`, where `unit = v.unit or field.unit`; the bare number when there is no unit.
6. boolean → `"Yes"` / `"No"`.
7. select / multiselect → `"; ".join([value_label?] + [f"Other: {t}" for each other text])`.
8. text / date → `value_text`.

**Implementation notes:**
- `build_option_labels` returns `{(f.field_id, av.value): av.label for s in active for f in s.fields for av in f.allowed_values}`.
- Import `FieldDescriptor` and `SectionDescriptor` (from `app.services.extraction_export_service`) and `CellValue` (from `app.services.exports.extraction.sheet_spec`) under `TYPE_CHECKING` only.

- [ ] **Step 1: Write the failing tests** in `backend/tests/unit/test_export_values.py`.

```python
def _field(ftype, *, options=(), unit=None, allow_other=False) -> FieldDescriptor:
    return FieldDescriptor(field_id=uuid4(), label="F", type=ftype,
        allowed_values=tuple(AllowedValue(c, l) for c, l in options), unit=unit, allow_other=allow_other)

def _labels(f): return build_option_labels([SectionDescriptor(entity_type_id=uuid4(), label="S",
    parent_entity_type_id=None, fields=(f,))])

def test_number_and_unit_are_split():
    f = _field(ExtractionFieldType.NUMBER)
    v = to_export_value({"value": 7394, "unit": "participants"}, f, {})
    assert (v.status, v.value_num, v.unit, v.value_text) == ("answered", 7394, "participants", None)
    assert display_value(v, f) == "7394 participants"

def test_field_unit_is_a_display_fallback_only():                  # D9
    f = _field(ExtractionFieldType.NUMBER, unit="kg")
    v = to_export_value({"value": 12}, f, {})
    assert v.unit is None and display_value(v, f) == "12 kg"

def test_double_wrap_and_verification_are_peeled():
    f = _field(ExtractionFieldType.NUMBER)
    v = to_export_value({"value": {"value": 5, "unit": "mg"}, "verification": {"verdict": "confirmed"}}, f, {})
    assert (v.value_num, v.unit) == (5, "mg")

def test_numeric_text_parses_and_garbage_is_nonconforming():
    f = _field(ExtractionFieldType.NUMBER)
    assert to_export_value({"value": "22"}, f, {}).value_num == 22
    for text in ("approx 5", "nan", "inf"):                       # Review Focus 1
        v = to_export_value({"value": text}, f, {})
        assert (v.status, v.value_num, v.value_text) == ("nonconforming", None, text)

def test_bool_in_a_number_field_is_nonconforming():               # Review Focus 2
    v = to_export_value({"value": True}, _field(ExtractionFieldType.NUMBER), {})
    assert (v.status, v.value_num, v.value_text) == ("nonconforming", None, "True")

def test_select_code_differs_from_label():
    f = _field(ExtractionFieldType.SELECT, options=(("L", "Low"), ("H", "High")))
    v = to_export_value({"value": "L"}, f, _labels(f))
    assert (v.value_text, v.value_label) == ("L", "Low") and display_value(v, f) == "Low"

def test_unknown_select_code_falls_back_to_the_code():
    f = _field(ExtractionFieldType.SELECT, options=(("L", "Low"),))
    v = to_export_value({"value": "X"}, f, _labels(f))
    assert (v.status, v.value_label, display_value(v, f)) == ("answered", "X", "X")

def test_multiselect_and_other():                                   # D9 for the single `other`
    f = _field(ExtractionFieldType.MULTISELECT, options=(("a", "A"), ("b", "B")), allow_other=True)
    v = to_export_value({"value": {"selected": ["a"], "other_texts": ["t1", "t2"]}}, f, _labels(f))
    assert (v.value_text, v.value_label, v.other_text) == ("a", "A", "t1; t2")
    assert display_value(v, f) == "A; Other: t1; Other: t2"
    s = _field(ExtractionFieldType.SELECT, options=(("x", "X"),), allow_other=True)
    one = to_export_value({"value": {"selected": "other", "other_text": "Cohort"}}, s, _labels(s))
    assert (one.value_text, one.other_text, display_value(one, s)) == (None, "Cohort", "Other: Cohort")

def test_boolean_and_date():
    b = _field(ExtractionFieldType.BOOLEAN)
    v = to_export_value({"value": False}, b, {})
    assert (v.value_bool, display_value(v, b)) == (False, "No")
    d = _field(ExtractionFieldType.DATE)
    assert to_export_value({"value": "2020-01-31"}, d, {}).value_text == "2020-01-31"

@pytest.mark.parametrize("code", ["no_information", "not_applicable", "not_evaluated"])
def test_absent_marker(code):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value({"value": None, "absent_reason": code}, f, {})
    assert (v.status, v.absent_code, display_value(v, f)) == ("absent", code, ABSENT_REASON_LABELS[code])

@pytest.mark.parametrize("raw", [{"value": None}, {"value": ""}, {"value": []}, None])
def test_cleared(raw):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value(raw, f, {})
    assert (v.status, display_value(v, f)) == ("cleared", None)

def test_rejected_keeps_raw_and_renders_blank():
    f = _field(ExtractionFieldType.TEXT)
    raw = {"value": "x"}
    v = to_export_value(raw, f, {}, rejected=True)
    assert (v.status, v.value_text, v.raw, display_value(v, f)) == ("rejected", None, raw, None)

def test_out_of_scope_renders_the_scope_marker():
    f = _field(ExtractionFieldType.TEXT)
    v = replace(to_export_value({"value": "High"}, f, {}), out_of_scope=True)
    assert (v.value_text, display_value(v, f)) == ("High", "Not applicable")
```

- [ ] **Step 2: Run them.** Command: `cd backend && uv run pytest tests/unit/test_export_values.py -q`. Expected FAIL: `ModuleNotFoundError: No module named 'app.services.exports.values'`.
- [ ] **Step 3: Implement `values.py`** with the signatures and tables above. Move `PeeledValue`/`peel_envelope` from `value_envelope.py:46-76` verbatim, and have `value_envelope.py` import them back. Repoint `mcp_value_render.py:20` and `test_mcp_value_render.py:11`.
- [ ] **Step 4: Run the tests.** Command: `cd backend && uv run pytest tests/unit/test_export_values.py tests/unit/test_mcp_value_render.py tests/unit/test_value_envelope.py -q`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(exports): add ExportValue and the option-label chain in exports/values.py`.

### Task 2: `value_map` carries `ExportValue` under one `value_key`; one primary slot; delete `value_envelope.py`

**Files:**
- Modify: `backend/app/services/exports/descriptors.py` (append after `:41`): `ValueKey`, `value_key`, `primary_rater`; `ExportMode` joins the `TYPE_CHECKING` import at `:33-37`.
- Modify: `backend/app/services/extraction_export_service.py`:
  - imports `:66-82`: drop `resolve_value`; import `ExportValue`, `OptionLabels`, `build_option_labels`, `display_value`, `to_export_value` and `ValueKey`, `value_key`, `primary_rater`.
  - `AppraisalRow.domain_verdicts` `:304` → `tuple[ExportValue | None, ...]`; docstring `:292-299` ("already-resolved scalars" goes).
  - `AppraisalModel` `:313-329`: add `domain_fields: tuple[FieldDescriptor, ...]` after `domain_labels`, aligned to it (no default: the sheet builder zips the two).
  - `ExportLayout` `:332-365`: `value_map: dict[ValueKey, ExportValue]` (`:345-348`, comment rewritten to R1); append `reviewer_id: UUID | None = None` (the single_user target; `None` in the other modes; PR4 and PR5 consume it).
  - `resolve_layout` `:441-605`:
    - `labels = build_option_labels(sections)`, passed to the three value-map builders and to `_load_ai_proposal_rows`;
    - `primary = primary_rater(mode, reviewer_id)`;
    - `mark_out_of_scope_values(..., raters=(primary, *(r.reviewer_id for r in reviewers)))` (`:519-526`; `reviewers` is empty outside all_users);
    - `_build_tidy_tables(sections, tuple(articles), value_map, primary)` (`:536`);
    - `_build_appraisal_model(..., reviewer_id=reviewer_id)` (`:576-584`);
    - `ExportLayout(..., reviewer_id=reviewer_id if mode is ExportMode.SINGLE_USER else None)` (`:586-605`).
  - `_build_appraisal_model` `:609-787`: new required kwarg `reviewer_id: UUID | None`; `primary = primary_rater(mode, reviewer_id)`.
    - verdicts (`:712-726`) are the `ExportValue | None` read at `value_key(run, inst, vfield.field_id, primary)` and, in all_users, at each `reviewer.reviewer_id`;
    - Overall (`:735`, `:775`) = `_appraisal_overall(tuple(None if v is None else display_value(v, f) for v, f in zip(verdicts, domain_fields)))`;
    - `domain_fields = tuple(vfield for _, vfield in domains)` (`:703`);
    - `article_values_by_coord(..., rater=primary)` (`:748`).
  - `_build_consensus_value_map` `:1085-1117`, `_build_single_user_value_map` `:1196-1251`, `_build_all_users_value_map` `:1466-1544`: add `labels: OptionLabels`; skip `field_id`s not in `fields_by_id`; keep `accept_proposal` → `proposed_value`, `edit` → `value`, `reject` omitted. Keys: consensus `value_key(rid, iid, fid, None)`; single_user `value_key(rid, iid, fid, reviewer_id)` (`:1248`, `:1250`; R1); all_users unchanged in shape.
  - New module-level `def _untyped_field(field_id: UUID) -> FieldDescriptor`, which returns `FieldDescriptor(field_id=field_id, label="", type=ExtractionFieldType.TEXT)`. It is the projection for a proposal on a field outside the active sections. It drops the envelope unit until PR5 rewrites the sheet and deletes it (R15, R19).
  - `_load_ai_proposal_rows` `:1546-1787`: add the `labels: OptionLabels` kwarg. `final_value_used` (`:1764-1769`) = `display_value` of `value_map.get(value_key(rid, iid, fid, primary_rater(mode, target_reviewer_id)))`. `ai_proposed_value` (`:1776`) = `display_value(to_export_value(proposed_value, f, labels), f)` with `f = field_desc_by_id.get(fid) or _untyped_field(fid)`.
  - tidy `:1896-1994`: `_tidy_value` → `display_value` of `value_map.get(value_key(..., rater))`; `_tidy_value`, `_tidy_row` and `_build_tidy_tables` take `rater: UUID | None` in place of `mode`.
  - reword the prose mentions of `resolve_value` at `:1096`, `:1583` and `:1797`.
- Modify: `backend/app/services/exports/extraction_scope_marking.py:45-152`:
  - `article_values_by_coord(*, article, sections, value_map, rater: UUID | None)` (required kwarg, replaces `is_all_users`) returns `v.raw` for each present entry whose `raw` is not `None`.
  - `mark_out_of_scope_values(*, rules_by_article, sections, articles, raters: Sequence[UUID | None], value_map)` writes `_STAMP = ExportValue(raw=None, status="absent", absent_code="not_applicable", out_of_scope=True)`. It replaces the `reviewers` and `is_all_users` params. Overwrite semantics are kept here; Task 3 changes them.
- Modify: `backend/app/services/exports/extraction/matrix.py`:
  - drop the import at `:31`.
  - `_lookup_value` `:99-118` → `value_map.get(value_key(article.run_id, instance_id, field.field_id, reviewer_id))`; the mode branch goes.
  - reviewer axis `:177-182`: all_users `(None, *reviewers)`; otherwise `(primary_rater(layout.mode, layout.reviewer_id),)`.
  - delete `_format_cell` and `_xlsx_safe` `:121-163`; cell = `display_value(v, field_desc)` when `v` is present (`:255-263`).
- Modify: `backend/app/services/exports/extraction/summary.py:31-66`. Delete `_consensus_value`; `_completeness` reads `value_key(run, inst, fid, primary_rater(layout.mode, layout.reviewer_id))`. Filled iff `display_value(v, field) is not None`.
- Modify: `backend/app/services/exports/extraction/appraisal_summary.py`:
  - verdict cells `:142` → `Cell(None if v is None else display_value(v, f))` over `zip(row.domain_verdicts, appraisal.domain_fields)`;
  - comment `:40-45` and docstrings `:3-5`: verdicts arrive as `ExportValue`; `_appraisal_overall` ranks the rendered labels.
- Modify: `backend/app/services/exports/extraction/ai_metadata.py`:
  - drop the import at `:21`, plus `_VALUE_COLS` `:40-46`.
  - `_coerce` keeps only the timestamp branch.
  - docstrings `:10-13` and `:86`.
- Modify docstrings and comments: `value_semantics.py:63`, `:83` (point them at `exports/values`).
- Modify: `backend/.mypy_baseline:48` (delete the `value_envelope.py:no-any-return` line).
- Delete: `backend/app/services/exports/value_envelope.py`, `backend/tests/unit/test_value_envelope.py`. Its cases are covered by `test_export_values.py`.
- Test: rewrite the `value_map` literals with `value_key(...)` keys and `ExportValue`/`to_export_value(...)` values, and drop the tests whose only subject is 3- vs 4-tuple arity.
  - `tests/unit/`:
    - `test_extraction_matrix_builder.py`: `_single_field_layout:353`, the boolean tests at `:375-410`; `_spec_layout:162` gains `reviewer_id: UUID | None = None`.
    - `test_extraction_xlsx_builder.py`: `:172`, `:221`, `test_format_cell_per_field_type:300`; delete `test_xlsx_safe_raises_on_dict:526`; the `AppraisalModel` at `:654`.
    - `test_extraction_export_determinism.py`: `:160`, `:282`, `:659`.
    - `test_extraction_export_shape_filter.py`: `:88`, and the `AppraisalModel` at `:122`.
    - `test_extraction_summary_builder.py:78`: `{value_key(run, inst, f0.field_id): to_export_value({"value": "filled"}, f0, {})}`.
    - `AppraisalModel`/`AppraisalRow` literals (add `domain_fields`; verdicts become `ExportValue`): `test_extraction_appraisal_summary_builder.py:18,27,129,166,199`, `test_appraisal_derived_overalls.py:35,55,91,118`, `test_extraction_workbook_orchestrator.py::_appraisal_model` (PR1 helper).
    - `_build_appraisal_model(...)` callers add `reviewer_id=None`: `test_extraction_appraisal_model_resolution.py` (8; comment `:92` too), `test_appraisal_derived_overalls.py` (6), `test_derived_overall_screen_workbook_parity.py` (1), `test_extraction_export_determinism.py` (1), `test_extraction_export_scope_marking.py` (1).
    - `test_derived_overall_screen_workbook_parity.py`: the `_workbook_overall` docstring at `:127`, and `:155` feeds `to_export_value(raw, field, {})`; drop the `resolve_value` import at `:23`.
    - `test_extraction_export_scope_marking.py`: `_mark` (`:123-139`) becomes `_mark(value_map, *, articles, raters: tuple[UUID | None, ...] = (None,), schema=None, sections=None)`, losing its `mode` and `reviewers` params. Asserts read `.out_of_scope`/`.absent_code`. Delete `test_all_users_classification_reads_the_consensus_sub_column` (`:203`).
    - `test_extraction_export_service.py`:
      - the `TestBuildConsensusValueMap:299`, `TestBuildAllUsersValueMap:1416` and `TestBuildSingleUserValueMap:2257` calls pass `fields_by_id` plus `labels={}`; `TestBuildSingleUserValueMap` asserts read `value_key(run_id, instance_id, field_id, reviewer_id)` and its docstring drops "3-tuple".
      - the AI-row calls pass `labels={}`; delete the methods `test_all_users_mode_uses_4_tuple_key_with_none` (`:1034`) and `test_consensus_mode_uses_3_tuple_key` (`:1102`).
      - reword the comment at `:356`.
    - `test_extraction_front_matter_builder.py:79-97`: the legend anti-drift test uses `display_value(to_export_value(marker, field, {}), field)`.
    - the `_build_tidy_tables(...)` callers pass `None` (consensus) in place of `ExportMode.CONSENSUS`: `test_extraction_export_tidy_model_section.py:81,116,131,142,161`, `test_extraction_export_tidy_tables_projection.py:69,95,113`, `test_extraction_export_front_matter_projection.py:53`.
    - `test_extraction_export_golden_charms.py:122`.
    - comment only: `test_extraction_appraisal_summary_builder.py:73`, `test_value_semantics.py:158`, `test_seed_probast_ai.py:163`.
  - `tests/integration/`: `test_extraction_export_value_resolution.py`, `test_qa_rules_frozen.py:311-345`, `test_run_lifecycle_service.py:1502` (add `labels={}`; assert on `v.value_text`); comment-only edits in `test_extraction_export_appraisal_summary.py:360,592`. `test_extraction_export_appraisal_summary.py::test_qa_all_users_and_single_user_overall` (`:497`) and `test_extraction_export_ai_outcome.py::test_ai_outcome_single_user_scoped_to_target` (`:347`) run unchanged as the end-to-end R1 guards.

  Files that only pass `value_map={}` need no change. `test_derived_judgment_service.py:232` and `test_derived_judgment_no_information.py:91` belong to Task 4.

**Interfaces:**
- Consumes the Task 1 symbols.
- Produces in `descriptors.py`:
  ```python
  ValueKey = tuple[UUID, UUID, UUID, UUID | None]
  def value_key(run_id: UUID, instance_id: UUID, field_id: UUID, rater: UUID | None = None) -> ValueKey
  def primary_rater(mode: ExportMode, reviewer_id: UUID | None) -> UUID | None
      # None for consensus and all_users; reviewer_id for single_user (R1)
  ```
  `rater=None` is consensus only.
- `ExportLayout.value_map: dict[ValueKey, ExportValue]`; `ExportLayout.reviewer_id: UUID | None = None` (single_user target; read by PR4 level sheets/README and PR5 loaders via `primary_rater`).
- `AppraisalRow.domain_verdicts: tuple[ExportValue | None, ...]`; `AppraisalModel.domain_fields: tuple[FieldDescriptor, ...]` (R3).
- `_build_appraisal_model(*, sections, articles, reviewers, value_map, mode, reviewer_id, rules_by_article=None)`.
- `_load_ai_proposal_rows(..., labels: OptionLabels)`; `_untyped_field(field_id: UUID) -> FieldDescriptor`.
- `_build_tidy_tables(sections, articles, value_map, rater: UUID | None)`.
- `article_values_by_coord(*, article, sections, value_map, rater: UUID | None)`.

- [ ] **Step 1: Write the failing tests.**

```python
# tests/unit/test_extraction_export_descriptors.py
def test_primary_rater_is_the_reviewer_only_in_single_user() -> None:
    r = uuid4()
    assert primary_rater(ExportMode.CONSENSUS, None) is None
    assert primary_rater(ExportMode.ALL_USERS, None) is None
    assert primary_rater(ExportMode.SINGLE_USER, r) == r
    assert value_key(*(k := (uuid4(), uuid4(), uuid4()))) == (*k, None)

# tests/unit/test_extraction_matrix_builder.py
def test_select_cell_shows_the_option_label_not_the_code() -> None:
    sec_id = uuid4()
    field = FieldDescriptor(field_id=uuid4(), label="Risk", type=ExtractionFieldType.SELECT,
        allowed_values=(AllowedValue("L", "Low"), AllowedValue("H", "High")))
    labels = build_option_labels([SectionDescriptor(entity_type_id=sec_id, label="Section",
        parent_entity_type_id=None, fields=(field,))])
    ws = _render_matrix(_single_field_layout(field, to_export_value({"value": "L"}, field, labels), sec_id=sec_id))
    assert _value_cell(ws, field) == "Low"

def test_single_user_cell_reads_the_reviewer_slot() -> None:              # Review Focus 4
    sec_id, r = uuid4(), uuid4()
    field = FieldDescriptor(field_id=uuid4(), label="N", type=ExtractionFieldType.TEXT)
    layout = replace(_single_field_layout(field, to_export_value({"value": "mine"}, field, {}), sec_id=sec_id, rater=r),
        mode=ExportMode.SINGLE_USER, reviewer_id=r)                       # helper keys the value under `rater`
    assert _value_cell(_render_matrix(layout), field) == "mine"

# tests/unit/test_extraction_appraisal_model_resolution.py           (Review Focus 5)
def test_overall_ranks_coded_verdicts_by_label() -> None:
    lhu = (AllowedValue("L", "Low"), AllowedValue("U", "Unclear"), AllowedValue("H", "High"))
    d1, d2 = _section("D1", _field("RoB", allowed_values=lhu), 0), _section("D2", _field("RoB", allowed_values=lhu), 1)
    labels = build_option_labels([d1, d2])
    run_id, i1, i2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    article = ArticleDescriptor(article_id=uuid.uuid4(), header_label="A", run_id=run_id, version_id=None,
        entries={(d1.entity_type_id, None): (i1,), (d2.entity_type_id, None): (i2,)})
    model = ExtractionExportService._build_appraisal_model(sections=(d1, d2), articles=(article,), reviewers=(),
        value_map={value_key(run_id, i1, d1.fields[0].field_id): to_export_value({"value": "L"}, d1.fields[0], labels),
                   value_key(run_id, i2, d2.fields[0].field_id): to_export_value({"value": "U"}, d2.fields[0], labels)},
        mode=ExportMode.CONSENSUS, reviewer_id=None)
    assert model is not None
    assert model.domain_fields == (d1.fields[0], d2.fields[0])
    assert tuple(v.value_text for v in model.rows[0].domain_verdicts) == ("L", "U")
    assert model.rows[0].overall == "Unclear"

def test_single_user_verdicts_read_the_reviewer_slot() -> None:            # Review Focus 4
    d1 = _section("D1", _field("RoB", allowed_values=(AllowedValue("H", "High"),)), 0)
    run_id, i1, r = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    article = ArticleDescriptor(article_id=uuid.uuid4(), header_label="A", run_id=run_id, version_id=None,
        entries={(d1.entity_type_id, None): (i1,)})
    model = ExtractionExportService._build_appraisal_model(sections=(d1,), articles=(article,), reviewers=(),
        value_map={value_key(run_id, i1, d1.fields[0].field_id, r): to_export_value({"value": "H"}, d1.fields[0], {})},
        mode=ExportMode.SINGLE_USER, reviewer_id=r)
    assert model is not None and model.rows[0].overall == "H"   # unlabelled code ranks as unknown → most severe

# tests/unit/test_extraction_appraisal_summary_builder.py
def test_verdict_cells_render_through_display_value() -> None:
    f = FieldDescriptor(field_id=uuid.uuid4(), label="RoB", type=ExtractionFieldType.SELECT,
        allowed_values=(AllowedValue("L", "Low"),))
    appraisal = AppraisalModel(domain_section_ids=(uuid.uuid4(), uuid.uuid4()), domain_labels=("P", "Q"),
        domain_fields=(f, f), rows=(AppraisalRow(article_id=uuid.uuid4(), record_label="Gaca, 2011",
            domain_verdicts=(to_export_value({"value": "L"}, f, {(f.field_id, "L"): "Low"}), None),
            overall="Low", per_reviewer_overall={}),))
    layout = _layout_with_appraisal(appraisal)   # existing helper, test file :87
    # ExportShape (workbook.py:41) and allocate_titles (PR1) from app.services.exports.extraction.workbook
    spec = build_appraisal_summary(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))
    assert tuple(c.value for c in spec.rows[1]) == ("Gaca, 2011", "Low", None, "Low")

# tests/unit/test_extraction_summary_builder.py  (Review Focus 3)
def test_completeness_counts_markers_and_stamps_not_cleared_values() -> None:
    marker, stamp, cleared, empty = (_field() for _ in range(4))
    section = SectionDescriptor(entity_type_id=uuid4(), label="Study", parent_entity_type_id=None,
        fields=(marker, stamp, cleared, empty), cardinality=ExtractionCardinality.ONE, sort_order=0)
    run, inst = uuid4(), uuid4()
    article = ArticleDescriptor(article_id=uuid4(), header_label="Gaca, 2011", run_id=run, version_id=None,
        entries={(section.entity_type_id, None): (inst,)})
    value_map = {
        value_key(run, inst, marker.field_id): to_export_value({"value": None, "absent_reason": "no_information"}, marker, {}),
        value_key(run, inst, stamp.field_id): ExportValue(raw=None, status="absent", absent_code="not_applicable", out_of_scope=True),
        value_key(run, inst, cleared.field_id): to_export_value({"value": None}, cleared, {}),
        value_key(run, inst, empty.field_id): to_export_value({"value": ""}, empty, {}),  # was "filled" before PR3
    }
    assert _completeness(_layout((section,), (article,), value_map), article, None) == (2, 4)

def test_single_user_completeness_reads_the_reviewer_slot() -> None:       # Review Focus 4
    f, r = _field(), uuid4()
    section = SectionDescriptor(entity_type_id=uuid4(), label="Study", parent_entity_type_id=None,
        fields=(f,), cardinality=ExtractionCardinality.ONE, sort_order=0)
    run, inst = uuid4(), uuid4()
    article = ArticleDescriptor(article_id=uuid4(), header_label="A", run_id=run, version_id=None,
        entries={(section.entity_type_id, None): (inst,)})
    layout = replace(_layout((section,), (article,), {value_key(run, inst, f.field_id, r): to_export_value({"value": "x"}, f, {})}),
        mode=ExportMode.SINGLE_USER, reviewer_id=r)
    assert _completeness(layout, article, None) == (1, 1)

# tests/unit/test_extraction_export_service.py
def test_ai_row_value_for_a_field_outside_the_active_version() -> None:   # PR5 deletes it with _untyped_field (R15)
    f = _untyped_field(uuid4())
    show = lambda raw: display_value(to_export_value(raw, f, {}), f)
    assert show({"value": "Cohort"}) == "Cohort"
    assert show({"value": 5}) == "5"
    assert show({"value": {"b": 1, "a": 2}}) == '{"a": 2, "b": 1}'
    assert show({"value": None, "absent_reason": "not_evaluated"}) == ABSENT_REASON_LABELS["not_evaluated"]

class TestBuildSingleUserValueMap:                                          # Review Focus 4
    async def test_value_is_keyed_by_the_reviewer(self):
        svc, r = _make_service(), uuid4()
        run_id, instance_id, field_id = uuid4(), uuid4(), uuid4()
        svc.db.execute = AsyncMock(return_value=_rows_result([(run_id, instance_id, field_id, "edit", {"value": "e"}, None)]))
        f = FieldDescriptor(field_id=field_id, label="F", type=ExtractionFieldType.TEXT)
        out = await svc._build_single_user_value_map(run_ids=[run_id], reviewer_id=r, fields_by_id={field_id: f}, labels={})
        assert out[value_key(run_id, instance_id, field_id, r)].value_text == "e"
        assert value_key(run_id, instance_id, field_id) not in out

# tests/integration/test_extraction_export_value_resolution.py (rename the test at :64)
async def test_consensus_value_map_carries_machine_values(db_session: AsyncSession) -> None:
    ...  # seeding unchanged
    # Precondition: the primary version's snapshot is empty (conftest.py:410-417), so
    # entity_types_for_version falls back to live rows and serves the inserted field.
    assert select_field_id in {f.field_id for s in layout.sections for f in s.fields}
    number = layout.value_map[value_key(run_id, instance_id, number_field_id)]
    assert (number.status, number.value_num, number.unit) == ("answered", 5, "mg")
    other = layout.value_map[value_key(run_id, instance_id, select_field_id)]
    assert (other.status, other.value_text, other.other_text) == ("answered", None, expected_other_text)  # D9
```

  `_single_field_layout` gains `rater: UUID | None = None`, used as the key's fourth element.

- [ ] **Step 2: Run them.** Commands: `cd backend && uv run pytest tests/unit/test_extraction_export_descriptors.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_appraisal_model_resolution.py tests/unit/test_extraction_appraisal_summary_builder.py tests/unit/test_extraction_summary_builder.py tests/unit/test_extraction_export_service.py -q`, then `uv run pytest tests/integration/test_extraction_export_value_resolution.py -q` (needs the local DB). Expected FAIL: `ImportError: cannot import name 'value_key' from 'app.services.exports.descriptors'`.
- [ ] **Step 3: Implement** the edits listed under **Files**. Delete `value_envelope.py`, `test_value_envelope.py` and the mypy baseline line in the same commit. Then rewrite the listed test call sites.
- [ ] **Step 4: Run the suites.**
  - `cd backend && uv run pytest tests/unit -q`.
  - `uv run pytest tests/integration/test_extraction_export_value_resolution.py tests/integration/test_qa_rules_frozen.py tests/integration/test_extraction_export_appraisal_summary.py tests/integration/test_extraction_export_ai_outcome.py tests/integration/test_extraction_export_ai_outcome_ordering.py tests/integration/test_run_lifecycle_service.py -q`.

  Expected: PASS. Then:
  - `git grep -nwE "resolve_value|format_export_scalar|value_envelope" -- backend` must return only the Task 4 hits: `derived_judgment_service.py:67`, `test_derived_judgment_service.py:232` and `test_derived_judgment_no_information.py:91`.
  - `git grep -nE "value_map\.get\(\([^)]*\)\)|is_all_users=" -- backend/app` must return nothing (no tuple-literal keys, no per-mode key flag).
- [ ] **Step 5: Commit.** Message: `refactor(exports): carry ExportValue in value_map under one key and delete value_envelope.py`.

### Task 3: Scope marking stamps only empty cells, flags recorded answers, and classifies per slot

**Files:**
- Modify: `backend/app/services/exports/extraction_scope_marking.py:89-152`. For each article and each `rater` in `raters` (Task 2 passes `(primary_rater(mode, reviewer_id), *all_users reviewer ids)`):
  1. `classifier = scope_classifier_coordinate(rules)`; skip the article when it is `None`.
  2. `oos = out_of_scope_sections(rules, article_values_by_coord(..., rater=rater))`.
  3. For each section in `oos` other than `classifier[0]`, for each instance from `reader_instance_ids`, for each field: if `key = value_key(run, inst, fid, rater)` is absent, write `_STAMP`; otherwise write `replace(existing, out_of_scope=True)`.
- Modify the module docstring `:1-16` and the function docstring `:98-116`. The "overwrite" wording goes.
- Test: `backend/tests/unit/test_extraction_export_scope_marking.py`. Replace `test_overwrites_a_value_recorded_before_the_reclassification` (`:171`) and `test_all_users_marks_the_consensus_and_every_reviewer_sub_column` (`:185`).
- Test: `backend/tests/integration/test_extraction_export_appraisal_summary.py::test_qa_out_of_scope_domain_reads_not_applicable_end_to_end` (`:627`).
- Test: `backend/tests/integration/test_qa_rules_frozen.py` `_assert_scoped_by_old_rules` / `_assert_scoped_by_new_rules` (`:330-345`).

`reader_instance_ids` (`:76-86`) is untouched here; PR4 moves it onto `walk_sections` (R10).

**Interfaces:** Consumes `ExportValue`, `value_key`. Produces `mark_out_of_scope_values(*, rules_by_article, sections, articles, raters: Sequence[UUID | None], value_map: dict[ValueKey, ExportValue]) -> None`.

- [ ] **Step 1: Write the failing tests.**

```python
def _answered(code: str) -> ExportValue:
    return ExportValue(raw={"value": code}, status="answered", value_text=code)

def test_keeps_a_recorded_answer_and_stamps_only_the_empty_cell() -> None:
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    recorded = _answered("High")
    value_map = {value_key(run, scope_i, _STUDY_TYPE): _answered("development_only"),
                 value_key(run, eval_i, _EVAL_VERDICT): recorded}
    _mark(value_map, articles=(article,))
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT)] == replace(recorded, out_of_scope=True)
    stamp = value_map[value_key(run, eval_i, _EVAL_SIGNALLING)]
    assert (stamp.raw, stamp.status, stamp.absent_code, stamp.out_of_scope) == (None, "absent", "not_applicable", True)

def test_a_cleared_value_is_recorded_not_empty() -> None:                       # Review Focus 6
    run, scope_i, dev_i, eval_i = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    cleared = ExportValue(raw={"value": None}, status="cleared")
    value_map = {value_key(run, scope_i, _STUDY_TYPE): _answered("development_only"),
                 value_key(run, eval_i, _EVAL_VERDICT): cleared}
    _mark(value_map, articles=(article,))
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT)] == replace(cleared, out_of_scope=True)

def test_each_rater_slot_is_scoped_by_its_own_classifier_answer() -> None:
    run, scope_i, dev_i, eval_i, r1, r2 = (uuid4() for _ in range(6))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map = {value_key(run, scope_i, _STUDY_TYPE, r1): _answered("development_only"),
                 value_key(run, scope_i, _STUDY_TYPE, r2): _answered("evaluation_only")}
    _mark(value_map, articles=(article,), raters=(None, r1, r2))
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r1)].out_of_scope
    assert value_key(run, dev_i, _DEV_VERDICT, r1) not in value_map
    assert value_map[value_key(run, dev_i, _DEV_VERDICT, r2)].out_of_scope
    assert value_key(run, eval_i, _EVAL_VERDICT, r2) not in value_map
    assert not any(k[3] is None and k[1] in (dev_i, eval_i) for k in value_map)  # consensus unclassified

def test_single_user_slot_is_stamped_under_the_reviewer_key() -> None:          # R1
    run, scope_i, dev_i, eval_i, r = (uuid4() for _ in range(5))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    value_map = {value_key(run, scope_i, _STUDY_TYPE, r): _answered("development_only")}
    _mark(value_map, articles=(article,), raters=(r,))
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r)].out_of_scope
    assert not any(k[3] is None for k in value_map)

def test_a_reviewer_slot_never_marks_its_classifier_section() -> None:         # Review Focus 7
    run, scope_i, dev_i, eval_i, r1 = (uuid4() for _ in range(5))
    article = _article(run, scope_inst=scope_i, dev_inst=dev_i, eval_insts=(eval_i,))
    schema = {"scope_rules": {"classifier": {"section": "scope", "field": "study_type"},
                              "excludes": {"development_only": ["eval_d1", "scope"]}}}
    answer = _answered("development_only")
    value_map = {value_key(run, scope_i, _STUDY_TYPE, r1): answer}
    _mark(value_map, articles=(article,), raters=(None, r1), schema=schema)
    assert value_map[value_key(run, scope_i, _STUDY_TYPE, r1)] == answer   # out_of_scope stays False
    assert value_map[value_key(run, eval_i, _EVAL_VERDICT, r1)].out_of_scope

# integration, appended to test_qa_out_of_scope_domain_reads_not_applicable_end_to_end
article = layout.articles[0]
section = next(s for s in layout.sections if s.label == fx.domain2_label)
rob = next(f for f in section.fields if f.label == "Risk of bias")
kept = layout.value_map[value_key(article.run_id, root_instance(article, section.entity_type_id), rob.field_id)]
assert (kept.value_text, kept.out_of_scope) == ("High", True)

# test_qa_rules_frozen: _consensus_cell returns the ExportValue; the excluded section asserts
# cell.value_text == "High" and cell.out_of_scope is True (display stays NOT_APPLICABLE)
```

- [ ] **Step 2: Run them.** Command: `cd backend && uv run pytest tests/unit/test_extraction_export_scope_marking.py -q`. Expected FAIL:
  - the recorded `High` and the cleared value were replaced by the stamp (`raw=None`);
  - the `r1`/`r2`/`r` reviewer-slot keys are missing, because classification reads one slot only.
- [ ] **Step 3: Implement** the loop described under **Files** in `extraction_scope_marking.py:89-152`.
- [ ] **Step 4: Run the suites.** Commands: `cd backend && uv run pytest tests/unit/test_extraction_export_scope_marking.py tests/unit/test_appraisal_derived_overalls.py tests/unit/test_extraction_appraisal_model_resolution.py -q`, then `uv run pytest tests/integration/test_extraction_export_appraisal_summary.py tests/integration/test_qa_rules_frozen.py -q`. Expected: PASS. The Appraisal sheet still reads "Not applicable" for domain 2 and Overall "Low": `display_value` renders an out-of-scope verdict as the scope marker, which `_verdict_rank` excludes.
- [ ] **Step 5: Commit.** Message: `fix(exports): keep recorded answers when a scope rule takes their section out of play`.

### Task 4: Derived judgments read raw envelopes only; delete `_LABEL_TO_ABSENT_REASON`

**Files:**
- Modify: `backend/app/services/derived_judgment_service.py`:
  - delete `:64-73` (the comment and `_LABEL_TO_ABSENT_REASON`) and `_absent_reason` `:176-188`.
  - call sites `:209`, `:275`, `:292` and `:520` call `value_absent_reason(raw)`.
  - keep the `ABSENT_REASON_LABELS` import (still used at `:294`).
  - reword the comments that describe the export label path: `:97-105`, `:268-274`.
- Test: `backend/tests/unit/test_derived_judgment_no_information.py:89-101`. Delete `NI_RESOLVED` and `test_both_caller_shapes_agree`.
- Test: `backend/tests/unit/test_derived_judgment_service.py`:
  - drop the `("No information", "Unclear")` param at `:238` and reword its comment `:232`;
  - delete `test_signaling_accepts_both_caller_shapes` (`:245`), which the new test below replaces.
- Test: `backend/tests/unit/test_derived_overall_screen_workbook_parity.py`. Update the module docstring `:1-12`: both paths now feed raw envelopes.

**Interfaces:** `judgment_of`, `worst_domain`, `worst_of`, `out_of_scope_sections` and `compute_derived_judgments` keep their signatures. Their input contract narrows to raw stored values. Derived overalls stay code-based (D9).

- [ ] **Step 1: Write the failing test** in `test_derived_judgment_service.py`.

```python
def test_a_display_label_is_not_an_absent_marker() -> None:
    """Both callers pass raw envelopes; a resolved label is just an unknown answer."""
    assert judgment_of("No information", no_information_as_unclear=True) is None
    assert _sig_value({"q1": "No information"}) is None
    assert judgment_of({"value": None, "absent_reason": "no_information"}, no_information_as_unclear=True) == "Unclear"
```

- [ ] **Step 2: Run it.** Command: `cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -q -k display_label`. Expected FAIL: `AssertionError: assert 'Unclear' is None`.
- [ ] **Step 3: Implement** the deletions and call-site changes listed under **Files**.
- [ ] **Step 4: Run the suites.** Command: `cd backend && uv run pytest tests/unit/test_derived_judgment_service.py tests/unit/test_derived_judgment_no_information.py tests/unit/test_derived_overall_screen_workbook_parity.py tests/unit/test_appraisal_derived_overalls.py -q`. Expected: PASS. Then:
  - `git grep -n "_LABEL_TO_ABSENT_REASON\|_absent_reason(" -- backend/app` must return nothing;
  - `git grep -nwE "resolve_value|format_export_scalar|value_envelope" -- backend` must return nothing.
- [ ] **Step 5: Commit.** Message: `refactor(derived-judgments): read raw envelopes only and drop the label-to-marker map`.

### Task 5: Gates

- [ ] `make lint-backend`: ruff check, ruff format --check, and the mypy ratchet. If the ratchet reports fixed pairs, tighten it in this PR: `cd backend && { uv run mypy app --ignore-missing-imports > mypy.out || true; } && uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out --update`. Then delete `mypy.out`.
- [ ] Vulture: `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`. Expect no new finding. If it reports fixed entries: `... --exec --update`, committed with the baseline.
- [ ] File size: `python3 scripts/fitness/check_file_size.py`. `extraction_export_service.py` must be ≤ 2194 and `exports/values.py` ≤ 800. If the service shrank, run `python3 scripts/fitness/check_file_size.py --update-baseline backend/app/services/extraction_export_service.py`.
- [ ] Fitness suite (layered arch, retired symbols, scope guards): `bash scripts/fitness/run_all.sh`.
- [ ] Backend tests: `make test-backend`, the full suite against the local DB.
- [ ] Frontend: untouched. No public schema change, so `npm run generate:api-types`, `npm run test:run`, `npx knip` and `npx knip --production` are not affected. Run `npm run lint` only if the branch touched `frontend/`.
- [ ] If `graphify-out/graph.json` exists: `graphify update .`.
- [ ] Commit any baseline tightening. Message: `chore(exports): tighten mypy/file-size baselines after value_envelope removal`.

## Rulings applied

- **R1:** single_user keyed by `reviewer_id`; `primary_rater` in `exports/descriptors.py`; every PR3 single-slot reader (matrix axis, Summary, tidy, AI rows, scope marking, appraisal) calls it; `ExportLayout.reviewer_id: UUID | None = None` added in Task 2 Files and Interfaces so sheet builders, PR4 and PR5 can.
- **R2:** `display_value(v, field)` with no `target`; PR6 adds it.
- **Sub-builder contract (PR1):** appraisal test calls `build_appraisal_summary(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))`.
- **R3:** `AppraisalRow.domain_verdicts: tuple[ExportValue | None, ...]`; `AppraisalModel.domain_fields`; Appraisal sheet cells and the Overall go through `display_value` (Task 2).
- **R15:** `_untyped_field` and `test_ai_row_value_for_a_field_outside_the_active_version` are PR5's to delete.
- **R19:** value-map builders, AI rows and tidy tables get minimal transitional rewrites.
- **R20:** unit file is `tests/unit/test_export_values.py`.
- **D9:** single `other` → blank `value_text`, text in `other_text`; `unit` is the envelope unit; derived overalls stay code-based.
- **Contract deviations kept (ruff `ARG`):** `build_option_labels(active)` only (PR4 adds defaulted `pinned_latest_first`; no PR3 change needed); no `ExportLayout.option_labels` (no PR3 reader; PR4 adds it with the Options sheet). `ExportLayout.reviewer_id` is a contract addition required by R1.
