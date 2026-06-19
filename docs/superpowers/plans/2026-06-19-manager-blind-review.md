---
status: draft
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Manager blind-review + per-kind reveal + shared compare view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project **managers blind to other reviewers by default**, with **two independent per-kind project toggles** (extraction / QA) to reveal peers, served by **one shared `runDetail`-driven compare view** used by both screens — retiring the dead `blind_mode` flag and the `loadValuesForOthers` direct-Supabase dual-read.

**Architecture:** Server is the source of truth: the read service blinds a manager's `proposals[]`/`decisions[]` unless the live per-kind project setting `managers_see_reviewers[run.kind]` is true (consensus always sees; reviewers always blind; finalized opens to all). The setting is written via a new typed `PUT /api/v1/projects/{id}/manager-review-visibility`. The frontend gate mirrors the rule and both screens render the same `RunReviewerComparison` derived from the already-server-blinded `runDetail`. RLS `0025` is unchanged (reviewer↔reviewer boundary); the manager-blind split is API/app-layer only.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (backend), pytest integration against local Supabase; React 19 + TanStack Query + Zustand + shadcn (frontend), vitest + Playwright. Spec: `docs/superpowers/specs/2026-06-18-manager-blind-review-design.md`.

## Global Constraints

- **Setting shape:** `projects.settings.managers_see_reviewers = {"extraction": bool, "quality_assessment": bool}`; resolve `managers_see_reviewers.get(kind, False)` → missing = blind. **No Alembic migration** (JSONB; Python-side default only).
- **`projects.settings` is plain `JSONB`, NOT `MutableDict`** — in-place mutation is NOT change-tracked and silently fails to persist. Always **reassign a brand-new dict** onto `project.settings`.
- **TemplateKind keys are exactly** `"extraction"` and `"quality_assessment"` (must match `run.kind`).
- **Layering (CI `check_layered_arch.py`):** endpoints import only from `app.services`; never import `app.models`/repositories into endpoint modules.
- **API:** `ApiResponse` envelope; typed Pydantic response models (never `ApiResponse[dict[str, Any]]`); errors expose `error.message`. Every project-scoped endpoint checks membership.
- **React Compiler `panicThreshold:'all_errors'`:** no `try/finally` or `throw`-in-`try` in component/hook bodies; IO lives in `frontend/services/` functions; services throw `ApiError` (not toast).
- **Frontend data access:** typed `apiClient` only; **no new `supabase.from(...)` reads**; TanStack keys from `runsKeys` factory; all copy via `frontend/lib/copy/`; English only; visible focus on interactive elements.
- **Lockstep:** the blind predicate exists in 4 places. KEEP `resolve_caller_current_values` (line 177) and RLS `0025` IDENTICAL (reviewer↔reviewer). The manager case INTENTIONALLY moves to the API layer only — document it (Task 9).
- **Branch:** `feat/manager-blind-review` (already created off `dev`). Commit per task; PR to `dev` at the end.

---

### Task 1: Typed per-kind setting endpoint + service + model default

**Files:**
- Modify: `backend/app/models/project.py:69-73` (settings default)
- Create: `backend/app/schemas/manager_review_visibility.py`
- Create: `backend/app/services/manager_review_visibility_service.py`
- Create: `backend/app/api/v1/endpoints/manager_review_visibility.py`
- Modify: `backend/app/api/v1/router.py` (register router)
- Test: `backend/tests/integration/test_manager_review_visibility.py`

**Interfaces:**
- Produces: `ManagerReviewVisibilityService(db).set_for_project(project_id, kind, value) -> dict[str, bool]` (returns the merged per-kind map); `PUT /api/v1/projects/{project_id}/manager-review-visibility` body `{kind, managers_see_reviewers}` → `ApiResponse[ManagerReviewVisibilityRead]` where `ManagerReviewVisibilityRead = {extraction: bool, quality_assessment: bool}`.
- Consumes: `require_project_manager` (`app/api/deps/security.py:73`), `ProjectRepository.get_by_id` (`app/repositories/project_repository.py`), `TemplateKind` literal values.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_manager_review_visibility.py
import pytest
from httpx import AsyncClient

from tests.integration.conftest import SEED  # primary_project, primary_profile (manager), outsider_profile


@pytest.mark.asyncio
async def test_put_sets_one_kind_and_persists(client_as_manager: AsyncClient):
    pid = str(SEED.primary_project)
    r = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "extraction", "managers_see_reviewers": True},
    )
    assert r.status_code == 200
    body = r.json()["data"]
    assert body == {"extraction": True, "quality_assessment": False}

    # Persisted: a SEPARATE request sees it (no in-memory illusion).
    r2 = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "quality_assessment", "managers_see_reviewers": True},
    )
    # Setting QA must NOT clobber the extraction value set above.
    assert r2.json()["data"] == {"extraction": True, "quality_assessment": True}


@pytest.mark.asyncio
async def test_put_requires_manager(client_as_reviewer: AsyncClient):
    pid = str(SEED.primary_project)
    r = await client_as_reviewer.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "extraction", "managers_see_reviewers": True},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_put_rejects_bad_kind(client_as_manager: AsyncClient):
    pid = str(SEED.primary_project)
    r = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "nonsense", "managers_see_reviewers": True},
    )
    assert r.status_code == 422
