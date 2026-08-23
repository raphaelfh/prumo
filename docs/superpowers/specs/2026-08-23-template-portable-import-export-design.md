---
status: shipped
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# Portable template import/export (`prumo-template@1`) — design

> **Status:** Approved · Date: 2026-08-23 · Deciders: @raphaelfh
> **Scope:** export an extraction template's live structure as a portable,
> UUID-free JSON document; import such a document as a **new** project
> template; make every project template reachable (switch) and removable
> (delete) from the template dialog. Three new endpoints, one fixed
> endpoint, one format module, no changes to the draft/publish/version
> machinery.

## 1. Problem

Authoring an extraction template today has two working paths, and both are
bad:

1. **Write Python seed code.** `backend/app/seed.py` is 3235 lines of
   hand-written template definitions (~1400 lines for CHARMS alone), plus
   `backend/app/seed_probast_ai.py`. Every new framework means a new seed
   function, a migration-adjacent deploy step, and a manual
   `python -m app.seed` in production.
2. **Click the config grid.** Hundreds of rows, one at a time, with no way
   to review the result as a diffable artifact, hand it to a collaborator,
   or move it between projects.

(A third path, the "Create custom template" dialog, is broken — see §7.)

There is no way to take a template out of prumo, and no way to bring one in
that did not originate in the global catalogue. A researcher who has built a
good template in project A cannot reuse it in project B; a methodologist who
wants to contribute a template cannot express it in anything but Python.

## 2. What already exists (and is deliberately reused)

| Asset | Where | How this design uses it |
| --- | --- | --- |
| The template tree | `project_extraction_templates` → `extraction_entity_types` → `extraction_fields` | The thing being serialized. |
| A JSON serialization of that tree | `extraction_template_versions.schema_`, built by `SNAPSHOT_SQL` in `app/services/extraction_snapshot.py` | Prior art for the shape; **not** the wire format (§3.2). |
| Server-authoritative template creation | `POST /projects/{id}/templates/clone` → `TemplateCloneService` | Same lifecycle semantics; the import reuses its *tail*, not its insert loop (§5.3). |
| Publish path | `TemplateVersionService.republish` | Publishes the imported template's v1. |
| Validation rules | `FieldName`, `FieldType`, `AllowedValues`, `AllowedUnits`, `SectionName`, `SectionLabel`, `SectionEntryLabel` in `app/schemas/template_structure.py` | Reused verbatim — **the import introduces zero new validation rules**. |
| Activate/deactivate | `PATCH /projects/{id}/templates/{tid}` → `project_template_active_service.set_template_active` | The "Switch to" action (§5.6); gains sibling deactivation. |
| Project template listing | `fetchProjectTemplates(projectId, kind, includeInactive)` in `frontend/services/qaTemplateService.ts` | Lists the project's templates in the dialog (§6.2). |
| The template dialog | `frontend/components/extraction/dialogs/ImportTemplateDialog.tsx`, hosted by `TemplateConfigEditor` and `ExtractionInterface` | Grows into the "Switch template" dialog the 2026-08-05 spec named (§6.2). |
| Manager authorization | `require_project_manager` | Guards every new and changed endpoint. |
| Draft state | `project_extraction_templates.config_draft_since`, surfaced by `GET .../config-status` | Drives the export confirmation (§6.1). |

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
downloading (§6.1), so unpublished work is never handed to a colleague
silently.

**Rejected:** exporting the active published version. Export and import would
then touch different shapes and could drift, and exporting right after an edit
would silently hand over the previous structure.

### 3.4 v1 scope: extraction only, project scope only

A file whose `kind` is not `extraction` is rejected with a typed error. QA
import/export and a global-catalogue path (the thing that would eventually
retire the seed-in-Python pattern) are follow-ups; this design's format is
what enables them.

### 3.5 Imported templates must stay reachable

Today the template dialog lists **only the global catalogue**
(`useGlobalTemplates`), and nothing else in the product lists a project's
inactive extraction templates. A file-imported template has
`global_template_id = NULL`, so the moment a later catalogue import deactivates
it, it disappears from every screen — and any edits made in the grid after the
import are stranded (intact in the database, unreachable in the UI).

No working path produces such rows today, so this trap would be **introduced**
by this feature, not inherited. The dialog therefore gains a list of the
project's own extraction templates — active and inactive — with a "Switch to"
action (§6.2, §5.6).

**Rejected:** documenting "re-import the file". The file does not contain the
post-import edits.

### 3.6 Delete ships in this slice

