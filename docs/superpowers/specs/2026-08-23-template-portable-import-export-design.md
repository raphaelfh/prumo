---
status: approved
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# Portable template import/export (`prumo-template@1`) — design

> **Status:** Approved · Date: 2026-08-23 · Deciders: @raphaelfh
> **Scope:** export an extraction template's live structure as a portable,
> UUID-free JSON document, and import such a document as a **new** project
> template. Two endpoints, one format module, no changes to the
> draft/publish/version machinery.

## 1. Problem

Authoring an extraction template today has exactly two paths, and both are
bad:

1. **Write Python seed code.** `backend/app/seed.py` is 3235 lines of
   hand-written template definitions (~1400 lines for CHARMS alone), plus
   `backend/app/seed_probast_ai.py`. Every new framework means a new seed
   function, a migration-adjacent deploy step, and a manual
   `python -m app.seed` in production.
2. **Click the config grid.** Hundreds of rows, one at a time, with no way
   to review the result as a diffable artifact, hand it to a collaborator,
   or move it between projects.

There is no way to take a template out of prumo, and no way to bring one in
that did not originate in the global catalogue. A researcher who has built a
good template in project A cannot reuse it in project B; a methodologist who
wants to contribute a template cannot express it in anything but Python.

## 2. What already exists (and is deliberately reused)

| Asset | Where | How this design uses it |
| --- | --- | --- |
| The template tree | `project_extraction_templates` → `extraction_entity_types` → `extraction_fields` | The thing being serialized. |
| A JSON serialization of that tree | `extraction_template_versions.schema_`, built by `SNAPSHOT_SQL` in `app/services/extraction_snapshot.py` | Prior art for the shape; **not** the wire format (see §3.1). |
| Server-authoritative template creation | `POST /projects/{id}/templates/clone` → `TemplateCloneService` | Same lifecycle semantics; the import reuses its *tail*, not its insert loop (§5.2). |
| Publish path | `TemplateVersionService.republish` | Publishes the imported template's v1. |
| Validation rules | `FieldName`, `FieldType`, `AllowedValues`, `AllowedUnits`, `SectionName`, `SectionLabel`, `SectionEntryLabel` in `app/schemas/template_structure.py` | Reused verbatim — **the import introduces zero new validation rules**. |
| Manager authorization | `require_project_manager` | Guards both new endpoints. |
| Draft state | `project_extraction_templates.config_draft_since`, surfaced by `GET .../config-status` | Drives the export confirmation (§4.1). |

## 3. Decisions

### 3.1 Import always creates a NEW template

An import never touches an existing template's live rows, draft marker,
version history, or run pins. It creates a new `project_extraction_template`
with `global_template_id = NULL`, deactivates the active extraction sibling
(the `uq_one_active_extraction_template_per_project` invariant), and
publishes v1.

**Rejected:** replacing the structure of the currently open template as a
draft. It collides with the draft/lock/diff contract, forces a decision about
removed fields that already carry extracted values, and re-pins editable-stage
runs on publish. "Import a new one and switch" composes out of machinery that
already exists.

### 3.2 A portable format, not the version snapshot

**Rejected:** returning `extraction_template_versions.schema_` verbatim. It is
flat (hierarchy by `parent_entity_type_id`), carries UUIDs from another
database that an importer would have to remap, and spells out every default —
which makes it unusable for the actual use case (a human or an LLM authoring a
template outside the app).

### 3.3 Export reads the live structure, and warns on a pending draft

Export serializes what the grid is showing, so the serializer is the exact
inverse of the importer — one module, two directions, one round-trip test that
proves both. When `config_draft_since` is set, the UI confirms before
downloading (§4.1), so unpublished work is never handed to a colleague
silently.

**Rejected:** exporting the active published version. Export and import would
then touch different shapes and could drift, and exporting right after an edit
would silently hand over the previous structure.

### 3.4 v1 scope: extraction only, project scope only

A file whose `kind` is not `extraction` is rejected with a typed error. QA
import/export and a global-catalogue path (the thing that would eventually
retire the seed-in-Python pattern) are follow-ups; this design's format is
what enables them.

## 4. The format — `prumo-template@1`

One JSON object. No UUIDs anywhere. Nesting carries the hierarchy, array order
carries `sort_order`, and defaults are omitted on export.