```

> Reuse the existing authed-client fixtures from `backend/tests/integration/conftest.py` (search for how `test_hitl_configs*`/other endpoint tests obtain a manager vs reviewer client; name the fixtures to match — e.g. an httpx client whose JWT sub is `SEED.primary_profile` (manager) vs `SEED.reviewer_profile`). Scope all queries by `project_id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_manager_review_visibility.py -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the schema**

```python
# backend/app/schemas/manager_review_visibility.py
from typing import Literal

from pydantic import BaseModel

# Mirror TemplateKind values WITHOUT importing app.models into the schema/endpoint
# layer (layering rule). These two literals are the JSONB keys.
ManagerReviewKind = Literal["extraction", "quality_assessment"]


class ManagerReviewVisibilityPayload(BaseModel):
    kind: ManagerReviewKind
    managers_see_reviewers: bool


class ManagerReviewVisibilityRead(BaseModel):
    extraction: bool = False
    quality_assessment: bool = False
```

- [ ] **Step 4: Add the service (reassign settings — the JSONB gotcha)**

```python
# backend/app/services/manager_review_visibility_service.py
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectRepository

_KEYS = ("extraction", "quality_assessment")


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


class ManagerReviewVisibilityService:
    """Owns the per-kind `managers_see_reviewers` map inside projects.settings."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._projects = ProjectRepository(db)

    async def set_for_project(
        self, *, project_id: UUID, kind: str, value: bool
    ) -> dict[str, bool]:
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")

        # projects.settings is plain JSONB (NOT MutableDict): build a brand-new
        # dict and REASSIGN, or the change is not tracked and never persists.
        settings = dict(project.settings or {})
        current = dict(settings.get("managers_see_reviewers") or {})
        merged = {k: bool(current.get(k, False)) for k in _KEYS}
        merged[kind] = value
        settings["managers_see_reviewers"] = merged
        settings.pop("blind_mode", None)  # retire the dead flag opportunistically
        project.settings = settings  # reassignment → dirty-tracked
        await self.db.flush()
        return merged
```

- [ ] **Step 5: Add the endpoint (mirror `hitl_configs.upsert_project_hitl_config`)**

```python
# backend/app/api/v1/endpoints/manager_review_visibility.py
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.manager_review_visibility import (
    ManagerReviewVisibilityPayload,
    ManagerReviewVisibilityRead,
)
from app.services.manager_review_visibility_service import (
    ManagerReviewVisibilityService,
    ProjectNotFoundError,
)

router = APIRouter()


@router.put("/{project_id}/manager-review-visibility")
async def set_manager_review_visibility(
    project_id: UUID,
    body: ManagerReviewVisibilityPayload,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ManagerReviewVisibilityRead]:
    trace_id = getattr(request.state, "trace_id", None)
    try:
        merged = await ManagerReviewVisibilityService(db).set_for_project(
            project_id=project_id,
            kind=body.kind,
            value=body.managers_see_reviewers,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ManagerReviewVisibilityRead(**merged), trace_id=trace_id)
```

- [ ] **Step 6: Register the router + change the model default**

In `backend/app/api/v1/router.py`, register with the projects prefix (mirror the `hitl_configs` include block — same `prefix="/projects"`, `tags=[...]`):

```python
from app.api.v1.endpoints import manager_review_visibility
api_router.include_router(
    manager_review_visibility.router, prefix="/projects", tags=["projects"]
)
```

In `backend/app/models/project.py:69-73`, change the default:

```python
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default={"managers_see_reviewers": {"extraction": False, "quality_assessment": False}},
    )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_manager_review_visibility.py -v`
Expected: all PASS (incl. persistence + non-clobber + 403 + 422).

- [ ] **Step 8: Regenerate API types + commit**

Run: `npm run generate:api-types` (the `api-contract` CI job fails if `frontend/types/api/{openapi.json,schema.d.ts}` drift).

```bash
git add backend/app/schemas/manager_review_visibility.py backend/app/services/manager_review_visibility_service.py backend/app/api/v1/endpoints/manager_review_visibility.py backend/app/api/v1/router.py backend/app/models/project.py backend/tests/integration/test_manager_review_visibility.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(blind-review): typed per-kind manager-review-visibility endpoint + setting"
```

---

### Task 2: Per-kind read-blinding in the run read service

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py` (`get_run_with_workflow_history`, `build_run_view`, new `caller_can_see_peers`)
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py:145-175` (2 call sites)
- Modify: `backend/app/api/v1/endpoints/hitl_sessions.py:83-89` (3rd call site)
- Test: `backend/tests/integration/test_run_read_manager_blind.py`

**Interfaces:**
- Produces: `caller_can_see_peers(db, *, project_id, user_id, kind) -> bool` and the changed signatures `get_run_with_workflow_history(db, run_id, *, caller_id, can_see_peers: bool)` and `build_run_view(db, run_id, *, caller_id, can_see_peers: bool)`.
- Consumes: `ManagerReviewVisibilityService` setting (read directly off `project.settings`), `ProjectMemberRepository.get_member`, `run.kind` from the loaded run / `RunSummaryResponse.kind`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_run_read_manager_blind.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.extraction_run_read_service import (
    build_run_view,
    caller_can_see_peers,
)
# Use existing helpers to seed: one REVIEW-stage run with decisions from TWO
# reviewers (reuse the pattern in tests/integration/test_run_read_blind_filter.py).


