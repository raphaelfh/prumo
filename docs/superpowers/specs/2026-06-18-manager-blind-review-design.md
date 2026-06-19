---
status: draft
last_reviewed: 2026-06-18
owner: '@raphaelfh'
---

# Manager blind-review + reveal toggle — design

> Scope: extraction (and QA) HITL blind-review visibility. Make **managers
> blind to other reviewers by default**, give them a **project-level toggle**
> to reveal peers, and consolidate blind-review onto a **single
> server-enforced source of truth** (no-legacy). Brainstormed 2026-06-18;
> decisions captured below.

## 1. Context and problem

Blind review today is hardwired to **role + stage**, enforced in four lockstep
places (the API read filter, RLS `0025`, the `current_values` resolver, and the
frontend gate):

- `unblinded = is_arbitrator OR run.stage == finalized`, where `is_arbitrator`
  collapses project roles **manager** and **consensus** into one boolean
  (`extraction_run_read_service.py:110`, `:308-319`).
- Plain **reviewers** see only their own in-flight values + AI/system proposals
  (blind ✓). **Managers and consensus members always see *everyone*, at every
  stage.** Everyone unblinds at **finalized**.

Two problems:

1. **A manager cannot extract blind.** There is no per-run/session/setting
   suppression — `is_arbitrator` is purely role-derived. A manager who also
   extracts is always shown peers (via the compare view, the per-field popover,
   and the consensus panel), which biases their own extraction.
2. **The `blind_mode` project setting is dead code.** It lives in
   `projects.settings` JSONB, is written by an Advanced-Settings `Switch` via a
   direct Supabase write, and is read into `isBlindMode` — but
   `canUserSeeOthers(role, _isBlindMode)` **ignores the flag** and gates purely
   on role (`frontend/lib/comparison/permissions.ts:56-64`). It only renders a
   cosmetic `EyeOff` badge. (It was neutered after an old bug where
   `blind_mode=ON` locked managers *out* of consensus.)

Additionally, the "other reviewers" read path (`useOtherExtractions →
ExtractionValueService.loadValuesForOthers`) is a **direct Supabase/PostgREST
read inside a service** — the dual-read path `CLAUDE.md` / `.claude/rules`
flag as the consolidation target.

## 2. Goals / non-goals

**Goals**

- Managers are **blind to other reviewers by default**; reviewers unchanged
  (already blind); `consensus` role unchanged (always sees — pure adjudicator).
- A **project-level, manager-only** setting reveals/hides peers for managers.
  Read **live** (toggling takes effect immediately), persisted via a **typed
  API endpoint**.
- Blinding becomes a **single server-enforced source of truth**; the dead
  `blind_mode` flag is retired and the `loadValuesForOthers` direct-Supabase
  read is removed.

**Non-goals**

- No change to the **reviewer↔reviewer** blindness boundary (the security-
  critical one) — it stays exactly as-is in RLS `0025`.
- No per-article inline toggle (the control is project-level — decided).
- No reveal gating on "submit your own decisions first" (reveal is anytime,
  trust the manager — decided).
- No quorum/`reviewer_count` enforcement (separate concern; see
  `reference_hitl_config_inert`).