```json
{
  "prumo_template": 1,
  "kind": "extraction",
  "name": "CHARMS (custom)",
  "description": "CHARMS checklist, adapted for our review.",
  "framework": "CHARMS",
  "version": "1.1.0",
  "llm_template_instruction": "Extract only what the article states...",
  "sections": [
    {
      "name": "source_of_data",
      "label": "Source of Data",
      "description": "Data source used in the study (CHARMS 1.1)",
      "fields": [
        {
          "name": "data_source",
          "label": "Data source",
          "type": "select",
          "required": true,
          "allowed_values": ["cohort", "rct", "registry"],
          "allow_other": true,
          "other_label": "Other source",
          "llm_description": "The study design the data came from."
        }
      ]
    },
    {
      "name": "prediction_models",
      "label": "Prediction Models",
      "group": true,
      "entry_label": "model",
      "fields": [
        {"name": "model_name", "label": "Model name", "type": "text"}
      ],
      "sections": [
        {
          "name": "model_development",
          "label": "Model Development",
          "fields": [
            {"name": "modelling_method", "label": "Modelling method", "type": "text"}
          ]
        }
      ]
    }
  ]
}
```

### 4.1 Document keys

| Key | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `prumo_template` | yes | — | Format version. Must equal `1`. Makes a future v2 detectable; no migration machinery ships. |
| `kind` | yes | `kind` | Must be `"extraction"` in v1. |
| `name` | yes | `name` | 1–200 chars. |
| `description` | no | `description` | |
| `framework` | no | `framework` | `CHARMS` / `PICOS` / `CUSTOM`; defaults to `CUSTOM` (the column is NOT NULL). |
| `version` | no | `version` | Free-text label, defaults `"1.0.0"`. **Not** the `extraction_template_versions.version` counter. |
| `llm_template_instruction` | no | `llm_template_instruction` | ≤ 4000 chars (mirrors the `llm_instruction_len` CHECK). |
| `sections` | yes | — | 1–100 entries. |

### 4.2 Section keys

| Key | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `name` | yes | `name` | `SectionName` (`^[a-zA-Z_][a-zA-Z0-9_]*$`, 2–50). **Not** required to be unique — see below. |
| `label` | yes | `label` | `SectionLabel` (trimmed, 1–100). |
| `description` | no | `description` | |
| `required` | no | `is_required` | Default `false`. |
| `repeats` | no | `cardinality` | `true` → `many`, `false`/absent → `one`. Forced `many` when `group` is true. |
| `group` | no | `role` | Root-only. `true` → `model_container`. Default `false`. |
| `entry_label` | no | `entry_label` | `SectionEntryLabel`. Only meaningful when `group` is true; defaults to `"model"` there, `null` otherwise. |
| `fields` | no | — | 0–200 entries. |
| `sections` | no | — | Children. Only legal inside a `group`; 0–100 entries. |

**`role` is derived, never written.** This is the design's main safety
property — the file cannot express a role/parent combination the database
would reject:

| In the file | Becomes |
| --- | --- |
| root section, no `group` | `role = study_section`, `parent = NULL` |
| root section, `"group": true` | `role = model_container`, `cardinality = many`, `parent = NULL` |
| nested section | `role = model_section`, `parent` = the enclosing group |
| `sections` on a non-group section | validation error |
| two sections with `"group": true` | validation error (mirrors `uq_extraction_entity_types_one_container_per_project`) |
| `sections` nested more than one level | validation error |

**Section names are not required to be unique.** There is no unique index on
`extraction_entity_types.name`, and `template_section_service.py` performs no
name-taken check (unlike `template_field_service.py`, which does). Enforcing
uniqueness here would make the import stricter than the editor, so a template
containing two same-named sections would export but fail to re-import —
breaking the round-trip contract. The format never references a section by
name (parent comes from nesting), so duplicates are harmless.

### 4.3 Field keys

| Key | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `name` | yes | `name` | `FieldName` (`^[a-z][a-z0-9_]*$`, 2–50). Unique within its section (mirrors `uq_extraction_fields_entity_type_name`). |
| `label` | yes | `label` | 1–100. |
| `type` | yes | `field_type` | `FieldType`: `text` / `number` / `date` / `select` / `multiselect` / `boolean`. |
| `description` | no | `description` | ≤ 500. |
| `required` | no | `is_required` | Default `false`. |
| `llm_description` | no | `llm_description` | ≤ 1000. |
| `allowed_values` | no | `allowed_values` | `AllowedValues`: 1–100 unique strings. |
| `unit` | no | `unit` | ≤ 50. |
| `allowed_units` | no | `allowed_units` | `AllowedUnits`: 1–20 unique strings, each ≤ 50. |
| `allow_other` | no | `allow_other` | Default `false`. |
| `other_label` | no | `other_label` | ≤ 100. |
| `other_placeholder` | no | `other_placeholder` | ≤ 200. |
| `allows_not_applicable` | no | `allows_not_applicable` | Default `false`. |
| `allows_not_evaluated` | no | `allows_not_evaluated` | Default `false`. |
| `validation_schema` | no | `validation_schema` | Opaque object, passed through unread. |

