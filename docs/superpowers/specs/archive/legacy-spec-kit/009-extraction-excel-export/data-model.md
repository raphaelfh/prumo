# Phase 1 — Data Model: Extraction Excel Export

**Feature**: 009-extraction-excel-export
**Date**: 2026-05-23

This feature does **not** introduce any new tables, columns, enums, or
indexes. It composes reads over the existing extraction-HITL schema.
This document captures the **read-side projection** the service
produces and the SQL access patterns it relies on, so reviewers can
sanity-check performance and correctness without re-reading
`docs/architecture/extraction-hitl-architecture.md`.

---

## 1. Tables touched (all read-only)

| Table | Read for | Index hit |
|---|---|---|
| `project_extraction_templates` | active template lookup | PK on `id` |
| `extraction_template_versions` | layout (entity_types + fields + roles, snapshot JSONB) | unique `(project_template_id, version)`; partial unique on `is_active` |
| `extraction_runs` | one per `(article, template, kind='extraction')` | unique `(article_id, project_template_id)` (for kind=extraction); index on `(project_id, template_id, stage)` for filter scans |
| `extraction_instances` | rows per `(run, entity_type)` — 1 for cardinality=one, N for many | index on `(run_id)` + `(article_id, template_id)` |
| `extraction_published_states` | Consensus mode cell values | unique `(run_id, instance_id, field_id)` |
| `extraction_reviewer_states` | Single user / All users latest decision per reviewer | unique `(run_id, reviewer_id, instance_id, field_id)` |
| `extraction_reviewer_decisions` | resolved value when state.current_decision_id is `accept_proposal` or `edit` | PK; FK from reviewer_states |
| `extraction_proposal_records` | AI metadata sheet rows | index on `(run_id, instance_id, field_id)`; filter on `source='ai'` |
| `extraction_evidence` | AI metadata sheet's evidence columns | FK on `proposal_record_id` |
| `project_members` | auth — `is_member` / `has_role` checks | unique `(project_id, user_id)` |
| `articles` | article metadata (title, id) for column headers | PK on `id` |

No writes occur during an export — the operation is fully read-only.

---

## 2. Internal layout descriptor (in-memory projection)

The orchestrator service builds an in-memory **ExportLayout** object
once per request, then hands it to the XLSX builder. This is not a
DB shape — it is a serialisable Python dataclass tree that the builder
consumes deterministically.

```python
@dataclass(frozen=True)
class FieldDescriptor:
    field_id: UUID
    label: str                    # e.g. "1.1 Source of data"
    type: ExtractionFieldType     # text/number/date/select/multiselect/boolean
    allowed_values: list[str]     # for select/multiselect; [] otherwise
    parent_section_id: UUID       # entity_type id

@dataclass(frozen=True)
class SectionDescriptor:
    entity_type_id: UUID
    label: str                    # e.g. "1. Source of data"
    role: ExtractionEntityRole    # study_section | model_container | model_section
    parent_entity_type_id: UUID | None
    fields: list[FieldDescriptor]

@dataclass(frozen=True)
class ArticleDescriptor:
    article_id: UUID
    header_label: str             # "Gaca, 2011" or fallback title/id
    run_id: UUID | None           # None when no Run yet (Consensus mode skips these per FR-013)
    run_stage: ExtractionRunStage | None
    model_instances: list[UUID]   # zero-or-more model_section instance ids (in display order)
    study_instances: dict[UUID, UUID]  # entity_type_id (study_section) → instance_id

@dataclass(frozen=True)
class ReviewerDescriptor:
    reviewer_id: UUID
    display_label: str            # real name OR "Reviewer A/B/…" based on anonymize toggle

@dataclass(frozen=True)
class ExportLayout:
    template_name: str
    template_version: int
    sections: list[SectionDescriptor]      # in display order; section.role drives column fan-out
    articles: list[ArticleDescriptor]      # filtered by mode-eligibility (FR-018)
    reviewers: list[ReviewerDescriptor]    # populated only for All-users; empty otherwise
    mode: ExportMode                       # consensus | single_user | all_users
    include_ai_metadata: bool
    anonymize_reviewer_names: bool
    notes: ExportNotes                     # see §4
```

Where:

```python
class ExportMode(StrEnum):
    CONSENSUS = "consensus"
    SINGLE_USER = "single_user"
    ALL_USERS = "all_users"

@dataclass(frozen=True)
class ExportNotes:
    omitted_articles_by_stage: dict[str, int]  # e.g. {"review": 4, "cancelled": 1}
    obsolete_fields_per_article: dict[UUID, list[str]]  # article_id → field labels skipped
    template_version_label: str
    export_mode_label: str
    anonymize_reviewer_names: bool
    include_ai_metadata: bool
    generated_at: datetime
```

---

## 3. Value resolution by mode

Cell value for `(article, instance, field)` is computed as follows. All
three branches return either a typed Python value or `None` (which the
builder writes as an empty cell):

### Consensus mode