@pytest.mark.asyncio
async def test_manager_blind_by_default_then_revealed_per_kind(
    db_session: AsyncSession, seed_two_reviewer_run, set_project_setting
):
    fx = seed_two_reviewer_run  # .project_id, .run_id (kind=extraction, stage=review),
                                # .manager_id, .reviewer_a, .reviewer_b
    # Default (no setting) → manager is blind: sees only their own decisions.
    can = await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.manager_id, kind="extraction"
    )
    assert can is False
    view = await build_run_view(
        db_session, fx.run_id, caller_id=fx.manager_id, can_see_peers=can
    )
    reviewers = {d.reviewer_id for d in view.decisions}
    assert reviewers == {fx.manager_id} or reviewers == set()  # own-only

    # Reveal extraction → manager sees peers.
    await set_project_setting(fx.project_id, "extraction", True)
    can2 = await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.manager_id, kind="extraction"
    )
    assert can2 is True
    view2 = await build_run_view(
        db_session, fx.run_id, caller_id=fx.manager_id, can_see_peers=can2
    )
    assert {fx.reviewer_a, fx.reviewer_b} <= {d.reviewer_id for d in view2.decisions}


@pytest.mark.asyncio
async def test_per_kind_independence(db_session, seed_two_reviewer_run, set_project_setting):
    fx = seed_two_reviewer_run
    await set_project_setting(fx.project_id, "extraction", True)
    # QA still off → manager blind on a QA run.
    assert await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.manager_id, kind="quality_assessment"
    ) is False
    assert await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.manager_id, kind="extraction"
    ) is True


@pytest.mark.asyncio
async def test_reviewer_always_blind_consensus_always_sees(db_session, seed_two_reviewer_run, set_project_setting):
    fx = seed_two_reviewer_run
    await set_project_setting(fx.project_id, "extraction", True)  # reveal managers
    # plain reviewer: still own-only regardless of the setting
    assert await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.reviewer_a, kind="extraction"
    ) is False
    # consensus member: always sees, even with setting off
    await set_project_setting(fx.project_id, "extraction", False)
    assert await caller_can_see_peers(
        db_session, project_id=fx.project_id, user_id=fx.consensus_id, kind="extraction"
    ) is True
```

> Add the `seed_two_reviewer_run` + `set_project_setting` fixtures next to the test (or in the integration conftest), reusing `RunLifecycleService`/`ExtractionReviewService` to create a REVIEW run with two reviewers' decisions, and `ManagerReviewVisibilityService.set_for_project` for `set_project_setting`. Model `consensus_id` on a project member with role `consensus`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_run_read_manager_blind.py -v`
Expected: FAIL — `caller_can_see_peers` does not exist / `build_run_view` has no `can_see_peers` param.

- [ ] **Step 3: Add `caller_can_see_peers` (keep `is_run_arbitrator` intact)**

In `backend/app/services/extraction_run_read_service.py`, add near `is_run_arbitrator` (do NOT mutate `is_run_arbitrator` — it still serves consensus-resolution permission):

```python
from app.repositories.project_repository import ProjectRepository  # add to imports


async def caller_can_see_peers(
    db: AsyncSession, *, project_id: UUID, user_id: UUID, kind: str
) -> bool:
    """Read-blinding decision (distinct from is_run_arbitrator's resolution role).

    consensus members always see peers; reviewers/viewers never; managers see
    peers only when the project's live, per-kind setting
    ``settings.managers_see_reviewers[kind]`` is true. Finalized-stage opening is
    handled by the run-stage branch in get_run_with_workflow_history, not here.
    """
    member = await ProjectMemberRepository(db).get_member(project_id, user_id)
    if member is None:
        return False
    if member.role == ProjectMemberRole.CONSENSUS:
        return True
    if member.role == ProjectMemberRole.MANAGER:
        project = await ProjectRepository(db).get_by_id(project_id)
        settings = (project.settings if project else None) or {}
        per_kind = settings.get("managers_see_reviewers") or {}
        return bool(per_kind.get(kind, False))
    return False
```

- [ ] **Step 4: Thread `can_see_peers` through the read service**

In `get_run_with_workflow_history`, replace the `is_arbitrator: bool` parameter with `can_see_peers: bool` and rewrite line 110:

```python
    unblinded = can_see_peers or run.stage == ExtractionRunStage.FINALIZED.value
```

Mirror the rename in `build_run_view` (it just forwards the flag to `get_run_with_workflow_history`). Update the docstrings (lines 84-91) to note: "Manager blinding is enforced HERE (API/app layer) per the live per-kind setting, intentionally stricter than RLS 0025 for the manager case; reviewer↔reviewer stays lockstep with 0025 + resolve_caller_current_values." Leave `resolve_caller_current_values` and `is_run_arbitrator` unchanged.

- [ ] **Step 5: Update the three call sites**

`backend/app/api/v1/endpoints/extraction_runs.py` (get_run ~line 153, get_run_view ~line 173) — `run` is a `RunSummaryResponse` carrying `.kind` and `.project_id`:

