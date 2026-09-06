---
status: in_progress
last_reviewed: 2026-09-06
owner: '@raphaelfh'
---

# Trees B4 — tree-derived exports

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** the export descriptors describe a tree, not a model. One
`entries` map keyed by `(entity_type_id, parent_instance_id)` replaces
`model_instances` + `section_instances`; `SectionDescriptor.role` becomes
`repeats`; every builder resolves an instance by walking the ancestor
chain instead of indexing a flat list.

**Spec:** `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md` §10

**Architecture:** descriptor construction moves out of
`extraction_export_service.py` (at its 2356-line ceiling, zero headroom)
into `services/exports/extraction/descriptors.py`. The dataclasses stay
where they are — ~20 modules and ~25 test files import them from the
service — so this is a function move, not a type move.

## Global constraints

- `extraction_export_service.py` must NOT grow: baseline
  `scripts/fitness/check_file_size.baseline:4` pins it at 2356.
- English only; conventional commits.
- No `ExtractionEntityRole` anywhere under `app/services/exports/` when
  the slice ends (spec §13 B4 verify).
- `role` stays on the MODEL, the column and the snapshot until B5. B4
  removes it only from the export descriptors and their consumers.

## The defect this slice fixes

Characterized 2026-09-06, before any change. `_load_descriptors` appends
EVERY `MODEL_SECTION` instance to one flat `model_instances` tuple
(`extraction_export_service.py:977-980`), while
`hitl_session_service._backfill_child_singletons` guarantees one instance
per (parent entry, singleton child). Seeded CHARMS has six model
sections, so an article with M models produces a 6M-long tuple that
`matrix._article_fanout_count` reads as the column count and
`matrix._resolve_instance_id` indexes positionally.

Rendered, one model / two model sections:

```
Section              | Field          | Gaca, 2011 |
1. Model Development |                |            |
                     | 1.1 Dev field  | A-dev      |
2. Model Performance |                |            |
                     | 2.1 Perf field |            | A-perf
```

Two columns for one model, values on a diagonal. `summary._instance_for`
and `scope_marking.reader_instance_ids` index the same flat tuple.

**Consequence for the spec:** §10's "the golden CHARMS workbook must be
byte-identical" cannot be satisfied and should not be. The golden test
below asserts the CORRECT grouping and is expected to fail against
today's code; that failure is the characterization.

---

## What the adversarial panel changed

Recorded because the plan above was wrong in ways worth keeping visible.

1. **The nested repeating group is not a future shape.** Seeded CHARMS
   ships one: `final_predictors` (`backend/app/seed.py`) names
   `prediction_models` as its parent with `cardinality="many"`. Its
   MANY-ness is masked only because `matrix._resolve_instance_id` tested
   `role` before cardinality. So the tree resolution had to be general
   from the start, not deferred to B5.
2. **The module location closes an import cycle.**
   `exports/extraction/__init__` imports `workbook`, which imports the
   service, so a module-level import back from the service fails with
   `cannot import name 'AIProposalRow' from partially initialized
   module`. Reproduced, then `descriptors.py` moved up beside
   `extraction_scope_marking.py`.
3. **Four consumers the plan missed:** `_build_tidy_tables`,
   `_build_appraisal_model`, `article_values_by_coord` and
   `_load_ai_proposal_rows` — plus THREE byte-identical copies of the
   descriptor loop, not one.
4. **Column geometry is per-branch, not a single index.** Width is
   Σ over root entries of that entry's own largest nested count. An entry
   with three nested entries beside one with a single nested entry gives
   four columns — not `max(3,1)` and not `3 x 2`.
5. **`repeats` was not added.** §10 words it as a new field;
   `cardinality is MANY` already says it, and a second field derived from
   the first can disagree with it.

## Result

- Golden characterization passes: one entry is ONE sub-column with every
  section readable in it.
- `ExtractionEntityRole` at ZERO in the export package (§13 B4 verify).
- `extraction_export_service.py` 2356 -> 2274; ratchet tightened.
- 2803 unit tests; vulture 30<=30; mypy 73<=73; scope-guards 13, none new.