The import is the feature that makes templates accumulate, and there is no
delete endpoint (`template_structure.py` deletes sections and fields only), so
cleanup would mean SQL. A guarded `DELETE` (§5.7) lands here, surfaced from the
same list (§6.2). Guards keep it boring: only inactive templates, only
templates no run or instance references.

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
| `description` | no | `description` | ≤ 2000 chars. |
| `framework` | no | `framework` | `CHARMS` / `PICOS` / `CUSTOM`; defaults to `CUSTOM` (the column is NOT NULL). Display-only in the product — nothing branches on it. |
| `version` | no | `version` | Free-text label, defaults `"1.0.0"`. **Not** the `extraction_template_versions.version` counter. |
| `llm_template_instruction` | no | `llm_template_instruction` | ≤ 4000 chars (mirrors the `llm_instruction_len` CHECK). |
| `sections` | yes | — | 1–100 entries. At most 2000 fields in the whole document (the per-level caps multiply). |

### 4.2 Section keys

| Key | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `name` | yes | `name` | `SectionName` (`^[a-zA-Z_][a-zA-Z0-9_]*$`, 2–50). **Not** required to be unique — see below. |
| `label` | yes | `label` | `SectionLabel` (trimmed, 1–100). |
| `description` | no | `description` | ≤ 500 chars (it is prompt text — mirrors `SectionCreateRequest`). |
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
| `llm_description` | no | `llm_description` | ≤ **4000** — deliberately looser than the editor's 1000: the seeded CHARMS+Multimodal ships ~1.4k-char descriptions, the DB has no CHECK, and a 1000 cap would make the official template un-exportable (FastAPI re-validates the response) and un-importable. |
| `allowed_values` | no | `allowed_values` | `AllowedValues`: 1–100 unique strings. |
| `unit` | no | `unit` | ≤ 50. |
| `allowed_units` | no | `allowed_units` | `AllowedUnits`: 1–20 unique strings, each ≤ 50. |
| `allow_other` | no | `allow_other` | Default `false`. |
| `other_label` | no | `other_label` | ≤ 100. |
| `other_placeholder` | no | `other_placeholder` | ≤ 200. |
| `allows_not_applicable` | no | `allows_not_applicable` | Default `false`. |
| `allows_not_evaluated` | no | `allows_not_evaluated` | Default `false`. |

Three keys are renamed relative to their columns so the file is writable by
hand and guessable by an LLM — `type` and `required` appear on every field,
and they are the JSON Schema convention: `field_type` → `type`,
`is_required` → `required`, `cardinality` → `repeats` (boolean). `group` is
not a rename but a derivation (§4.2). Every other key uses its column name.
The cost is two `serialization_alias` declarations in the Pydantic model.

### 4.4 What the format carries, and what it deliberately does not

**Every column the product reads or writes is represented.** A lossy export
of a live column is a bug, not a simplification.