```python
    can_see_peers = await caller_can_see_peers(
        db, project_id=run.project_id, user_id=current_user_sub, kind=run.kind
    )
    # then pass can_see_peers=can_see_peers into get_run_with_workflow_history / build_run_view
```

`backend/app/api/v1/endpoints/hitl_sessions.py:83-89` — inside the session-open path, compute `can_see_peers` from `session.kind` and pass it into `build_run_view`. **Remove the `if session.kind == TemplateKind.EXTRACTION` guard** around `build_run_view` so QA sessions also receive the (now per-kind, server-blinded) `run_view` — keying on `kind` makes QA independent. Keep the existing `is_run_arbitrator` usage only where consensus-resolution permission is genuinely needed (verify; if it was only for blinding, replace it).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_run_read_manager_blind.py tests/integration/test_run_read_blind_filter.py -v`
Expected: PASS. The existing blind-filter test may assert managers see peers by default — **update it to the new default (managers blind unless revealed)**; that assertion encoded the old behavior.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/extraction_run_read_service.py backend/app/api/v1/endpoints/extraction_runs.py backend/app/api/v1/endpoints/hitl_sessions.py backend/tests/integration/test_run_read_manager_blind.py backend/tests/integration/test_run_read_blind_filter.py
git commit -m "feat(blind-review): managers blind by default, revealed by live per-kind setting"
```

---

### Task 3: Frontend per-kind permission gate

**Files:**
- Modify: `frontend/lib/comparison/permissions.ts:14,56-64,78-112`
- Modify: `frontend/hooks/shared/useComparisonPermissions.ts:48-110`
- Modify: `frontend/services/projectSettingsService.ts:391-421`
- Modify: `frontend/types/project.ts:123-126`
- Test: `frontend/test/lib/comparison-permissions.test.ts` (migrate existing)

**Interfaces:**
- Produces: `canUserSeeOthers(role, settings, kind)`, `getRolePermissions(role, settings, kind)`, `useComparisonPermissions(projectId, userId, kind)`, `loadComparisonPermissions(projectId, userId, kind)`. `kind: 'extraction' | 'quality_assessment'`.
- Consumes: `ProjectSettings.managers_see_reviewers?: { extraction?: boolean; quality_assessment?: boolean }`.

- [ ] **Step 1: Write the failing test (migrate the matrix)**

```ts
// frontend/test/lib/comparison-permissions.test.ts  (replace old (role, boolean) calls)
import { describe, it, expect } from 'vitest';
import { canUserSeeOthers } from '@/lib/comparison/permissions';

const on = { managers_see_reviewers: { extraction: true, quality_assessment: false } };
const off = { managers_see_reviewers: { extraction: false, quality_assessment: false } };

describe('canUserSeeOthers (per-kind)', () => {
  it('manager follows the per-kind setting', () => {
    expect(canUserSeeOthers('manager', on, 'extraction')).toBe(true);
    expect(canUserSeeOthers('manager', on, 'quality_assessment')).toBe(false);
    expect(canUserSeeOthers('manager', off, 'extraction')).toBe(false);
  });
  it('consensus always sees; reviewer/viewer never', () => {
    expect(canUserSeeOthers('consensus', off, 'extraction')).toBe(true);
    expect(canUserSeeOthers('reviewer', on, 'extraction')).toBe(false);
    expect(canUserSeeOthers('viewer', on, 'extraction')).toBe(false);
  });
  it('missing map/key = blind', () => {
    expect(canUserSeeOthers('manager', {}, 'extraction')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/lib/comparison-permissions.test.ts`
Expected: FAIL (signature mismatch).

- [ ] **Step 3: Implement the per-kind gate**

`frontend/types/project.ts:123-126` — replace `blind_mode?: boolean` (keep the index signature):

```ts
export interface ProjectSettings {
  managers_see_reviewers?: { extraction?: boolean; quality_assessment?: boolean };
  [key: string]: unknown;
}
```

`frontend/lib/comparison/permissions.ts` — define a `ReviewKind = 'extraction' | 'quality_assessment'`; change `canUserSeeOthers`:

```ts
export function canUserSeeOthers(
  role: UserRole,
  settings: { managers_see_reviewers?: Partial<Record<ReviewKind, boolean>> } | null | undefined,
  kind: ReviewKind,
): boolean {
  if (role === 'consensus') return true;
  if (role === 'manager') return settings?.managers_see_reviewers?.[kind] === true;
  return false; // reviewer / viewer
}
```

Thread `settings, kind` through `getRolePermissions(role, settings, kind)` (line 82 call). Update the JSDoc (27-55) to describe the per-kind, setting-driven rule. Remove `isBlindMode` from `PermissionRules` derivation if no longer meaningful, OR keep a derived `isBlindMode = role === 'manager' && !canSeeOthers` for the badge.

`frontend/services/projectSettingsService.ts:391-421` — add a `kind` param to `loadComparisonPermissions`, read `settings.managers_see_reviewers`, and call `getRolePermissions(role, settings, kind)`.