---

### Task 1: Golden workbook characterization (fails first)

**Files:**
- Test: `backend/tests/unit/test_extraction_export_golden_charms.py` (create)

Builds a CHARMS-shaped layout — one root group, six singleton child
sections, one and two entries — and asserts the geometry a reviewer
needs: one sub-column per entry, and every one of an entry's sections
readable in that entry's column.

- [ ] **Step 1: Write the failing test**

```python
def test_one_entry_yields_one_subcolumn_with_every_section_readable():
    layout = charms_layout(entries=1)
    ws = load_workbook(io.BytesIO(build_workbook(layout)))["CHARMS"]
    # One entry -> one value column after Section|Field.
    assert ws.max_column == 3
    col = [ws.cell(row=r, column=3).value for r in range(1, ws.max_row + 1)]
    assert [v for v in col if v] == ["Entry 1", "dev-1", "perf-1", ...]
```

- [ ] **Step 2: Run it — expect FAIL**

`cd backend && uv run pytest tests/unit/test_extraction_export_golden_charms.py -q`
Expected: `max_column == 8` (six sections + two label columns), values on
a diagonal.

- [ ] **Step 3: Commit the failing characterization** with `xfail(strict=True)`
so the suite stays green while the reason is recorded in the tree.

### Task 2: `entries` replaces the two instance maps

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (dataclasses only)
- Create: `backend/app/services/exports/extraction/descriptors.py`
- Test: `backend/tests/unit/test_extraction_export_descriptors.py`

**Interfaces produced:**

```python
EntryKey = tuple[UUID, UUID | None]   # (entity_type_id, parent_instance_id)

@dataclass(frozen=True)
class ArticleDescriptor:
    ...
    entries: dict[EntryKey, tuple[UUID, ...]]

@dataclass(frozen=True)
class SectionDescriptor:
    ...
    repeats: bool           # replaces `role`
    parent_entity_type_id: UUID | None   # already present
```

- [ ] **Step 1** Write `test_entries_key_every_instance_under_its_parent`:
  a container entry `m1` with two singleton children asserts
  `entries[(child_et, m1)] == (child_iid,)` and
  `entries[(container_et, None)] == (m1, m2)`.
- [ ] **Step 2** Run — FAIL (`ArticleDescriptor` has no `entries`).
- [ ] **Step 3** Add `entries`, build it in the moved
  `build_article_descriptors`, keep `model_instances`/`section_instances`
  populated so nothing breaks yet.
- [ ] **Step 4** Run — PASS. **Step 5** Commit.

### Task 3: ancestor-chain resolution in the matrix

**Files:**
- Modify: `backend/app/services/exports/extraction/matrix.py`
- Test: `backend/tests/unit/test_extraction_matrix_builder.py`

- [ ] **Step 1** Un-`xfail` Task 1's golden test.
- [ ] **Step 2** Run — FAIL (still diagonal).
- [ ] **Step 3** Replace `_resolve_instance_id`'s role branches with a
  walk: from the section, climb `parent_entity_type_id` to the root
  group, take that group's `i`-th entry, then descend
  `entries[(et, parent_iid)]` back down.
- [ ] **Step 4** Run golden + the existing 12 matrix specs — all PASS.
- [ ] **Step 5** Commit.

### Task 4: summary and scope-marking off the flat tuple

**Files:** `summary.py`, `extraction_scope_marking.py` + their tests.
Same failing-test-first cycle; `_instance_for` and `reader_instance_ids`
take the chain walk from Task 3 (one shared helper, not a third copy).

### Task 5: additional root groups get their own sheet

**Files:** `workbook.py`, `matrix.py`, `sheet_spec.py` + tests.
Test first: a two-root-group layout produces two sheets, the second
carrying only that group's entries, fields and descendants.

### Task 6: delete `role` from the export package

- [ ] `grep -rn ExtractionEntityRole backend/app/services/exports/ backend/app/schemas/extraction_export.py` → zero.
- [ ] Drop `model_instances` / `section_instances` from `ArticleDescriptor`
      and fix every test that constructs one.
- [ ] `make quality-scan`.
