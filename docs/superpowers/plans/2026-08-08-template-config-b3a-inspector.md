---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Track B — slice B-3a (active-snapshot reads) + editable inspector

Two deliverables, two PRs, both user-directed. Context:
`docs/superpowers/plans/2026-08-07-template-config-b1-grid-shell.md`.

## PR 1 — B-3a: worklist, dashboard and exports read the ACTIVE snapshot

**Why.** Progress rings and export labels read LIVE template rows. Safe
today (every edit republishes), broken under B-4: an unpublished draft
edit would move progress numbers project-wide and leak into exports.
This slice is inert-by-construction and, with B-2, completes B-4's
read-side prerequisites.

**Inertness rule.** Same projection, no behavioural change:

- The new hook adapts the snapshot tree to the EXACT legacy shape —
  entity-level `is_required` is deliberately stripped, because today's
  hook omits it and supplying it would activate `progress.ts`'s
  phantom-slot logic (visible number changes). B-3b removes the strip
  as its own tiny, disclosed PR.
- The endpoint returns a typed 404 when the template has no active
  version — NEVER an empty tree (inherited BLOCKING: an empty tree
  computes as 100 % complete). The hook surfaces `isError`, and error
  renders the same placeholder as loading — never a number computed
  from `[]`.

**Backend.**

1. `GET /api/v1/projects/{project_id}/templates/{template_id}/active-version`
   — `require_project_scope` (member; reviewers see the worklist),
   BOLA-scoped template lookup (id AND project_id — the export
   precedent), 404 `ProjectTemplateNotFoundError` for foreign/missing
   template, 404 for no active version (message mirrors the export's
   "Configure the template before exporting"). Body =
   `TemplateActiveVersionRead {version_id, version, entity_types:
   list[RunViewEntityType]}` — the tree comes from B-2's shared
   provider (`entity_types_for_version` on the active version id), so
   the narrow/heterogeneous → live chain is inherited, not re-implemented.
2. `exports/extraction_snapshot_reader.py` **delegates** to the shared
   provider — its `_snapshot_is_narrow` copy is a live correctness bug
   TODAY (first-element/role-only probe accepts 0016→0026-era snapshots
   B-2 rejects, silently defaulting `llm_description`/`allow_other`/
   disposition flags in exports). `load_export_sections` becomes
   provider → `_section_from_view` mapping; export-specific
   `_normalize_allowed_values` + enum coercion stay.
3. `_load_entity_type_role_map` derives from the already-loaded anchor
   sections instead of a live query (3 call sites, one derivation).
4. AI-metadata label fallbacks become chains (chain, never swap):
   run-snapshot sections → live table → `"(unknown section)"` /
   `"(unknown field)"`. The per-run sections are already loaded and
   cached by `version_id` for the obsolete-fields diff — reuse.

**Frontend.**

5. `templateStructureService.getActiveTemplateStructure(projectId,
   templateId)` (typed apiClient, throwing style) +
   `useActiveTemplateStructure` hook + `templateActiveStructureKeys`
   factory.
6. Re-point the three worklist/dashboard consumers (HITLArticleTable,
   ArticleExtractionTable, ExtractionInterface) — all already have
   `projectId`. The CONFIG GRID stays on the live read (it must show
   the draft after B-4).
7. Invalidation parity: `useTemplateRepublish` and the
   import-success handler invalidate the NEW key alongside the live
   one — otherwise republish/import leaves worklist progress stale.

**Tests.** Endpoint (coroutine unit + service integration incl. BOLA +
no-active-version 404); provider-delegation equivalence for the export
reader (a narrow-field snapshot now falls back to live — divergence
test); role-map derivation; label-fallback chain (run-snapshot beats
live, live beats unknown); hook adapter shape (entity `is_required`
absent in B-3a); consumer error-renders-placeholder.

## PR 2 — editable inspector (field edits without the popup)

**Why.** User-directed: editing a field's common properties should not
require the dialog. This pulls forward the SAFE part of B-5's writable
inspector: a form with one explicit Save per edit session has the same
republish cadence as the dialog it replaces — it does not raise edit
rate the way inline cell editing (blocked until B-4) would.

**Scope.** Field form: `label`, `is_required` (switch — spec §2 puts
the switch in the inspector), `allowed_values` (chips + Enter-to-add +
per-chip remove; reorder stays in the dialog), `llm_description`,
`description`. NO `field_type` — that keeps the entire type-change
validation machinery (`onValidate`, revert-on-refuse) in the dialog,
and means the inspector needs no per-selection impact request. The
"Edit field" button remains for type/name/other-specify/dispositions.
Sections stay read-only here (rename is already inline in the grid).

**Write path (composed, not the heavy hook).** `useFieldManagement`
costs 2 requests per mount (permissions + a whole-section field fetch
the panel already has) — the map flags mounting it per selection as the
trap. Instead: a small `useUpdateTemplateField(projectId, templateId)`
mutation = `extractionFieldService.updateField(fieldId, patch)` (5-key
partial — valid per `ExtractionFieldSchema.partial()`) → **await**
`republish()` (the dialog's fire-and-forget `void republish()` is the
known desync wart; awaiting keeps the dirty state honest) → the
existing invalidation refreshes grid + inspector. Permission gating:
the tab is managerOnly and RLS enforces manager on the write; a failed
save toasts exactly like the dialog.

**Interaction.** The `TemplateInstructionRow` draft pattern, per-field:
draft state keyed by `field.id` (reset on selection change), dirty-gated
Save + Reset, empty string → `null` for nullable keys, success toast,
draft kept (not cleared) through the refetch so the form never flips
back. Options rules reuse the dialog's trim/dupe/max-100 constraints;
empty list collapses to `null` (Zod `min(1)` when present).

**Tests.** Component: dirty gating, 5-key payload shape, options
add/remove + null collapse, reset-on-selection-change, save awaits
republish before clearing dirty; a11y names for new controls.

## Out of scope (recorded)

B-3b (entity `is_required` in progress — visible numbers, own PR);
QA framework label (live template metadata); `derived_judgments`
(no snapshot carries it); QA assessment form live reads; option
reorder in the inspector.