**Every data column of `extraction_fields` and `extraction_entity_types` is
represented.** A lossy export is a bug, not a simplification.
`validation_schema` is included even though it has no functional reader in the
product today (see the note at `frontend/lib/copy/templateConfig.ts`), because
the editor threads the column and round-trip fidelity is the contract.

Four keys are renamed relative to their columns so the file is writable by
hand: `field_type` → `type`, `is_required` → `required`, `cardinality` →
`repeats` (boolean), `role` → `group` (boolean, root-only). Every other key
uses its column name.

Columns deliberately **absent** from the format: `id`, `template_id`,
`project_template_id`, `entity_type_id`, `parent_entity_type_id` (structural,
re-derived), `sort_order` (array order), `created_at` / `updated_at` /
`created_by` (audit), `is_active`, `global_template_id`,
`config_draft_since` / `config_draft_by`, `schema_` (vestigial JSONB on the
template row — the import writes `{}`).

## 5. Backend

### 5.1 Endpoints

```text
GET  /api/v1/projects/{project_id}/templates/{template_id}/export
POST /api/v1/projects/{project_id}/templates/import
```

Both guarded by `require_project_manager`, both returning the standard
`ApiResponse` envelope.

- **Export** reads the live rows for the path template (BOLA chain: template →
  project) and returns the portable document as the response payload. It reads
  no draft state and takes no locks — the draft confirmation is a frontend
  concern (§6.1) built on the existing `config-status` read.

  **The downloaded file is the unwrapped `data`, not the envelope.** The
  response is an `ApiResponse[PortableTemplate]` like every other endpoint, so
  the frontend must serialize `response.data` into the blob. Writing the
  envelope to disk would produce a file the importer rejects (the format model
  is `extra="forbid"`). The backend round-trip test never sees the envelope, so
  this is covered by a frontend assertion on the blob contents instead (§9).
- **Import** takes the parsed document as its body and returns the same
  envelope shape the clone endpoint already returns —
  `{project_template_id, version_id, entity_type_count, field_count, created}` —
  so the import dialog's success path is unchanged.

### 5.2 Modules

- `app/schemas/template_portable.py` — the Pydantic v2 model of the format.
  Imports the shared aliases from `app/schemas/template_structure.py` and adds
  the structural validators from §4.2 (`group` root-only, at most one group,
  `sections` only inside a group, one nesting level, field-name uniqueness per
  section). Imports nothing from `app.models`
  (`scripts/fitness/check_layered_arch.py`).
- `app/services/template_portable_service.py` — the two directions side by
  side: `to_portable(db, template_id) -> PortableTemplate` and
  `import_portable(db, project_id, doc, user_id) -> TemplateClone`.

### 5.3 Import algorithm

One transaction:

1. Validate the document (Pydantic). Reject `kind != "extraction"` with a
   typed error.
2. Deactivate the project's active extraction templates
   (the sibling-deactivation step the clone service already performs; promoted
   from a private method to a module-level helper so both callers share it).
3. Insert the `ProjectExtractionTemplate` row with `global_template_id = NULL`.
4. Walk `sections` parent-first, in array order: insert each entity type with
   `sort_order = index` and the derived `role`/`parent`, then its fields with
   `sort_order = index`.
5. Publish v1 through `TemplateVersionService.republish`, which snapshots the
   structure and clears the draft marker the inserts just stamped.

**No topological sort.** The clone service needs one because it reads a flat
list of global entity types; a nested document is already parent-first by
construction. This is why the import does **not** reuse
`TemplateCloneService._insert_project_structure_from_global` — sharing would
drag machinery the file path does not need. Only the tail (deactivate siblings,
republish) is shared.

Any `IntegrityError` rolls the transaction back and surfaces as a typed 422 —
a partially-imported template is never representable.

### 5.4 Errors

| Condition | HTTP | Code |
| --- | --- | --- |
| Schema/structural validation failure | 422 | `TEMPLATE_IMPORT_INVALID` |
| `kind` is not `extraction` | 422 | `TEMPLATE_IMPORT_WRONG_KIND` |
| `prumo_template` is not `1` | 422 | `TEMPLATE_IMPORT_UNSUPPORTED_VERSION` |
| Template not in the path project | 404 | existing not-found handling |

