---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9b0 — typed publish refusal (+ the diff-read decisions B-9b2 inherits)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore) + a 3-lens adversarial panel (**18 findings,
> 5 blocking**) against dev @ `a5a0dcfb`. Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`.
>
> **This file was re-scoped by its own panel.** The first draft
> ("B-9b1 — the diff read surface") would have shipped
> `GET config-diff` with **zero consumers** — exactly what B-9a's
> ratified D7 forbade in as many words. Rather than override a ratified
> decision silently, the read surface moves into **B-9b2**, where the
> sheet is the consumer that ratifies the wire model, and what remains
> here is the one piece with a live consumer today.

## What B-9b0 ships

The Publish button's failure path. Today `PublishBlockedByMultiEntryError`
is flattened to `HTTP_ERROR` with no `details`, and
`useTemplateRepublish` toasts the server's English prose verbatim. This
slice types it — the same shape B-9c2 gave the discard refusals — so the
client branches on a code and composes its own sentence.

Small, user-visible, independent of the diff read, and it removes the
last untyped 409 on the template-config surface.

## Load-bearing facts (verified 2026-08-09)

- **Only one publish refusal can reach the button.**
  `PublishBlockedByMultiEntryError` (`template_version_service.py:51-63`,
  raised `:281-285`) is caught at `project_templates.py:246-250` →
  `HTTPException(409, str(e))`. `PendingConfigDraftError` fires only
  under `fail_if_pending_draft=True`, passed from exactly one place —
  `template_clone_service.py:170` — so it provably cannot reach the
  republish endpoint, and deleting that `except` creates no new 500 path.
- **The refusal names sections, plural, nondeterministically.**
  `_refuse_if_one_section_has_multi_entries`
  (`template_version_service.py:264-285`) selects all cardinality-one
  `model_section` rows with **no `ORDER BY`**, loops, and raises on the
  **first** offender. Two flipped sections ⇒ which one the manager is
  told about depends on heap order.
- `app_error_handler` does **not** `jsonable_encoder` its `details`
  (B-9c2's blocking finding) — JSON primitives only.
- `frontend/lib/copy/extraction.ts` is pinned at **958** in
  `scripts/fitness/check_file_size.baseline` and holds the existing
  generic key `errors_republishTemplate`. New keys go in
  `templateConfig.ts` (the B-9c2 precedent).
- Codes live in a slice-local StrEnum next to
  `TemplateDiscardRefusalCode` (`schemas/hitl_session.py:111-129`) —
  **never** added to the global `ApiErrorCode` (`schemas/common.py:44-65`).

## Decisions (panel-ratified)

- **D1 — Type it, delete the catch.** `PublishBlockedByMultiEntryError`
  becomes an `AppError` subclass with a stable code in a new
  `TemplatePublishRefusalCode` StrEnum; the `except` at
  `project_templates.py:246-250` is **deleted** so it reaches
  `app_error_handler`; `responses={409: …}` is declared on the route
  (the repo's second, after `discard-draft`). The subclass `__init__`
  forwards to `AppError` by keyword so `str(e) == message` and existing
  `pytest.raises` assertions survive.
- **D2 — Every offender, deterministically.** The refusal is raised
  **once, after the whole loop**, carrying every offending section; the
  select gains `ORDER BY sort_order, id`. The payload is
  `section_labels: list[str]` — never a bare `section_label`, which
  would report a heap-order-dependent single name.
- **D3 — The clone endpoint keeps its catches.** Only
  `project_templates.py:246-250` is deleted; the clone endpoint's
  `except PublishBlockedByMultiEntryError` (`:109`) and
  `except PendingConfigDraftError` (`:104`) stay — clone has no client
  branching on the code and its unit tests pin the `HTTPException`
  mapping. The asymmetry (same domain error, `HTTP_ERROR` on clone,
  typed on republish) is **accepted and recorded**, not overlooked.
- **D4 — The client composes the sentence.** `templateService`'s
  republish wrapper maps the typed 409 to a slice-local refusal error
  (the `TemplateDiscardRefusal` shape) carrying `code` and
  `sectionLabels`; `useTemplateRepublish` toasts a **local copy key**
  with the labels interpolated, keeping `errors_republishTemplate` as
  the generic fallback for anything else. New keys in
  `templateConfig.ts`.

## Tasks

**T1 — Backend (D1, D2, D3)**
Convert the error, delete the one catch, add `ORDER BY`, accumulate
offenders, declare `responses=`. **Required test rewrite**:
`backend/tests/unit/test_template_clone_endpoint.py:126-160`
`test_republish_maps_publish_blocked_to_409` becomes
`pytest.raises(PublishBlockedByMultiEntryError)` asserting `.code`,
`.status_code == 409`, `.details` and `db.commit.assert_not_awaited()` —
keep it, it is the diff-cover-visible endpoint test that the ASGI test
does not register. Add an **ASGI-level** test asserting the envelope
(`error.code`, `error.details.section_labels`) — a service-level
`pytest.raises` proves an attribute, not the wire. Add a two-offender
case pinning determinism. Regenerate
`frontend/types/api/{openapi.json,schema.d.ts}` in the same commit.

**T2 — Frontend (D4)**
The wrapper, the hook's toast branch, the copy keys in
`templateConfig.ts`. Named test updates (the panel enumerated three
sites asserting today's toast); keep one assertion proving a non-409
still yields the generic copy. Frontend suite with the worktree `.env`
moved aside (CI parity).

**T3 — Slice close**
Adversarial review → fixer → `make quality-scan` + `make test-backend`
(serial) → browser pass only if a two-entry section can be staged
cheaply; otherwise the integration test is the evidence and the PR says
so → PR + auto-merge + watcher + memory.

---

## Pre-decided for B-9b2 (do not re-litigate; the panel already ruled)

The diff read moves into B-9b2 as its first two tasks, **with these
amendments already ratified**:

- **Change identity is a structured composite key, not a hash** —
  `"{kind}:{node_kind}:{node_id}:{attribute or '-'}:{option_code or '-'}"`,
  `node_id` being the **raw string** node id (`_as_uuid` swallows
  `ValueError` and returns `None`, and `_index` stringifies a missing id
  to the literal `"None"`, so deriving from the parsed `UUID | None`
  collides two junk-id nodes), with `"template"` reserved for the
  instruction row. Provably unique by the panel's walk of every emission
  site, bounded, JSON-primitive, and **greppable in a refusal log** —
  an opaque hash would leave B-9b2's re-validation naming a 16-hex blob.
- **The wire discriminator is a NEW enum over the 13 reachable shapes**,
  not a re-export of `ChangeKind`, which leaves two overloads intact:
  `REORDERED` means both "fields in this section" (count **excludes** a
  just-added field) and "options on this field" (count **includes** a
  just-added option), and `(MODIFIED, FIELD, allowed_values)` is
  option-removed (destructive) vs option-added (additive), distinguished
  only by which of `before`/`after` is null — the exact split the ack
  checkboxes key off. Unreachable and not to be invented:
  `(MOVED, ENTITY_TYPE)`, `(REORDERED, TEMPLATE)`, `(MOVED, TEMPLATE)`.
- **`before`/`after` never ship raw.** `validation_schema` and
  `allowed_units` are JSONB, so an `Any` payload regenerates as
  `unknown` — defeating the whole reason for `responses=`. Ship
  server-rendered `before_display`/`after_display` strings; assert no
  field on the read model is typed `Any`.
- **`affects_recorded_data` is computed in ONE post-pass**, derived per
  node (field ⇒ in the value set; entity type ⇒ any live child field in
  it; template ⇒ false), because `_diff_options` takes no value
  information at all and would otherwise ship `false` for a destructive
  option removal on a field full of answers.
- **Name it for what the query proves.** The resolver unions five
  RESTRICT tables including AI/system proposals, so it means *recorded
  extraction work exists*, human or not. Forbidden sentences for the
  sheet: "N answers reviewers gave", and any per-option claim.
- **The resolver is promoted to a repository**, not a new service module
  — it is one `union()` over five model tables with no business logic —
  and both callers re-point to it so the discard gate and the sheet
  cannot diverge.
- **The no-baseline shape is defined here**: 200 (never 404, matching
  config-status), `initial_version: true`, empty buckets. B-9a's D8
  claimed the service "records `initial_version`" — it does not; that
  symbol does not exist in the tree.
- **`inventory_complete` is redefined or dropped.** Key absence in the
  raw stored `schema_` *is* unambiguous (`jsonb_build_object` never omits
  a key), but the hazard it was named for is a **discard-side** write
  concern that B-9c2 D11 already owns. If kept, it is an *attribution*
  caveat ("the baseline predates keys K"), not a completeness one.
- **Tier is deliberately absent from the id**, so B-9b2's re-validation
  must compare `(id, tier)` pairs: an ack whose tier escalated between
  render and publish counts as absent and the publish refuses. And note
  that `fields_with_values` is **not** covered by a snapshot fingerprint
  — a reviewer recording an answer mid-sheet escalates a tier without
  touching the tree at all.
- **The GET takes no locks** (it is a read), and the cost measurement
  must be taken against realistic proposal volume — no index on the five
  workflow tables leads with `field_id`, so the number scales with
  recorded work, not with template size. `config-status` keeps
  `fields_with_values=frozenset()` and must never resolve the real set.

## Non-goals

Everything in the pre-decided block above (that is B-9b2); the sheet,
the per-item acks, the fingerprint, migration 0052 and the version
`note` (B-9b2); the runs/reopen section (§6 / B-9g); History (B-9e); the
editor lock (B-9f); narrow-baseline backfill (B-9x).
