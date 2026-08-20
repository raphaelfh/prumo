---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9a — server-computed draft diff + change count

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore, 2026-08-09) + a 3-lens adversarial panel
> (22 findings, 6 blocking, all folded in below). Tree at B-8 head
> `0bfc7fba`. Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`
> — **read "Stale spec facts" first; ten §1/§1.1/§6 assumptions are false.**

## Why this slice exists

B-9 as specified is 5–7 shippable slices. This is the first: **the server
learns to describe the draft**. Everything downstream (Publish sheet
tiers, History per-version diff, Discard confirmation, per-change Revert)
consumes this one computation. It ships alone: the Draft chip stops being
a boolean and becomes "Draft · 6 changes" — it calibrates a state the user
is already shown, and promises no list.

Re-slice (this plan owns only **B-9a**):

| slice | scope | depends on |
|---|---|---|
| **B-9a** | pure diff engine + tiers + count on the chip | — |
| B-9b | `GET config-diff` + Publish sheet (tiered, acks) + version `note` | B-9a |
| B-9c | Discard draft (pays for the snapshot→live writer) | — |
| B-9d | deletes-never-confirm + undo extension | B-9c |
| B-9e | History card (+ Restore vN as draft) | B-9a, B-9c |
| B-9f | advisory editor lock | — |
| B-9g | §6 reopen-on-publish (needs its own map; §6 is mis-specified) | B-9b |
| B-9x | narrow-snapshot live-fallback audit | — |

## Stale spec facts (verified — do not re-litigate)

1. **§1.1's three "critical prerequisites" are ALL DISCHARGED.** AI
   prompts read the pinned snapshot (`extraction_snapshot.py:176`
   `entity_types_for_version`); worklist/exports read the active snapshot
   (`useTemplateEntityTypes` has ONE consumer left —
   `TemplateConfigGridPanel.tsx:116`, which *must* read live); clone
   self-heal 409s on a pending draft (`template_clone_service.py:158-166`
   + locked re-check `template_version_service.py:119-134`).
2. `useFieldManagement.republish.test.tsx` was **deleted** in B-5 with its
   hook. Nothing to invert.
3. §1.2's role/parent write params **shipped in B-8**.
4. The only remaining PostgREST write in the template services is
   `createCustomTemplate` (`templateService.ts:329`).
5. **There is no draft object and no change log.** The draft *is* the live
   rows; `config_draft_since` (0048 triggers) is the only marker.
6. **No diff and no severity vocabulary exist** anywhere in the codebase.
7. **`republish` already carries two publish-time refusals** the spec never
   mentions — pending-draft and many→one cardinality (B-8) — both 409 with
   server-authored messages a future sheet must render verbatim.
8. **§6 is mis-specified** (recorded so B-9g starts honest):
   `reopen_to_extract` is destructive in-place (deletes
   `ExtractionPublishedState`) while `reopen_run` forks a child; and
   `ExtractionHitlConfig.arbitrator_id` is NOT authoritative today
   (`is_project_arbitrator` → `role IN ('manager','consensus')`, backing
   four RLS policies).

## Load-bearing map facts (panel-corrected)

- Snapshot builder `extraction_snapshot.py:45-97` `SNAPSHOT_SQL`; the
  top-level `llm_template_instruction` key is emitted **only when the live
  value is truthy** (`:130-141`) — it can be absent on either side.
- **`snapshot_is_narrow` takes the entity-types LIST, not the snapshot
  dict** (`:145-173`; only real call site `:194` passes
  `(version.schema_ or {}).get("entity_types", [])`). Passing the dict
  iterates its KEYS and returns True for everything.
- Its probes are only `role` / `llm_description` / `allow_other`, so it
  does **not** detect later key additions: `allows_not_applicable` and
  `allows_not_evaluated` (#462, after 0026's frozen list) and
  `entry_label` (0051/B-8). Those baselines are "wide" yet key-poor.
- **`config-status` is B-4, not B-7**: `project_templates.py:255-280`
  (306-line module, 800-line ceiling — room to grow), service
  `template_version_read_service.py:29-47`, response
  `TemplateConfigStatusRead`. Client type is an alias of the generated
  schema (`templateService.ts:30-31`) — no hand-mirror.
- Fields carry **no `entity_type_id`** in the snapshot; parent is nesting
  only (`SNAPSHOT_SQL:62-87`). Field ids are stable across
  `POST .../fields/{id}/move`.
- `sort_order` is dense per-section and `planFieldMove` renumbers **whole
  sections** on every move (`fieldMove.ts:105-110`). There is **no**
  section reorder or re-parent write path (`SectionUpdateRequest` =
  label/entry_label/cardinality only; create appends max+1).
- Select options are **bare strings** (`AllowedValues`,
  `TemplateFieldRead.allowed_values: list[str] | None`); legacy rows may
  be `{"options": [{value,label}]}` — `normalize_options`
  (`app/llm/claim_value.py:22-37`) exists for exactly that.
- The 0048 triggers are unconditional per row with no OLD/NEW distinctness
  test (`0048:113-121`), and `republish` clears the marker in **both**
  branches (`template_version_service.py:144-154`) — so
  **marker-set-but-snapshot-identical is a real, supported state**.
- Completion gate reads required fields from the run's **pinned** schema
  per existing instance (`run_lifecycle_service.py:485-513`); republish
  re-pins only `pending`/`extract` runs (`:287-299`).
- `move_field` has **no in-use guard** (contrast `delete_field`'s RESTRICT
  path) and `update_field` **does not block a `field_type` change on a
  field holding data** — despite `inspectorTypeChangeHint` telling the user
  it does (`extraction.ts:786`). Both are pre-existing bugs; spawned as
  separate work, **not fixed here**, but they drive tier choices below.
- Existing plural convention: two keys + `{{n}}` selected by a ternary
  (`configSectionsCountOne`/`Other`, `extraction.ts:89-90`, used at
  `TemplateConfigEditor.tsx:178-180`). Header cluster is `shrink-0`, title
  is `min-w-0 truncate` — a longer chip costs the title, not the buttons.

## Decisions (panel-ratified)

- **D1 — What a change is.** Diff = `build_template_version_snapshot(live)`
  vs the **raw stored** `active.schema_`. Two roots are walked:
  `entity_types` **and** the template-level `llm_template_instruction`.
  - Entity types are indexed by id; **fields are indexed GLOBALLY by id**
    across the whole snapshot, with the owning entity id as a derived
    attribute. A field id on both sides under different parents is ONE
    `moved` change ("A → B"), never remove+add. Only ids present on one
    side are added/removed.
  - **`sort_order` is excluded from the attribute loop entirely.** Reorder
    is derived from the *relative* sequence of ids present on both sides
    under the same parent, after removing ids that changed parent:
    unchanged sequence ⇒ no change, however much the integers moved;
    changed sequence ⇒ ONE cosmetic "reordered N fields in X".
  - Entity-type reorder/re-parent handling is dropped (no write path can
    produce it — YAGNI).
  - Options: no rename detection is possible (bare strings). Normalize
    both sides through `normalize_options`, then set-difference: removed ⇒
    `destructive` (one per option), added ⇒ `additive`, same set in a
    different order ⇒ one `cosmetic` per field. B-9b must never claim
    "renamed".
- **D2 — Tier map, exhaustive over the SNAPSHOT_SQL key set, default
  `semantic`** (never cosmetic for an unmapped key). The question a tier
  answers: *can this invalidate data a reviewer already entered, or change
  the completion gate of an in-flight run?*
  - `cosmetic`: `label`, `description`, `llm_description`, `other_label`,
    `other_placeholder`, reorder within a parent.
  - `semantic`: `name`, `field_type` (empty field), `is_required`,
    `cardinality`, `role`, `unit`, `allowed_units`, `validation_schema`,
    `allows_not_applicable`, `allows_not_evaluated`, `allow_other` turned
    **on**, `entry_label`, the template instruction, **a new required
    field or a new section containing required fields**, and a `moved`
    field with no recorded values.
  - `destructive`: node removed, option removed, `allow_other` turned
    **off** (orphans free-text), `field_type` changed on a field **with
    recorded values**, `moved` field **with recorded values** (values are
    keyed `(instance_id, field_id)`; re-parenting strands them on the old
    section's instances and they stop rendering —
    `extraction_run_read_service.py:222-258`).
  - `additive` (pre-approved, never shown): new **optional** field, new
    section with no required fields, new option.
  - `entry_label` is NOT cosmetic (B-8 made it the export record stem,
    `extraction_export_service.py:2069-2075`, and the AI instance-label
    fallback): changing it silently relabels exported model rows.
- **D3 — Value-existence is an argument, not a query.**
  `diff_snapshots(baseline, current, *, fields_with_values: frozenset[UUID])`
  — required parameter, no default, so no caller can silently under-warn.
  B-9a's count path passes `frozenset()` explicitly (tiers are not
  consumed by a count); B-9b's sheet resolves the real set with one
  grouped query. D6's purity is preserved.
- **D4 — Missing-key rule (canonical defaults, both sides normalized).**
  `template_diff.py` owns a canonical key set mirroring SNAPSHOT_SQL with a
  default per key (`entry_label` → `'model'` when `role ==
  'model_container'` else `None`; `allows_not_applicable`,
  `allows_not_evaluated`, `allow_other` → `False`; …). Both sides are
  normalized through it before comparing, so a key absent from an
  older-era baseline never yields a change. **Exception:
  `llm_template_instruction` participates fully** with `absent ≡ null ≡ ""`
  on both sides (mirroring `set_template_instruction`'s
  `(x or "").strip() or None`): none→text = added, text→none = cleared,
  text→text = changed — all `semantic`. Without this exception an
  instruction-only draft (which touches no structural row, since 0048
  triggers only fire on entity types/fields and
  `template_instruction_service.py:66-76` stamps the marker directly)
  would count zero.
- **D5 — Baseline reliability, narrowly scoped.** Call it correctly:
  `snapshot_is_narrow((active.schema_ or {}).get("entity_types", []))`.
  A narrow (pre-0026-era) baseline ⇒ `pending_change_count = None` and
  `baseline_unreliable` in the service result. **The narrow gate covers
  only pre-0026 shapes** — later key drift is handled by D4, not by this
  flag. The baseline is read as the raw stored dict ONLY;
  `entity_types_for_version` is forbidden as a baseline source (it has a
  live fallback) and no reader may erase raw key-presence before D4 runs.
- **D6 — Pure function, no new persistence, no migration.**
  `backend/app/services/template_diff.py` is a pure comparison over two
  dicts plus the value-set argument; the read service composes it.
- **D7 — Where the count lives.** `TemplateConfigStatusRead` gains
  `pending_change_count: int | None = None` (optional ⇒ existing
  constructors and the generated TS type stay compatible), computed
  **only when `config_draft_since IS NOT NULL`** — a clean template pays
  nothing. Cost while a draft is open: one extra `SNAPSHOT_SQL` build plus
  an in-memory compare per config-status call; if that proves hot, B-9b
  moves it behind the lazy endpoint. **`GET config-diff` and
  `TemplateDiffRead` are deferred to B-9b**, where the sheet defines the
  payload (shipping a typed public contract with zero consumers is the
  YAGNI violation this slice avoids). B-9b must add a draft fingerprint
  (`config_draft_since` + a hash of the live snapshot) so it can detect a
  tree that changed between the acked diff and republish.
- **D8 — Unpublished regime.** No active version ⇒ no baseline ⇒
  `pending_change_count = None` (the service records `initial_version`
  for B-9b). config-status keeps its existing no-404 convention; the
  adjacent `GET active-version` 404 stays as is — status is a poll, the
  version read is a fetch.
- **D9 — Chip copy and the zero case.** The count renders **only when it
  is a positive integer**; `null` **and `0`** both fall back to the
  existing bare `configUnpublishedChanges` badge, because
  marker-set-with-identical-snapshot (A→B→A, or a no-op save) is a real
  state and "Draft · 0 changes" would be nonsense. Publish stays enabled
  in that state. Keys mirror the house convention:
  `configDraftChangeCountOne: 'Draft · {{n}} change'` /
  `configDraftChangeCountOther: 'Draft · {{n}} changes'`, selected by
  `count === 1`, `.replace('{{n}}', String(count))`.

## Tasks (subagent-driven, TDD per task)

**T1 — Diff engine (pure, backend, no DB)**
`backend/app/services/template_diff.py`: `TemplateChange` (kind, node
kind, id, label path, attribute, before, after, tier) +
`diff_snapshots(baseline, current, *, fields_with_values)` (D3).
Implements D1/D2/D4. Unit tests (no DB), RED first, covering at minimum:
- the four `llm_template_instruction` cases (D4 exception) incl.
  instruction-only draft ⇒ exactly 1 change;
- **era fixtures**: a pre-0038 baseline (no `allows_not_*`), a pre-0051
  baseline (no `entry_label`), and a mixed one — each ⇒ **0 changes**
  against an unedited live tree, and exactly 1 change for a 1-field
  rename;
- cross-section move ⇒ 1 `moved` (cosmetic without values, destructive
  with); move + whole-section renumber ⇒ still 1 change, no reorder rows;
- insert-in-middle renumber ⇒ 1 additive only; delete + renumber ⇒ 1
  destructive only; true sibling swap ⇒ 1 cosmetic reorder;
- options: dict-shaped baseline vs identical list-shaped live ⇒ 0;
  removed ⇒ destructive; added ⇒ additive; reordered ⇒ 1 cosmetic;
- new required field ⇒ semantic (not additive); `allow_other` off ⇒
  destructive; `field_type` change with/without values ⇒
  destructive/semantic;
- **a guard test asserting the tier map's key set equals the field/entity
  key set parsed from `SNAPSHOT_SQL`**, so a future key addition fails
  loudly instead of defaulting silently.

**T2 — Count on config-status (backend)**
`template_version_read_service.get_template_config_status` composes the
diff under D5/D7/D8 and fills `pending_change_count`
(`TemplateConfigStatusRead`, optional, D7). Integration tests, RED first:
a **wide** modern baseline yields a non-None count (the test that would
have caught the `snapshot_is_narrow` signature bug); narrow baseline ⇒
`None`; clean template ⇒ `None`; unpublished ⇒ `None`; A→B→A no-op chain
⇒ `has_pending_changes: true` with count `0`; instruction-only draft ⇒
count `1`; BOLA. Regenerate `frontend/types/api/{openapi.json,schema.d.ts}`.

**T3 — Chip (frontend)**
D9 rendering from the existing config-status query — no new query, no new
key family. Vitest: positive count singular/plural, `0` ⇒ bare badge with
Publish enabled, `null` ⇒ bare badge, unpublished ⇒ silence.

**T4 — Slice close**
Adversarial review of the diff (pinned to commits) → fixer →
`make quality-scan` + `make test-backend` (serial) → browser pass (edit a
field → chip counts; no-op save → bare badge; publish → "Published · vN";
network shows no extra round-trip) → PR + auto-merge + watcher + memory.

## Verification gates

RED before GREEN per task; ruff/eslint/tsc clean; no new fitness
offenders (`--update-baseline` only with justification); backend suites
never concurrent. **Run the frontend suite with the worktree `.env` moved
aside** — CI parity; the `supabaseUrl is required` import crash only
reproduces without env and cost a CI cycle in B-8.

## Non-goals

`GET config-diff` + `TemplateDiffRead` + the Publish sheet + version note
(B-9b); Discard and the snapshot→live writer (B-9c);
deletes-never-confirm (B-9d); History and Restore (B-9e); the editor lock
(B-9f); §6 reopen-on-publish (B-9g); backfilling narrow snapshots (B-9x);
`createCustomTemplate`'s PostgREST write; and the two pre-existing bugs
this planning surfaced (`move_field` has no in-use guard;
`inspectorTypeChangeHint` promises a `field_type` block that
`update_field` does not implement) — both spawned as separate work.