Validation failures carry a human-readable list built from Pydantic's `loc`
paths — `sections[2].fields[5].name: must match ^[a-z][a-z0-9_]*$` — capped at
the first 20 entries, delivered in the standard envelope's `error.message`.

### 5.5 Size caps

`sections` ≤ 100 per level, `fields` ≤ 200 per section, enforced by Pydantic.
A pathological file becomes a fast 422 instead of a long transaction.

## 6. Frontend

### 6.1 Command bar

The Configuration command bar in
`frontend/components/extraction/TemplateConfigEditor.tsx` gains one visible
control:

- **`Export`** — ghost button. Downloads `<slug>.prumo-template.json`, where
  `<slug>` is the template name slugified. When the template's config status
  reports a pending draft, an `AlertDialog` confirms first: *"This file
  includes unpublished changes."*
- The existing **`Import template`** button keeps its position and opens the
  same dialog; its icon changes from `Download` to `Upload` (it competed with
  the new Export affordance — a one-line fix in code this change already
  touches).

### 6.2 Import dialog

The existing catalogue dialog gains a source selector: **From catalogue** |
**From a file**. The file pane is a file input plus an Import button, and a
one-line trust notice (§8).

**The browser does not parse the JSON.** The file is posted as-is and the
server validates it; errors render as the returned list. Re-implementing the
schema in TypeScript would duplicate exactly the knowledge this design
consolidates in one Pydantic model.

### 6.3 Services and copy

- `frontend/services/templateImportService.ts` gains
  `importTemplateFromFile(projectId, file)`.
- A new `exportTemplate(projectId, templateId)` alongside it.
- New copy keys in `frontend/lib/copy/extraction.ts`, English only, avoiding
  the banned user-facing noun "Run".

## 7. Accepted costs

**No duplicate-name guard.** Importing the same file twice creates two
templates; only one is active, and no extraction surface lists inactive ones
(`fetchProjectTemplates` filters `is_active=true` unless `includeInactive` is
passed, which only the QA Configuration tab does). Blocking on a name
collision would dead-end the legitimate "import my revised CHARMS" flow;
warning would cost a pre-flight round trip. Neither earns its keep.

**There is no delete-project-template endpoint.** `template_structure.py`
deletes sections and fields only. Inactive imports therefore accumulate as
invisible rows. This is a pre-existing gap, not one this design introduces; it
deserves its own issue.

## 8. Security note

An imported document carries `llm_description` (per field) and
`llm_template_instruction` (per template), both of which are interpolated into
extraction prompts. Importing a third-party template is therefore a
prompt-injection vector into that project's runs.

What already mitigates it: the endpoint is manager-only, the length caps are
enforced (1000 / 4000), and the document is inert data — nothing in it is
executed or fetched. The import pane carries one line of copy: *"Only import
templates you trust."* A content scanner is not justified at this scope.

## 9. Verification

The first test written, and written failing:

**Round-trip.** Seed CHARMS → clone into project A → export → import into
project B → export again → assert the two documents are equal. This exercises
both directions and every column at once, and fails loudly if either side
drops a key.

Then:

- Each rejection case in §5.4 returns a typed 422 **and writes nothing**
  (assert the rollback: no new `project_extraction_templates` row).
- Structural rejections: `sections` under a non-group, two groups, nesting
  deeper than one level, duplicate field name within a section, bad `name`
  patterns, unknown `type`.
- Two sections sharing a `name` import successfully (the import must not be
  stricter than the editor — §4.2).
- Import activates the new template and deactivates the previously active one.
- Import leaves exactly one active `extraction_template_versions` row whose
  `schema_` matches the imported structure.
- Frontend (vitest): the export button downloads with the expected filename
  **and a blob whose parsed contents are the unwrapped document** (top-level
  `prumo_template`, no `data`/`error` envelope keys — §5.1); a pending draft
  raises the confirmation; a server validation error renders in the dialog.
- E2E (Playwright): export from a project, re-import into the same project,
  and assert the grid renders the same sections and fields.

## 10. Out of scope

- Importing into an existing template; merging; diffing a file against a
  template.
- Global-catalogue import and retiring the Python seed pattern — the natural
  follow-up, and the reason the format is worth getting right now.
- `kind: quality_assessment`.
- Multi-template bundles, YAML, CSV.
- Deleting or archiving a project template (§7).
- Format migration. `prumo_template: 1` only makes a future v2 detectable.