- **QA scope:** the server blind-filter is run-based, so the manager-blind rule
  applies to `quality_assessment` runs too — but QA has no compare/peer UI
  (`QualityAssessmentFullScreen` doesn't use `useComparisonPermissions`). So the
  *server* change is kind-agnostic; the *frontend* toggle + compare-view work is
  **extraction-only**. No new QA UI in this scope.

## 3. Decisions (locked in brainstorming)

| Decision | Choice |
| --- | --- |
| Toggle scope | **Project-level persistent setting** (not per-article) |
| Blind policy | **Only managers** get the new blind default; reviewers unchanged; consensus always-unblinded |
| Reveal gate | **Anytime** (trust the manager) |
| Cleanup | **Full** — single server-enforced truth, retire dead flag, kill dual-read |
| Write path | **Focused typed endpoint** `PUT /api/v1/projects/{id}/extraction-settings` |
| RLS | **Unchanged** — manager-blind enforced at API/app layer, not RLS |

## 4. Data model — the setting

Add **`managers_see_reviewers: boolean`** to `projects.settings` (JSONB),
**default `false`** (managers blind by default). Retire the dead `blind_mode`
key.

- No Alembic migration: `projects.settings` is JSONB. Existing rows lack the
  new key → resolve to default `false` (blind). The SQLAlchemy model default
  (`backend/app/models/project.py:69-73`) changes from `{"blind_mode": False}`
  to `{"managers_see_reviewers": False}`.
- Read **live** from `projects.settings` at request time — NOT snapshotted into
  `hitl_config_snapshot` (unlike `reviewer_count`), so the toggle takes effect
  on the next read without reopening runs.
- Behavior change on ship: existing projects' **managers become blind by
  default** and must flip the toggle to adjudicate. Intended.

## 5. Server enforcement (source of truth)

In `extraction_run_read_service`, replace the binary `is_arbitrator` unblind
with a three-way rule. Split the helper so the two roles are no longer
collapsed for this decision:

```python
# pseudo
unblinded = (
    run.stage == FINALIZED
    or caller_role == CONSENSUS                      # pure adjudicator — always
    or (caller_role == MANAGER and managers_see_reviewers)   # live project setting
)
```

- `get_run_with_workflow_history` gains the caller's project role + the live
  `managers_see_reviewers` value (one extra read of `projects.settings`, or
  threaded from the endpoint which already loads membership). When blind, a
  manager's `proposals[]`/`decisions[]` are filtered to their own rows exactly
  like a reviewer.
- `resolve_caller_current_values` is **unchanged** — already strictly
  caller-scoped. The manager's editable **form** always shows only their own
  values; revealing affects the **peer/compare surfaces** (`proposals[]` /
  `decisions[]`), not the form binding.
- `is_run_arbitrator` keeps its current meaning for everything else
  (consensus-resolution permission, etc.); only the *read-blinding* decision
  consults the setting. Name the new read-blinding predicate explicitly
  (e.g. `caller_can_see_peers(...)`) so the "arbitrator can resolve" concept and
  the "can see peers" concept stop being conflated.

**RLS `0025`: unchanged.** Managers remain `is_project_arbitrator` in RLS, so
the reviewer↔reviewer boundary is untouched. Manager-blind is a trusted-
workflow aid enforced at the API/app layer (consistent with "reveal anytime").
A blind manager could in principle read peers via raw PostgREST, but they own
the toggle — not a real threat. **This deliberate API-stricter-than-RLS split
for the manager case will be documented** in the architecture doc so it is not
mistaken for a blind-leak regression.

## 6. The typed settings endpoint

`PUT /api/v1/projects/{project_id}/extraction-settings` — manager-only
(`Depends(require_project_manager)`), `ApiResponse[...]` envelope, typed Pydantic
request/response (no `dict[str, Any]`).

- Request: `{ "managers_see_reviewers": bool }`.
- Service reads `projects.settings`, sets the key, writes back; returns the
  resolved settings.
- Frontend `HitlConfigService` (or a small `projectExtractionSettingsService`)
  calls it via the typed `apiClient` (PUT). The Advanced-Settings direct-Supabase
  write of `blind_mode` is removed.
- This is the first typed `projects` settings route; it does **not** migrate the
  rest of project-settings writes (out of scope) — only this setting.

## 7. Frontend — gate + kill the dual-read path

- `canUserSeeOthers(role, settings)`:
  `consensus → true`, `manager → settings.managers_see_reviewers`,
  `reviewer/viewer → false`. `loadComparisonPermissions` reads the live setting.
- **Remove** `ExtractionValueService.loadValuesForOthers` (direct Supabase) and
  rebuild `useOtherExtractions` (and the compare view / `OtherExtractionsPopover`
  / `ModelLevelComparison`) to derive peer values from **`runDetail`** (the typed
  `/runs/{id}/view`, already server-blinded). When a manager is blind, `runDetail`
  carries no peers → compare view hidden/empty; when revealed → it populates.
  Single read path; the dual-read is gone.
- The `findActiveRun` direct-Supabase read used only by `useOtherExtractions`
  becomes unused there — remove if no other caller needs it (verify during
  implementation).

## 8. The toggle UI

- Remove the dead "Blind mode" `Switch` from `AdvancedSettingsSection`.
- Add a control in the **extraction/consensus settings** (next to the consensus
  config): *"Show other reviewers' responses to managers"* — default off,
  `disabled` unless `canManageBlindMode` (manager). New copy keys under
  `frontend/lib/copy/consensus.ts` (English only).
- Repoint the `EyeOff` "blind" badge so it reflects the **real** manager-blind
  state (or remove it if redundant with the toggle).

## 9. Testing

**Backend (pytest, integration):**

- Manager + `managers_see_reviewers=false` → `/runs/{id}/view` returns no peers'
  human proposals/decisions (own-only), at review and consensus stages.
- Flip to `true` → peers appear for the manager.
- Reviewer → always own-only (regression guard).
- Consensus member → always sees peers regardless of the setting.
- Finalized → everyone sees peers.
- `PUT /extraction-settings`: manager 200 + persists; non-manager 403.

**Frontend (vitest):**

- `canUserSeeOthers` matrix over role × setting.
- `useOtherExtractions` derives from `runDetail` (no Supabase call) and is empty
  for a blind manager, populated when revealed.
- Settings toggle calls the typed endpoint and reflects persisted state.

**E2E (Playwright, api + ui):** manager blind by default sees no compare toggle;
after PUT reveal, compare view appears; reviewer never sees peers.

## 10. No-legacy cleanup checklist

- [ ] Remove dead `blind_mode` key (model default, Advanced switch, reads).
- [ ] Remove `loadValuesForOthers` (direct Supabase) + repoint `useOtherExtractions`.
- [ ] Stop the direct-Supabase write of the setting; use the typed endpoint.
- [ ] Disentangle "can resolve / arbitrator" from "can see peers" in the read service.
- [ ] Docs: architecture doc blind-review + RLS section; ADR for the manager-reveal model.

## 11. Risks

- **Behavior change for existing managers** (lose always-on visibility until they
  toggle) — intended, but worth a release note.
- **API-stricter-than-RLS** for the manager case — documented as deliberate;
  reviewer↔reviewer remains lockstep.
- **Compare view re-derivation** must preserve the existing per-reviewer
  grouping the consensus/compare UIs expect — covered by tests.