`frontend/hooks/shared/useComparisonPermissions.ts` — add `kind` param; thread into `loadComparisonPermissions` (line 77), the `prevKey` gate (66-72), and effect deps (110). Keep the error-fallback safe (canSeeOthers:false).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/test/lib/comparison-permissions.test.ts && npm run lint && npm run typecheck`
Expected: PASS / clean. (Fix the pre-existing `(role, boolean)` call sites in this test file that now break.)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/comparison/permissions.ts frontend/hooks/shared/useComparisonPermissions.ts frontend/services/projectSettingsService.ts frontend/types/project.ts frontend/test/lib/comparison-permissions.test.ts
git commit -m "feat(blind-review): per-kind canUserSeeOthers gate driven by managers_see_reviewers"
```

---

### Task 4: Typed write service + shared `ManagerReviewVisibilityToggle`

**Files:**
- Modify: `frontend/services/projectSettingsService.ts` (add `setManagerReviewVisibility`)
- Create: `frontend/components/runs/ManagerReviewVisibilityToggle.tsx`
- Modify: `frontend/lib/copy/consensus.ts` (copy keys)
- Test: `frontend/test/components/ManagerReviewVisibilityToggle.test.tsx`

**Interfaces:**
- Produces: `setManagerReviewVisibility(projectId, kind, value): Promise<{extraction:boolean; quality_assessment:boolean}>` and `<ManagerReviewVisibilityToggle projectId kind />`.
- Consumes: `apiClient` (`@/integrations/api`), `useComparisonPermissions` (for `canManageBlindMode`), copy keys.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/components/ManagerReviewVisibilityToggle.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

const put = vi.fn().mockResolvedValue({ extraction: true, quality_assessment: false });
vi.mock('@/services/projectSettingsService', async (orig) => ({
  ...(await orig<object>()),
  setManagerReviewVisibility: (...a: unknown[]) => put(...a),
}));
// Mock useComparisonPermissions to a manager with current value false.
vi.mock('@/hooks/shared/useComparisonPermissions', () => ({
  useComparisonPermissions: () => ({ canManageBlindMode: true, isBlindMode: true, loading: false }),
}));

import { ManagerReviewVisibilityToggle } from '@/components/runs/ManagerReviewVisibilityToggle';