```sql
SELECT value
FROM extraction_published_states
WHERE run_id = :run_id
  AND instance_id = :instance_id
  AND field_id = :field_id;
```

If no row → empty cell. By construction this only runs for
`run.stage = 'finalized'` (FR-013).

### Single-user mode

```sql
SELECT
    rd.decision,
    rd.value,
    pr.proposed_value
FROM extraction_reviewer_states rs
JOIN extraction_reviewer_decisions rd ON rs.current_decision_id = rd.id
LEFT JOIN extraction_proposal_records pr ON rd.proposal_record_id = pr.id
WHERE rs.run_id = :run_id
  AND rs.reviewer_id = :reviewer_id
  AND rs.instance_id = :instance_id
  AND rs.field_id = :field_id;
```

Then in Python:

- `decision == 'accept_proposal'` → `proposed_value`
- `decision == 'edit'` → `rd.value`
- `decision == 'reject'` → `None` (blank cell per FR-014)
- No row → `None`

### All-users mode

Runs Single-user resolution N times (once per reviewer) plus a
Consensus resolution for the leftmost sub-column per
`(article, model_instance)`. Reviewer list comes from a
preliminary query:

```sql
SELECT DISTINCT rs.reviewer_id, p.full_name
FROM extraction_reviewer_states rs
JOIN extraction_reviewer_decisions rd ON rs.current_decision_id = rd.id
JOIN profiles p ON p.id = rs.reviewer_id
WHERE rs.run_id IN :run_ids
  AND rd.decision != 'reject';
```

ordered by `full_name` (or `reviewer_id` when anonymized).

---

## 4. Bulk-fetch pattern (avoid N+1)

The orchestrator MUST fetch all values for the export in **bounded
queries**, never per-cell. Concretely, for an export of `A` articles:

| Mode | Query plan |
|---|---|
| Consensus | 1 query: `SELECT … FROM extraction_published_states WHERE run_id IN (…)` (A run ids) |
| Single user | 1 query: `SELECT … FROM extraction_reviewer_states JOIN extraction_reviewer_decisions … WHERE run_id IN (…) AND reviewer_id = :r` |
| All users | 1 query for reviewers list (above) + 1 query per reviewer N (typically N=2–3) + 1 consensus query — total ≤ 5 queries regardless of article count |
| AI metadata sheet (when toggled) | 1 query joining `extraction_proposal_records` + `extraction_evidence` filtered to `source='ai'` and `run_id IN (…)` |

The result sets are dict-keyed by `(run_id, instance_id, field_id)`
in memory, then the builder iterates the layout deterministically.
This caps the round-trip cost at O(1) regardless of cell count, in
keeping with SC-002.

---

## 5. AI metadata sheet — row shape

One row per `extraction_proposal_records` row with `source='ai'`
whose `run_id` is in the export's article scope. Columns are exactly
those listed in spec FR-037. The `Reviewer outcome` column is computed
via this decision table (FR-040 caveat applies for the edit case):

```text
For proposal P at (run, instance, field):
  let latest_proposal_for_key = MAX(created_at) over all source='ai'
                                proposals with same (run, instance, field)
  let reviewer_state = SELECT … FROM extraction_reviewer_states
                       WHERE (run, instance, field) matches
                       (any reviewer — pick the one whose decision
                       references this proposal id when possible,
                       else the most recent state row)
  let decision = JOIN to reviewer_decisions

  if P.created_at < latest_proposal_for_key:
      outcome = "superseded"
  elif reviewer_state IS NULL:
      outcome = "pending"
  elif decision.decision == 'accept_proposal' AND decision.proposal_record_id == P.id:
      outcome = "accepted"
  elif decision.decision == 'reject':
      outcome = "rejected"
  elif decision.decision == 'edit':
      outcome = "edited (best-effort)"
  else:
      outcome = "pending"
```

The `Final value used` column is read from
`extraction_published_states` for the same `(run, instance, field)`;
blank when the Run is not finalized.

---

## 6. Validation rules from the spec

| Rule | Source FR | Enforced where |
|---|---|---|
| Project membership required | constitution §IV | endpoint (first check before any service call) |
| Manager-only for cross-reviewer modes | FR-004 | endpoint (after membership; before service call) |
| Mode must be `consensus`/`single_user`/`all_users` | FR-002 | Pydantic enum on request schema |
| Article scope must be `current_list` or `selected_only` | FR-018 | Pydantic enum on request schema |
| `selected_only` requires non-empty `article_ids` list | FR-005 | endpoint validation (after Pydantic) |
| All article_ids belong to the project | FR-016 | service (`is_article_in_project`-style guard) |
| All article_ids belong to a Run on the active template | FR-016 | service (`run_ids_for_articles` filter) |
| Eligibility intersection emptiness → 422 | FR-005 / FR-018 | endpoint after layout resolution |

---

## 7. State transitions

None. The export is read-only and does not mutate any extraction or
HITL row. The only side effect is a write to Supabase Storage (async
path) and a structlog audit entry on the export action (FR-025).