Two columns are **vestigial** and deliberately excluded:
`project_extraction_templates.schema_` and `extraction_fields.validation_schema`.
No UI writes either (the field inspector has no control for
`validation_schema`; the create path sends `{}`), no code reads either (see
the note at `frontend/lib/copy/templateConfig.ts`: "no functional reader
anywhere in the product"), and every seeded or editor-created row holds `{}`
or `null`. Carrying them would let a file promise behavior the product does
not have — a hand-written `"validation_schema": {"maximum": 120}` that nothing
enforces. Because the format model is `extra="forbid"`, a file that includes
either key is rejected with the key named, which tells the author plainly that
per-field validation rules are not a feature. Should either column gain
semantics, adding an optional key is additive within v1 — old files stay
valid. The import writes `{}` to both, matching the existing create path.

Columns absent because they are structural or audit, not data: `id`,
`template_id`, `project_template_id`, `entity_type_id`,
`parent_entity_type_id` (re-derived from nesting), `sort_order` (array
order), `created_at` / `updated_at` / `created_by`, `is_active`,
`global_template_id`, `config_draft_since` / `config_draft_by`.

## 5. Backend

### 5.1 Endpoints

```text
GET    /api/v1/projects/{project_id}/templates/{template_id}/export   (new)
POST   /api/v1/projects/{project_id}/templates/import                 (new)
DELETE /api/v1/projects/{project_id}/templates/{template_id}          (new)
PATCH  /api/v1/projects/{project_id}/templates/{template_id}          (fixed, §5.6)
```

All guarded by `require_project_manager`, all rate-limited (`@limiter.limit`:
export 30/minute, import and delete 10/minute), all returning the standard
`ApiResponse` envelope; every refusal body is declared on the route
(`responses={...}`) so its code reaches `schema.d.ts`.

- **Export** reads the live rows for the path template (BOLA chain: template →
  project; a QA template id is a 404 — v1 is extraction-only) and returns the
  portable document as the response payload. It reads
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
  so the dialog's success path is unchanged.
- **Delete** and **PATCH** are specified in §5.6–5.7.

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
- `app/services/project_template_active_service.py` — gains the module-level
  helper `deactivate_sibling_extraction_templates(db, project_id,
  keep_active_id)`, promoted from `TemplateCloneService`'s private method. Three
  callers share it: clone, import, and `set_template_active` (§5.6). The
  import direction is dependency-safe: the clone service imports from this
  module, which imports only models and schemas.
- `app/services/template_delete_service.py` — `delete_template(db,
  project_id, template_id)` with the §5.7 guards. Its own module, like its
  siblings `template_discard_service.py` / `template_restore_service.py`.

### 5.3 Import algorithm

One transaction:

1. Validate the document (Pydantic). Reject `kind != "extraction"` with a
   typed error.
2. Deactivate the project's active extraction templates via the shared helper
   (§5.2).
3. Insert the `ProjectExtractionTemplate` row with `global_template_id = NULL`
   and `schema_ = {}`.
4. Walk `sections` parent-first, in array order: insert each entity type with
   `sort_order = index` and the derived `role`/`parent`, then its fields with
   `sort_order = index` and `validation_schema = {}`.
5. Publish v1 through `TemplateVersionService.republish`, which snapshots the
   structure and clears the draft marker the inserts just stamped.

**No topological sort.** The clone service needs one because it reads a flat
list of global entity types; a nested document is already parent-first by
construction. This is why the import does **not** reuse
`TemplateCloneService._insert_project_structure_from_global` — sharing would
drag machinery the file path does not need. Only the tail (deactivate siblings,
republish) is shared.

`sort_order` for entity types is one **template-wide pre-order counter**
(parents first), never a per-level index: `SNAPSHOT_SQL` orders by the bare
column, so ties would make the snapshot's array order scan-dependent and let
a no-op Publish mint a phantom version.

After validation the only DB-level failure left is the concurrent-activation
race on `uq_one_active_extraction_template_per_project` (two imports, or an
import and a switch, at once); it surfaces as a 409 `CONFLICT` and nothing is
written (the request session never commits). A partially-imported template is
never representable.

### 5.4 Errors

| Condition | HTTP | Code |
| --- | --- | --- |
| Schema/structural validation failure | 422 | `TEMPLATE_IMPORT_INVALID` |
| `kind` is not `extraction` | 422 | `TEMPLATE_IMPORT_WRONG_KIND` |
| `prumo_template` is not `1` | 422 | `TEMPLATE_IMPORT_UNSUPPORTED_VERSION` |
| Export: a live row the format cannot carry (e.g. an empty `allowed_values`) | 422 | `TEMPLATE_EXPORT_INVALID` |
| Import/switch: concurrent activation race | 409 | `CONFLICT` |
| Delete: template is active | 409 | `TEMPLATE_ACTIVE` |
| Delete: a run or instance references the template | 409 | `TEMPLATE_IN_USE` |
| Template not in the path project | 404 | existing not-found handling |

Validation failures carry a human-readable list built from Pydantic's `loc`
paths — `sections[2].fields[5].name: must match ^[a-z][a-z0-9_]*$` — capped at
the first 20 entries, delivered twice: typed in `error.details.errors`
(`[{path, message}]`, plus `error_count`; what the UI renders) and as one line
per issue in `error.message` (for clients that only read the message). Raw
`prumo_template` / `kind` values echoed in a message are truncated to 80 chars.

### 5.5 Size caps

`sections` ≤ 100 per level, `fields` ≤ 200 per section, enforced by Pydantic.
A pathological file becomes a fast 422 instead of a long transaction.

### 5.6 Switch — `set_template_active` deactivates siblings

`set_template_active(is_active=True)` on an **extraction** template today
flips the flag and nothing else. With another extraction template active, the
flush trips the partial unique index
`uq_one_active_extraction_template_per_project` — a latent bug: the endpoint
cannot currently activate a second extraction template, which is exactly what
"Switch to" needs. The fix is the shared helper from §5.2, called before the
flag write, kind-scoped so QA (where several templates may be active) is
untouched. The deactivate-path guard ("cannot disable the only active
extraction template") is unchanged.

### 5.7 Delete

`delete_template(db, project_id, template_id)`, one transaction, with the
template row locked `SELECT … FOR UPDATE` before any guard runs:

1. 404 unless the template belongs to the path project.
2. **409 `TEMPLATE_ACTIVE`** if `is_active` — "switch to another template
   first". One rule for every kind: it keeps the at-least-one-active extraction
   rule intact by construction and makes it impossible to delete what is on
   screen. (QA tabs already have toggles: deactivate, then delete.)
3. **409 `TEMPLATE_IN_USE`** if any `extraction_runs` or `extraction_instances`
   row references the template — one query with two scalar subqueries, so the
   user sees a message rather than a 500. **This locked pre-check is
   load-bearing, not belt-and-braces:** `extraction_runs` carries a second,
   composite FK to the template (`fk_extraction_runs_template_kind_coherence`,
   `ON DELETE CASCADE`) next to the `RESTRICT` one, and Postgres fires RI
   triggers in name order — today RESTRICT happens to fire first on local and
   prod, by oid accident. The `FOR UPDATE` serializes against `create_run`'s
   `FOR SHARE` and the instance-insert `KEY SHARE`, so no run can appear
   between the check and the delete; if one still does, the FK constraint
   names map to the same 409.
4. Delete the row with `DELETE … WHERE id = :tid AND is_active = false`; a
   zero rowcount means a concurrent Switch activated it and is the
   `TEMPLATE_ACTIVE` 409 — the project can never be left with no active
   template. `extraction_entity_types` (→ `extraction_fields`) and
   `extraction_template_versions` cascade. The template-scoped
   `extraction_hitl_configs` row (`scope_kind = 'template'`, `scope_id` has no
   FK and would otherwise be orphaned) is deleted in the same transaction.

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
  dialog below; its icon changes from `Download` to `Upload` (it competed with
  the new Export affordance — a one-line fix in code this change already
  touches).

### 6.2 The template dialog

`ImportTemplateDialog` becomes the "Switch template" dialog the 2026-08-05
spec named. It is hosted by both `TemplateConfigEditor` and
`ExtractionInterface`, so both get the behavior. Three parts, top to bottom:

1. **This project's templates** — every extraction template of the project,
   active and inactive (`fetchProjectTemplates(..., includeInactive = true)`),
   with name, framework, and created date (the date is what makes two
   same-named imports distinguishable). The active row is marked. Inactive
   rows carry **Switch to** (the PATCH, §5.6) and a **trash** action that opens
   an `AlertDialog` — *"Delete '<name>'? Its sections and fields are removed.
   This cannot be undone."* — then calls the DELETE; a 409 renders its message
   inline. The active row carries neither.
2. **Add from catalogue** — the existing global list, unchanged.
3. **Add from a file** — a file input, an Import button, and one line of
   trust copy (§8).

**The browser does not validate the document.** It reads the file, `JSON.parse`s
it (a syntax error becomes a local "not a valid JSON file" message), and posts
the object; the server validates it and the typed issue list
(`error.details.errors`) renders one line per issue.

**The editor host forwards the change.** `ExtractionInterface` owns
`activeTemplate` (an active-only read, not TanStack); a switch or import
launched from the dialog inside `TemplateConfigEditor` therefore calls back
up (`onActiveTemplateChanged(id)`) so the grid re-points to the new active
template instead of keeping the now-inactive one on screen.
Re-implementing the schema in TypeScript would duplicate exactly the knowledge
this design consolidates in one Pydantic model.

The project list and the file pane are their own components; the dialog
composes them (the file-size ratchet, and the dialog is already 243 lines).

### 6.3 Services and copy

- `frontend/services/templateImportService.ts` gains
  `importTemplateFromFile(projectId, file)`.
- `exportTemplate(projectId, templateId)` and `deleteTemplate(projectId,
  templateId)` alongside it. Switch reuses `setTemplateActive` from
  `useHITLProjectTemplates`.
- New copy keys in the `templateConfig` namespace
  (`frontend/lib/copy/templateConfig.ts`) — `extraction.ts` sits at its
  file-size ratchet ceiling and must not grow — English only, avoiding the
  banned user-facing noun "Run".

## 7. Accepted costs and adjacent breakage

**No duplicate-name guard on import.** Importing the same file twice creates
two templates. With §6.2 both are visible, dated, and the stale one is one
trash click away, so blocking (which would dead-end "import my revised CHARMS")
or warning (a pre-flight round trip) would buy nothing.

**No rename.** No surface renames a project template, so an imported
template's name is frozen at import; change it in the file. Not worth a slice.

**Pre-existing, out of scope — the "Create custom template" dialog is
broken.** `createCustomTemplate` in `frontend/services/templateService.ts`
inserts `project_extraction_templates` directly through PostgREST with no
version row; the deferred constraint trigger
`project_extraction_templates_active_version` (migration 0004) fails the
commit. The button is reachable from `ExtractionInterface`. It is tracked
separately; after this slice, a minimal portable file is the working way to
start a template from scratch.

## 8. Security note

An imported document carries `llm_description` (per field) and
`llm_template_instruction` (per template), both of which are interpolated into
extraction prompts. Importing a third-party template is therefore a
prompt-injection vector into that project's runs.

Every key that reaches a prompt: `llm_template_instruction` (≤ 4000),
`llm_description` (≤ 4000), section `description` (≤ 500, interpolated into
the section-extraction prompt), field `description` (≤ 500, the fallback when
`llm_description` is empty), section `name`/`label`/`entry_label`, and
`allowed_values` (become a JSON-schema enum). What already mitigates it: the
endpoint is manager-only and rate-limited, every one of those keys is
length-capped, instruction text enters prompts as a `str.format` *argument*
after rendering (braces cannot inject placeholders), and the document is
inert data — nothing in it is executed or fetched. The import pane carries one line of copy: *"Only import
templates you trust."* A content scanner is not justified at this scope.

## 9. Verification

The first test written, and written failing:

**Round-trip.** Seed CHARMS → clone into project A → export → import into
project B → export again → assert the two documents are equal. This exercises
both directions and every carried column at once, and fails loudly if either
side drops a key.

Then, backend:

- Each rejection case in §5.4 returns its typed status **and writes nothing**
  (assert the rollback: no new `project_extraction_templates` row).
- Structural rejections: `sections` under a non-group, two groups, nesting
  deeper than one level, duplicate field name within a section, bad `name`
  patterns, unknown `type`, a `validation_schema` key (rejected as unknown).
- Two sections sharing a `name` import successfully (the import must not be
  stricter than the editor — §4.2).
- Import activates the new template and deactivates the previously active one;
  exactly one active `extraction_template_versions` row exists afterwards and
  its `schema_` matches the imported structure.
- Switch: activating an inactive extraction template via PATCH deactivates the
  active sibling (the §5.6 regression — today this trips the unique index);
  activating a QA template deactivates nothing.
- Delete: 409 on the active template; 409 on a template with a run; 404 across
  projects; on success the entity types, fields, versions, and template-scoped
  hitl config row are gone.

Frontend:

- vitest: the export button downloads with the expected filename **and a blob
  whose parsed contents are the unwrapped document** (top-level
  `prumo_template`, no `data`/`error` envelope keys — §5.1); a pending draft
  raises the confirmation; a server validation error renders in the dialog;
  the project list shows an inactive file-imported template with Switch and
  trash, and the active row with neither; delete asks for confirmation.
- Playwright: export from a project, re-import into the same project, assert
  the grid renders the same sections and fields; switch back to the original;
  delete the import.

## 10. Out of scope

- Importing into an existing template; merging; diffing a file against a
  template.
- Global-catalogue import and retiring the Python seed pattern — the natural
  follow-up, and the reason the format is worth getting right now.
- `kind: quality_assessment` import/export (the delete endpoint is
  kind-agnostic by construction, but only the extraction dialog surfaces it).
- Multi-template bundles, YAML, CSV.
- Renaming a project template (§7).
- Fixing the custom-template dialog (§7).
- Format migration. `prumo_template: 1` only makes a future v2 detectable.

## 11. Amendments (2026-08-23, after the plan's adversarial panel)

- §4.1–4.3: caps on template `description` (2000), section `description`
  (500), total fields (2000); `llm_description` relaxed to 4000 so the seeded
  CHARMS+Multimodal round-trips.
- §5.1: rate limits; export rejects QA ids; refusal bodies declared on routes.
- §5.3: template-wide `sort_order` counter; the concurrent-activation race is
  a 409 `CONFLICT` (replaces the earlier "any IntegrityError → 422" wording).
- §5.4: `TEMPLATE_EXPORT_INVALID`; typed `details.errors`; truncated echoes.
- §5.7: guards under `FOR UPDATE`, conditional delete, the composite CASCADE
  FK fact that makes the locked pre-check load-bearing.
- §6.2/6.3: the editor host forwards the active-template change; copy lives
  in `templateConfig`.
- §8: the full list of prompt-reaching keys.
- Out of slice, tracked separately: `authenticated` holds `DELETE/INSERT/
  UPDATE` on `project_extraction_templates` via PostgREST (the new guards are
  API-only); `extraction_entity_types`/`extraction_fields` SELECT policies
  are `USING (true)`; three private `triggerDownload` copies.