it('PUTs the toggled value for its kind', async () => {
  render(<ManagerReviewVisibilityToggle projectId="p1" kind="quality_assessment" currentValue={false} />);
  await userEvent.click(screen.getByRole('switch'));
  expect(put).toHaveBeenCalledWith('p1', 'quality_assessment', true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/components/ManagerReviewVisibilityToggle.test.tsx`
Expected: FAIL (module/component missing).

- [ ] **Step 3: Add the typed service write (mirror `hitlConfigService.upsertForProject`)**

```ts
// frontend/services/projectSettingsService.ts  (add near the top: import { apiClient } from '@/integrations/api')
export async function setManagerReviewVisibility(
  projectId: string,
  kind: 'extraction' | 'quality_assessment',
  value: boolean,
): Promise<{ extraction: boolean; quality_assessment: boolean }> {
  return apiClient(`/api/v1/projects/${projectId}/manager-review-visibility`, {
    method: 'PUT',
    body: { kind, managers_see_reviewers: value },
  });
}
```

- [ ] **Step 4: Add the shared toggle component**

```tsx
// frontend/components/runs/ManagerReviewVisibilityToggle.tsx
import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { setManagerReviewVisibility } from '@/services/projectSettingsService';
import { t } from '@/lib/copy';

interface Props {
  projectId: string;
  kind: 'extraction' | 'quality_assessment';
  currentValue: boolean;
  disabled?: boolean;
}

export function ManagerReviewVisibilityToggle({ projectId, kind, currentValue, disabled }: Props) {
  const [checked, setChecked] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const onToggle = (next: boolean) => {
    setChecked(next);
    setSaving(true);
    setManagerReviewVisibility(projectId, kind, next)
      .then(() => toast.success(t('consensus', 'managerVisibilitySaved')))
      .catch((e: unknown) => {
        setChecked(!next); // revert optimistic flip
        toast.error(e instanceof Error ? e.message : t('consensus', 'managerVisibilityError'));
      })
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={`mrv-${kind}`} className="text-sm">
        {t('consensus', 'managerVisibilityLabel')}
      </label>
      <Switch id={`mrv-${kind}`} checked={checked} disabled={disabled || saving} onCheckedChange={onToggle} />
    </div>
  );
}
```

Add copy keys to `frontend/lib/copy/consensus.ts`: `managerVisibilityLabel: 'Show other reviewers’ responses to managers'`, `managerVisibilityHint`, `managerVisibilitySaved`, `managerVisibilityError`.

- [ ] **Step 5: Run test + lint + typecheck**

Run: `npm run test:run -- frontend/test/components/ManagerReviewVisibilityToggle.test.tsx && npm run lint`
Expected: PASS / clean (no `try/finally` in the component — uses `.then/.catch/.finally`).

- [ ] **Step 6: Commit**

```bash
git add frontend/services/projectSettingsService.ts frontend/components/runs/ManagerReviewVisibilityToggle.tsx frontend/lib/copy/consensus.ts frontend/test/components/ManagerReviewVisibilityToggle.test.tsx
git commit -m "feat(blind-review): shared ManagerReviewVisibilityToggle + typed write"
```

---

### Task 5: Mount the extraction toggle + remove the dead `blind_mode` Switch

**Files:**
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx:7,9,34,46-51,80,88-90,115-134` (remove dead Switch)
- Modify: the extraction/consensus settings surface (`frontend/components/project/settings/ReviewConsensusSection.tsx`) to mount `<ManagerReviewVisibilityToggle kind="extraction" .../>`
- Modify: `frontend/lib/copy/consensus.ts` (remove dead `advancedCardBlind*` keys if unused elsewhere)
- Test: extend `ReviewConsensusSection` test if one exists; else a small render test.

**Interfaces:** Consumes Task 4's `ManagerReviewVisibilityToggle` + Task 3's `useComparisonPermissions` (for `canManageBlindMode` + current value).

- [ ] **Step 1:** Remove the dead blind-mode `Switch` + `handleBlindModeToggle` + now-unused `Switch`/`Label` imports + `ensureSettings`/`settings` plumbing in `AdvancedSettingsSection.tsx` (lines noted above). Run `npm run typecheck` to surface every now-unused symbol; delete them.
- [ ] **Step 2:** In `ReviewConsensusSection.tsx`, render the extraction toggle gated by `canManageBlindMode`, reading the current value from the loaded project settings:

```tsx
<ManagerReviewVisibilityToggle
  projectId={projectId}
  kind="extraction"
  currentValue={settings?.managers_see_reviewers?.extraction ?? false}
  disabled={!permissions.canManageBlindMode}
/>
```

- [ ] **Step 3:** Repoint the `EyeOff` badge — `ExtractionFullScreen.tsx:1034` passes `isBlindMode`; in `HeaderStatusBadges.tsx` the badge should reflect the real per-kind manager-blind state (manager + `!canSeeOthers`), or remove it if redundant. Remove now-dead copy keys (`advancedCardBlindTitle/Desc`, `advancedEnableBlindLabel/Hint`).
- [ ] **Step 4:** Run `npm run test:run && npm run lint && npm run typecheck`. Expected: clean.
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(blind-review): extraction manager-visibility toggle; remove dead blind_mode switch"
```

---

### Task 6: Shared `RunReviewerComparison` component

**Files:**
- Create: `frontend/components/runs/RunReviewerComparison.tsx`
- Test: `frontend/test/components/RunReviewerComparison.test.tsx`

**Interfaces:**
- Produces: `<RunReviewerComparison decisionsByCoord entityTypes instances ownValues labelById avatarById />`.
- Consumes: `ReviewerSummary.decisionsByCoord` (`Map<"instanceId::fieldId", ReviewerDecisionResponse[]>`, double-colon key), `RunViewEntityType[]` (tree with `fields`), instances (`{id, entity_type_id, parent_instance_id, label}` from page), `ownValues: Record<"instanceId_fieldId", unknown>` (single-underscore key), `labelById`/`avatarById` from `useRunReviewers`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/components/RunReviewerComparison.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RunReviewerComparison } from '@/components/runs/RunReviewerComparison';

const et = [{ id: 'e1', label: 'Source of Data', fields: [{ id: 'f1', label: 'Source' }] }] as any;
const instances = [{ id: 'i1', entity_type_id: 'e1', parent_instance_id: null, label: 'Source of Data' }];
const decisionsByCoord = new Map([
  ['i1::f1', [
    { reviewer_id: 'rA', decision: 'edit', value: { value: 'Retrospective cohort' } },
    { reviewer_id: 'rB', decision: 'edit', value: { value: 'Prospective cohort' } },
  ]],
]) as any;

it('renders one column per reviewer and the divergent values', () => {
  render(
    <RunReviewerComparison
      decisionsByCoord={decisionsByCoord}
      entityTypes={et}
      instances={instances}
      ownValues={{ i1_f1: 'Retrospective cohort' }}
      labelById={{ rA: 'Alice', rB: 'Bob' }}
      avatarById={{}}
    />,
  );
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.getByText('Bob')).toBeInTheDocument();
  expect(screen.getByText('Prospective cohort')).toBeInTheDocument();
});

it('renders empty-state when no peers (blind)', () => {
  render(
    <RunReviewerComparison
      decisionsByCoord={new Map() as any}
      entityTypes={et}
      instances={instances}
      ownValues={{}}
      labelById={{}}
      avatarById={{}}
    />,
  );
  expect(screen.getByText(/no other reviewers/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/components/RunReviewerComparison.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement the component**

Render grouped `entity_type → instance → field → [reviewer column]`. For each `(instance, field)`, build the peer columns from `decisionsByCoord.get(`${instance.id}::${field.id}`)` (double-colon), unwrapping the `{value}` envelope (mirror `useReviewerSummary`'s `unwrap`); the "you" column reads `ownValues[`${instance.id}_${field.id}`]` (single-underscore — translate keys explicitly). `reject` decisions render as a muted "rejected" chip. Use `labelById`/`avatarById` for reviewer headers. Show the empty state (copy key) when no coord has ≥1 peer column. No data fetching in the component (pure render); no `supabase`; visible focus on any interactive element. Add copy keys for the empty state + "You" header to `frontend/lib/copy/extraction.ts` (or a shared copy module both screens import).

- [ ] **Step 4: Run test + lint + typecheck.** Expected: PASS / clean.
- [ ] **Step 5: Commit**

```bash
git add frontend/components/runs/RunReviewerComparison.tsx frontend/test/components/RunReviewerComparison.test.tsx frontend/lib/copy/extraction.ts
git commit -m "feat(blind-review): shared runDetail-driven RunReviewerComparison"
```

---

### Task 7: Wire `RunReviewerComparison` into extraction; delete the old compare path + dual-read

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (feed runDetail/summary/profiles into compare; drop `useOtherExtractions`); `frontend/components/extraction/ExtractionFormPanel.tsx:13-14,24,51-55`
- Modify: `frontend/services/aiSuggestionService.ts:328` (re-point `findActiveRun` to the page `runId`)
- Modify: `frontend/components/extraction/FieldInput.tsx:33-34,~411-421` (remove per-field popover) + `FieldInput.memo.test.tsx`
- Delete: `frontend/components/extraction/ExtractionCompareView.tsx`, `frontend/components/extraction/comparison/{ExtractionComparisonView,ModelLevelComparison,index}.tsx`, `frontend/components/extraction/collaboration/{OtherExtractionsPopover,OtherExtractionsButton}.tsx`, `frontend/hooks/extraction/collaboration/{useOtherExtractions,useAllUserInstances}.ts`
- Delete (methods): `ExtractionValueService.findActiveRun` + `loadValuesForOthers` (keep the rest); remove the `OtherExtraction` type
- Test: update `frontend/test/services/extractionValueService.test.ts`, `frontend/test/services/aiSuggestionService.test.ts`, `frontend/test/hooks/useColaboracaoStaleGuard.test.tsx`, `FieldInput.memo.test.tsx`

**Interfaces:** Consumes Task 6's `RunReviewerComparison`; the page already has `runDetail`, `reviewerSummary`, `reviewerProfiles`, `instances`, `entityTypes`, `values`.

- [ ] **Step 1:** Re-point `aiSuggestionService.ts:328` off `findActiveRun(articleId, null)` — pass the resolved `runId` from the caller (the page already has `activeRunId`); thread it through `acceptSuggestion`/`rejectSuggestion` callers if not already. Run the aiSuggestionService test (update its mock).
- [ ] **Step 2:** Swap `ExtractionFormPanel` compare branch (line 53-54) to render `<RunReviewerComparison .../>` with props derived on the page from `reviewerSummary.decisionsByCoord`, `entityTypes`, `instances`, `values`, `reviewerProfiles.labelById/avatarById`. Gate the "Comparison" toggle visibility on `permissions.canSeeOthers` (already wired) — note `decisionsByCoord` is multi-reviewer only when the server unblinded the caller, so the gate and the data agree.
- [ ] **Step 3:** Delete `useOtherExtractions` usage (ExtractionFullScreen.tsx:403-409) and the `hasOtherExtractions` plumbing now sourced from it; base the compare toggle on `permissions.canSeeOthers && reviewerSummary.decisionsByCoord.size > 0`.
- [ ] **Step 4:** Remove `OtherExtractionsPopover`/`OtherExtractionsButton` from `FieldInput.tsx` (imports + the ~411-421 block) and the related copy keys at `lib/copy/extraction.ts:463`. (UX change: the inline per-field peek is replaced by the dedicated compare view — intended, no-legacy.)
- [ ] **Step 5:** Delete the files listed above. Delete `ExtractionValueService.findActiveRun` + `loadValuesForOthers` and the `OtherExtraction` type; fix every importer of the type (`SectionAccordion`, `ModelSection`, `InstanceCard`, `ExtractionFormView`, `ComparisonSectionView` — remove the now-unused prop/type). Run `npm run typecheck` repeatedly and resolve each dangling reference.
- [ ] **Step 6:** Update/trim the affected tests (extractionValueService, aiSuggestionService, useColaboracaoStaleGuard, FieldInput.memo).
- [ ] **Step 7:** `npm run test:run && npm run lint && npm run typecheck && python3 scripts/fitness/check_react_query_keys.py`. Expected: clean; **grep proves no `supabase.from(` remains** in the collaboration/compare path: `rg "supabase\.from" frontend/services frontend/hooks/extraction/collaboration` → empty.
- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(blind-review): one shared compare view; delete dual-read + dead compare components"
```

---

### Task 8: QA — view-mode + permissions + mount compare + mount QA toggle

**Files:**
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:19-51,146-156,269-291,427-513,522-609`
- Modify: `frontend/components/quality/QualityAssessmentConfiguration.tsx:109-185`
- Test: a QA render test asserting compare mode + the QA toggle mount.

**Interfaces:** Consumes Task 3 `useComparisonPermissions(projectId, userId, 'quality_assessment')`, `useCurrentUser`, Task 6 `RunReviewerComparison`, Task 4 `ManagerReviewVisibilityToggle`. QA already has `runDetail`, `reviewerSummary`, `reviewerProfiles`, `domains`, `session.instancesByEntityType`, `values`, `fieldLabelByCoord` (`::` keyed).

- [ ] **Step 1:** Add to the QA page: `const [viewMode, setViewMode] = useState<'assess'|'compare'>('assess')`; `useCurrentUser()`; `const permissions = useComparisonPermissions(projectId, userId, 'quality_assessment')`. Build `instances` from `domains` + `session.instancesByEntityType` (one per domain) in the shape `RunReviewerComparison` expects.
- [ ] **Step 2:** Add a "Comparison" toggle into the inline header JSX (near the `ReviewerProgressBadge` at 460-466), visible only when `permissions.canSeeOthers && reviewerSummary.decisionsByCoord.size > 0`.
- [ ] **Step 3:** In `formPanel` (522-609), add a branch: when `viewMode === 'compare'` (and not in consensus stage), render `<RunReviewerComparison .../>` instead of the `QASectionAccordion` list; pass `ownValues={values}` (translate `_`↔`::` as in Task 6).
- [ ] **Step 4:** In `QualityAssessmentConfiguration.tsx` CardContent, mount `<ManagerReviewVisibilityToggle projectId={projectId} kind="quality_assessment" currentValue={...} disabled={!canManageBlindMode} />` (read the current value + role via `useComparisonPermissions`/the loaded settings).
- [ ] **Step 5:** Write/run a QA render test: manager + setting off → no compare toggle / blind; setting on → compare toggle appears and `RunReviewerComparison` renders peers. `npm run test:run -- <qa test> && npm run lint && npm run typecheck`.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(blind-review): QA compare view + per-kind manager-visibility toggle"
```

---

### Task 9: Docs — architecture doc + ADR

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (blind-review + RLS §3 + the §QA/Data-extraction reuse boundary now shares the compare view; bump `last_reviewed`)
- Create: `docs/adr/0012-manager-blind-review-and-reveal.md` (MADR; frontmatter status/last_reviewed/owner) — note: 0011 is reserved by in-flight PDF-ingestion work in another worktree, so this ADR is 0012
- Modify: `.markdownlintignore` (add this plan file); ensure cspell passes on the ADR + arch doc (American spelling).

- [ ] **Step 1:** Update the architecture doc: managers blind by default (per-kind `managers_see_reviewers`), live not snapshotted; the **deliberate API-stricter-than-RLS split** for the manager case (RLS 0025 unchanged, reviewer↔reviewer lockstep intact); the compare view is now one shared `RunReviewerComparison` for both kinds.
- [ ] **Step 2:** Write ADR 0012 (decision, drivers, the per-kind + RLS-unchanged choice, consequences, validation), mirroring `0010`'s structure.
- [ ] **Step 3:** Add `docs/superpowers/plans/2026-06-19-manager-blind-review.md` to `.markdownlintignore`. Run `npx -y markdownlint-cli@0.45.0 --config .github/markdownlint.json --ignore-path .markdownlintignore docs/adr/0012-*.md docs/reference/extraction-hitl-architecture.md` + `npx -y cspell@8.17.5 --config .github/cspell.json docs/adr/0012-*.md docs/reference/extraction-hitl-architecture.md` + `bash scripts/docs/check-frontmatter.sh`. Expected: clean.
- [ ] **Step 4: Commit**

```bash
git add docs/ .markdownlintignore
git commit -m "docs(blind-review): architecture + ADR 0012 for manager blind-review"
```

---

### Task 10: E2E + final verification

**Files:**
- Create/extend: `frontend/e2e/flows/blind-review-manager.api.e2e.ts` (+ a UI assertion if feasible)

- [ ] **Step 1:** API E2E on **both** kinds: manager with setting off → `/runs/{id}/view` returns own-only decisions (blind); `PUT /manager-review-visibility {kind, true}` → `/view` returns peers; per-kind independence (extraction on, QA off → blind on a QA run); reviewer always own-only. Reuse the env-gated fixtures + `adminSelect` pattern from `extraction-value-coherence.ui.e2e.ts`.
- [ ] **Step 2:** Run the full local gate: `make test-backend`, `npm run test:run`, `npm run lint`, `npm run typecheck`, `bash scripts/fitness/run_all.sh`. Expected: green. Manually verify on the local stack (two browser profiles + a manager): manager blind on extraction by default → flip the extraction toggle → compare view shows peers; QA toggle independent.
- [ ] **Step 3: Commit + open PR**

```bash
git commit -am "test(blind-review): e2e for per-kind manager blind/reveal on extraction + QA"
git push -u origin feat/manager-blind-review
gh pr create --base dev --title "feat(blind-review): manager blind-review + per-kind reveal + shared compare view" --body "<summary + spec link>"
gh pr merge <#> --auto --squash
```

---

## Self-Review

- **Spec coverage:** §4 setting → Task 1/3; §5 server → Task 2; §6 endpoint → Task 1; §7 gate + shared compare + kill dual-read → Tasks 3/6/7; §8 two toggles → Tasks 4/5/8; §9 tests → every task + Task 10; §10 cleanup → Tasks 5/7; QA scope → Task 8; docs → Task 9. No gaps.
- **Type consistency:** `caller_can_see_peers(...)` / `can_see_peers` used consistently (Task 2); `canUserSeeOthers(role, settings, kind)` consistent (Tasks 3/7/8); coord-key formats called out explicitly (`::` peers vs `_` own) in Tasks 6/8.
- **Known risks:** JSONB-not-MutableDict persistence (Task 1 has an explicit re-read test); 3 lockstep call sites (Task 2 Step 5); `OtherExtraction` type blast radius (Task 7 Step 5 enumerates importers); existing blind-filter test asserts old default (Task 2 Step 6 updates it).
