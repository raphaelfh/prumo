---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# Architecture Clarity + Organization Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it obvious which pattern an agent should follow (canonical-home + skill router) and enforce organization with deterministic gates, without inflating always-loaded context.

**Architecture:** Keep prumo's layered agent-context model (constitution=principles, `.claude/rules/*`=always-true shapes, skills=procedures, gates=mechanically-checkable). Add a `Working principles` block + a skill router to the always-loaded CLAUDE.md, a structural `frontend-development` skill mirroring `backend-development`, and three fitness functions (frontend data-path, file-size ratchet, skill-router sync) that follow the existing `scripts/fitness/` convention.

**Tech Stack:** Markdown (CLAUDE.md, rules, skills), Python 3.11 fitness checks (stdlib only, mirroring `check_react_query_keys.py`), pytest green+canary tests.

## Global Constraints

- **English only** for all code, comments, docs, copy (constitution).
- Fitness checks: stdlib-only Python; CLI `--repo-root` + `--baseline` + `--emit-telemetry` + `--jsonl-out`; exit codes `0` (baseline matched) / `1` (new violation) / `2` (internal); default baseline path `SCRIPT_DIR / "<name>.baseline"`; wired into `scripts/fitness/run_all.sh`.
- Each fitness check ships a green-path test (`test_<check>.py`) and a canary test (`test_<check>_canary.py`) under `backend/tests/unit/scripts/`, using `Path(__file__).resolve().parents[4]` for the repo root and `--repo-root`/`--baseline` to drive synthetic trees.
- CLAUDE.md must stay under ~150 lines (Anthropic budget; currently ~89).
- `.claude/**` is markdownlint-ignored and outside the frontmatter gate; `docs/superpowers/specs/2026-*-design.md` is markdownlint-globbed; new **plan** docs need one line in `.markdownlintignore`.
- Conventional commits; PRs target `dev`, squash-merged.
- Verify backend Python via `cd backend && uv run pytest <path>`; fitness checks run with system `python3`.

---

### Task 1: CLAUDE.md — `Working principles` + skill router (+ llms.txt mirror)

**Files:**
- Modify: `CLAUDE.md` (add two sections after `## Current focus`)
- Modify: `llms.txt` (replace the ad-hoc skill mentions with a navigational skill-map mirror)

**Interfaces:**
- Produces: a `## Which skill to load` section in `CLAUDE.md` whose backticked skill names (`backend-development`, `frontend-development`, `frontend-ux`, `ui-styling`, `code-review`, `debugging`, `web-testing`, `deploy-release`, `architectural-quality-loop`, `design-review`) Task 6's router-sync check parses.

- [ ] **Step 1: Add the `Working principles` block to CLAUDE.md**

Insert immediately after the `## Current focus` section (before `## Stack`):

```markdown
## Working principles

These bias toward caution over speed. For trivial changes, use judgment.

- **Think before coding.** State assumptions; if a requirement has multiple
  readings, surface them — don't choose silently. If a simpler path exists, say
  so; push back with evidence, not deference. Genuinely unclear, or the call is
  the user's? Stop and ask — otherwise act, don't re-litigate settled choices.
  Feature/creative work starts with `superpowers:brainstorming`.
- **Simplicity first (YAGNI).** The minimum code that solves the asked problem —
  no speculative abstractions, config, or handling for impossible cases. Any
  complexity beyond what a principle prescribes must be justified (constitution
  §Governance). If 200 lines could be 50, rewrite it.
- **Surgical on unrelated code; clean in code you touch.** Change only what the
  task requires; match surrounding style; flag unrelated dead code, don't delete
  it. But where you DO edit, prefer the clean fix over grandfathering a
  violation — no new legacy left for later.
- **Goal-driven and verified.** Turn the task into a checkable goal (write the
  failing test, then make it pass). State a short plan with a verify step each.
  Evidence before "done" — run the command and read the output, never assert
  (`code-review` Iron Law; `verification-before-completion`).
```

- [ ] **Step 2: Add the skill router to CLAUDE.md**

Insert after the new `## Working principles` section:

```markdown
## Which skill to load

Load the skill before non-trivial work in its area (skills are on-demand —
naming them here is what makes them load reliably).

- Backend (FastAPI/SQLAlchemy/Alembic/Celery/RLS) → `backend-development`
- Frontend structure/data/state (components/hooks/services/stores) → `frontend-development`
- Frontend visual language (density/layout/empty states) → `frontend-ux`
- Tailwind/shadcn class mechanics → `ui-styling`
- Before "done" / PR / review → `code-review`
- Bug / failing test / weird behavior → `debugging`
- Tests (Vitest/Playwright/pytest/MSW) → `web-testing`
- Deploy / promotion / rollback → `deploy-release`
- Architectural drift sweep → `architectural-quality-loop`
- Visual feedback loop on a screen → `design-review`
```

- [ ] **Step 3: Reconcile llms.txt (remove duplication, point to the router)**

In `llms.txt`, replace the bullet under `## Then, depending on what you are touching` that reads `Frontend UI / visual changes → the frontend-ux + ui-styling skills; close the loop with design-review ...` with a single pointer to the canonical router:

```markdown
- Which skill to load for a given area → the `## Which skill to load` map in
  [CLAUDE.md](CLAUDE.md) (the always-loaded source; this index mirrors it)
```

Keep the rest of `llms.txt` unchanged (it already defers hard rules to CLAUDE.md/constitution).

- [ ] **Step 4: Verify CLAUDE.md budget + content**

Run: `awk 'END{print NR}' CLAUDE.md`
Expected: a number under 150.

Run: `grep -c '`backend-development`\|`frontend-development`\|Working principles' CLAUDE.md`
Expected: ≥ 3.

- [ ] **Step 5: Verify docs gates locally**

Run: `bash scripts/docs/check-frontmatter.sh 2>&1 | grep -i 'CLAUDE.md\|llms.txt\|MISSING\|FAIL' || echo OK`
Expected: `OK` (CLAUDE.md keeps its frontmatter; llms.txt unchanged frontmatter).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md llms.txt
git commit -m "docs(context): add Working principles + skill router to CLAUDE.md"
```

---

### Task 2: rules — explicit skill directives, repository-vs-service, frontend shapes

**Files:**
- Modify: `.claude/rules/backend.md`
- Modify: `.claude/rules/frontend.md`

**Interfaces:**
- Produces: the two non-negotiable frontend shapes (ErrorResult boundary; component→hook→service data flow) that Task 4's data-path gate enforces.

- [ ] **Step 1: Strengthen the backend rules pointer + add the repository rule**

In `.claude/rules/backend.md`, replace the opening lines:

```markdown
Deep dives live in the `backend-development` skill and
`docs/reference/` — this file is the always-true core.
```

with:

```markdown
For any non-trivial backend change, load the `backend-development` skill
before writing code (deep dives also in `docs/reference/`). This file is the
always-true core.

## Repository vs service SQL

Use a repository (`backend/app/repositories/`) when a query is reused by >1
service, or the entity has several distinct query shapes. Otherwise inline
`select()` in the owning service. Repositories call `flush()`, never `commit()`.
```

- [ ] **Step 2: Strengthen the frontend rules pointer + add the two structural shapes**

In `.claude/rules/frontend.md`, replace the opening lines:

```markdown
Visual language lives in the `frontend-ux` skill; Tailwind/shadcn
mechanics in `ui-styling`. This file is the always-true core.
```

with:

```markdown
For any non-trivial frontend change, load the `frontend-development` skill
(structure/data/state) before writing code. Visual language → `frontend-ux`;
Tailwind/shadcn mechanics → `ui-styling`. This file is the always-true core.

## Structure (CI-enforced by `scripts/fitness/check_frontend_data_path.py`)

- Data flows `component → hook (TanStack Query) → service (apiClient) →
  backend`. Components never call `fetch()` or `supabase.from(...)` directly.
- `frontend/services/*Service.ts` functions return `ErrorResult<T>`
  (`frontend/lib/error-utils.ts:toResult`); they never throw across the
  boundary and never toast.
```

- [ ] **Step 3: Verify the edits landed**

Run: `grep -c 'load the .backend-development. skill\|Repository vs service' .claude/rules/backend.md`
Expected: `2`.

Run: `grep -c 'frontend-development\|component → hook\|ErrorResult' .claude/rules/frontend.md`
Expected: ≥ 3.

- [ ] **Step 4: Commit**

```bash
git add .claude/rules/backend.md .claude/rules/frontend.md
git commit -m "docs(rules): explicit skill directives, repository rule, frontend data-flow shapes"
```

---

### Task 3: `frontend-development` skill (structural parity with backend-development)

**Files:**
- Create: `.claude/skills/frontend-development/SKILL.md`
- Create: `.claude/skills/frontend-development/references/data-and-state.md`
- Create: `.claude/skills/frontend-development/references/components-and-forms.md`

**Interfaces:**
- Produces: the skill named `frontend-development` (its dir must match the router entry from Task 1; Task 6 asserts this).

- [ ] **Step 1: Write `SKILL.md` with a non-overlapping description**

Create `.claude/skills/frontend-development/SKILL.md`. Frontmatter description must NOT overlap `frontend-ux` (visual) or `ui-styling` (Tailwind classes):

```markdown
---
name: frontend-development
description: Use when writing or modifying the STRUCTURE of anything under `frontend/` — where code lives, data flow, and state. Covers components/{domain} organization, TanStack Query hooks + key factories, `services/*Service.ts` via the typed apiClient, Zustand stores vs React Context, react-hook-form + Zod forms, generated `types/api/schema.d.ts`, ErrorResult boundaries, and the React Compiler constraints. Trigger on "add a page", "add a data hook", "add a mutation", "wire a form", "new store", "fetch data", or anything about how the frontend is organized. NOT for visual language (use `frontend-ux`) or Tailwind/shadcn class mechanics (use `ui-styling`).
---

# Frontend Development (prumo)

Structural manual for prumo's React 19 + TS + Vite frontend. This is the *how
the code is organized / how data flows* layer. Visual language is `frontend-ux`;
Tailwind/shadcn class mechanics are `ui-styling`. SKILL.md is the index — pull a
reference for depth.

## Repository layout you must respect

\`\`\`
frontend/
  pages/{PageName}.tsx          # route-level screens
  components/{domain}/*.tsx      # domain components, functional + hooks only
  hooks/{domain}/use{Name}.ts    # TanStack Query/mutation hooks
  services/{domain}Service.ts    # apiClient calls; return ErrorResult, never throw/toast
  stores/                        # Zustand stores (cross-component UI state)
  contexts/                      # React Context (app-wide singletons: Auth/Project/Sidebar)
  integrations/api/client.ts     # the ONE typed HTTP client (apiClient)
  integrations/supabase/         # auth + storage ONLY (never table reads)
  lib/copy/                      # in-house i18n; all user-facing text
  lib/query-keys/                # TanStack key factories
  types/api/schema.d.ts          # generated from FastAPI openapi — never hand-edit
\`\`\`

## Hard rules (with reasoning)

1. **One read path.** All backend data goes through `apiClient`
   (`integrations/api/client.ts`). Never `fetch()` or `supabase.from(...)` in a
   component/hook/service — the dual read path is the documented slow-load /
   status-drift / blind-leak incident class (constitution §VI; CI-enforced by
   `check_frontend_data_path.py`).
2. **Services don't throw across the boundary.** `services/*Service.ts` return
   `ErrorResult<T>` via `lib/error-utils.ts:toResult`; the hook maps the result,
   the component renders it. Services never toast.
3. **Keys come from factories.** TanStack `queryKey` comes from
   `lib/query-keys/` (CI-enforced by `check_react_query_keys.py`). Mutations
   invalidate the owning key family.
4. **Types are generated.** Import request/response shapes from
   `types/api/schema.d.ts` (`npm run generate:api-types` after a backend change).
   Never hand-mirror backend enums/models.
5. **Copy through `lib/copy/`.** Never hardcode user-facing strings.
6. **React Compiler.** No `try/finally` (or `throw` inside `try`) in
   component/hook bodies — move IO into a service returning `ErrorResult`. Last
   resort: `'use no memo'` + a `// kept:` comment.

## Data flow

`component → hook (TanStack Query) → service (apiClient) → backend`. See
[`references/data-and-state.md`](references/data-and-state.md) for the hook /
service / store / context shapes with code.

## Common workflows

| Task | Steps |
|---|---|
| Add a page | `pages/{Name}.tsx` → route in the router → data via a hook (never inline fetch) |
| Add a data hook | `hooks/{domain}/use{Name}.ts` → `useQuery` with a key-factory key → call the service |
| Add a mutation | `useMutation` in the hook → on success `invalidateQueries` the owning key family |
| Add a service call | `services/{domain}Service.ts` → `apiClient` → return `ErrorResult<T>` |
| Add a form | `react-hook-form` + `Zod` resolver; submit calls the service hook |
| Add cross-component UI state | Zustand store in `stores/`; app-wide singleton → Context |

## References index

| File | Use when |
|---|---|
| [`references/data-and-state.md`](references/data-and-state.md) | hook/service/store/context shapes, query-key factories, invalidation |
| [`references/components-and-forms.md`](references/components-and-forms.md) | component shape, react-hook-form + Zod, copy, generated types |
```

- [ ] **Step 2: Write `references/data-and-state.md`**

Create `.claude/skills/frontend-development/references/data-and-state.md` with the concrete shapes (hook with `useQuery`/`useMutation` + key factory + `invalidateQueries`; service returning `ErrorResult` via `toResult`; Zustand store; when Context instead of a store). Use real prumo names (`apiClient`, `lib/query-keys/`, `lib/error-utils.ts`). Mirror the depth of `backend-development`'s `references/sqlalchemy.md`.

- [ ] **Step 3: Write `references/components-and-forms.md`**

Create `.claude/skills/frontend-development/references/components-and-forms.md` covering the functional-component shape (shadcn primitives, focus states), `react-hook-form` + `Zod` form pattern, copy via `lib/copy/`, and importing generated types from `types/api/schema.d.ts`.

- [ ] **Step 4: Verify the skill is well-formed**

Run: `test -f .claude/skills/frontend-development/SKILL.md && head -3 .claude/skills/frontend-development/SKILL.md`
Expected: prints the frontmatter `---` and `name: frontend-development`.

Run: `grep -c 'NOT for visual language\|component → hook\|ErrorResult' .claude/skills/frontend-development/SKILL.md`
Expected: ≥ 3.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/frontend-development/
git commit -m "docs(skill): add frontend-development structural pattern manual"
```

---

### Task 4: `check_frontend_data_path` fitness gate (TDD)

**Files:**
- Create: `scripts/fitness/check_frontend_data_path.py`
- Create: `scripts/fitness/check_frontend_data_path.baseline`
- Create: `backend/tests/unit/scripts/test_check_frontend_data_path.py`
- Create: `backend/tests/unit/scripts/test_check_frontend_data_path_canary.py`
- Modify: `scripts/fitness/run_all.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/fitness/check_frontend_data_path.py` callable as `python3 check_frontend_data_path.py [--repo-root P] [--baseline P]`, exit `0/1/2`.

- [ ] **Step 1: Write the canary test (fails first)**

Create `backend/tests/unit/scripts/test_check_frontend_data_path_canary.py`:

```python
"""Canary for scripts/fitness/check_frontend_data_path.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_frontend_data_path.py"


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_root), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_supabase_from_in_component(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "components" / "x" / "Bad.tsx"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const r = await supabase.from('projects').select('*');\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "Bad.tsx" in proc.stdout


def test_fires_on_vite_api_url(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "hooks" / "useX.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const base = import.meta.env.VITE_API_URL;\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_integration_layer_is_allowed(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "integrations" / "supabase" / "client.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("export const q = () => supabase.from('x').select();\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers(tmp_path: Path) -> None:
    f = tmp_path / "frontend" / "services" / "legacyService.ts"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("const r = supabase.from('legacy').select();\n")
    baseline = tmp_path / "bl"
    baseline.write_text("frontend/services/legacyService.ts:1\n")
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_path), "--baseline", str(baseline)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
```

- [ ] **Step 2: Run the canary to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_frontend_data_path_canary.py -q`
Expected: FAIL (collection error or failures — `check_frontend_data_path.py` does not exist yet).

- [ ] **Step 3: Write the check (minimal to pass)**

Create `scripts/fitness/check_frontend_data_path.py`:

```python
#!/usr/bin/env python3
"""check_frontend_data_path.py — prumo fitness function.

Enforces the single read path (constitution §VI): all backend data flows
through the typed apiClient. Flags, OUTSIDE `frontend/integrations/`:
  - `supabase.from(` — direct table reads (auth/storage are allowed via
    supabase.auth/.storage, which this does not match)
  - `import.meta.env.VITE_API_URL` — ad-hoc base-URL wiring around the client

Regex-based (does not parse TS); a `.baseline` grandfathers residual sites.

Exit codes: 0 (baseline matched) | 1 (new violation) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

FRONTEND_ROOT = "frontend"
ALLOWED_PREFIX = "frontend/integrations/"
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "coverage", "test-results", "playwright-report"}

PATTERNS = (
    re.compile(r"\bsupabase\s*\.\s*from\s*\("),
    re.compile(r"\bimport\.meta\.env\.VITE_API_URL\b"),
)


@dataclass
class Violation:
    file: str
    line: int
    snippet: str

    def stable_id(self) -> str:
        return f"{self.file}:{self.line}"


def _walk(start: Path):
    for p in start.rglob("*"):
        if p.is_file() and p.suffix in {".ts", ".tsx"} and not any(part in SKIP_DIRS for part in p.parts):
            yield p


def scan(root: Path) -> list[Violation]:
    fe = root / FRONTEND_ROOT
    if not fe.is_dir():
        return []
    out: list[Violation] = []
    for path in sorted(_walk(fe)):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(ALLOWED_PREFIX):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if any(pat.search(line) for pat in PATTERNS):
                out.append(Violation(rel, i, line.strip()[:160]))
    return out


def load_baseline(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        ln.strip()
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo frontend single-read-path enforcement")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--baseline", default=None)
    p.add_argument("--emit-telemetry", default=None)
    p.add_argument("--jsonl-out", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    baseline_path = Path(args.baseline) if args.baseline else SCRIPT_DIR / "check_frontend_data_path.baseline"

    started = time.time()
    violations = scan(root)
    duration_ms = int((time.time() - started) * 1000)
    baseline = load_baseline(baseline_path)
    new = [v for v in violations if v.stable_id() not in baseline]
    exit_code = 1 if new else 0

    if args.jsonl_out:
        rows = [
            {
                "category": "data-path",
                "severity": "high",
                "confidence": 0.9,
                "file": v.file,
                "line": v.line,
                "evidence": v.snippet,
                "suggested_action": "Route through apiClient (frontend/integrations/api/client.ts); supabase only for auth/storage.",
                "source": "fitness:check_frontend_data_path",
            }
            for v in new
        ]
        Path(args.jsonl_out).write_text("\n".join(json.dumps(r) for r in rows) + ("\n" if rows else ""))

    if args.emit_telemetry:
        with open(args.emit_telemetry, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": "fitness",
                "gate": "check_frontend_data_path",
                "duration_ms": duration_ms,
                "exit_code": exit_code,
                "violation_count": len(violations),
                "new_violation_count": len(new),
                "baseline_size": len(baseline),
            }) + "\n")

    if new:
        print(f"check_frontend_data_path.py: FAIL ({duration_ms} ms; {len(new)} new, {len(baseline)} grandfathered)")
        print("NEW direct-data-path violations (route through apiClient):")
        for v in new[:10]:
            print(f"  {v.file}:{v.line}  {v.snippet[:100]}")
        print(f"To grandfather a known site: add 'file:line' to {baseline_path.name}.")
    else:
        print(f"check_frontend_data_path.py: OK ({duration_ms} ms; {len(violations)} found, {len(baseline)} grandfathered)")
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the canary to confirm it passes**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_frontend_data_path_canary.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Generate the baseline from the current tree**

Run: `python3 scripts/fitness/check_frontend_data_path.py --jsonl-out /tmp/fdp.jsonl; printf '%s\n' "$(python3 - <<'PY'\nimport json,sys\ntry:\n    rows=[json.loads(l) for l in open('/tmp/fdp.jsonl') if l.strip()]\nexcept FileNotFoundError:\n    rows=[]\nfor r in rows: print(f\"{r['file']}:{r['line']}\")\nPY\n)" > scripts/fitness/check_frontend_data_path.baseline`
Then prepend a header line: edit `scripts/fitness/check_frontend_data_path.baseline` to start with `# residual single-read-path violations grandfathered post-#324; shrink, don't grow`.
Expected: the file lists any current `supabase.from`/`VITE_API_URL` sites outside `frontend/integrations/` (likely few or none post-#324).

- [ ] **Step 6: Write the green-path test**

Create `backend/tests/unit/scripts/test_check_frontend_data_path.py`:

```python
"""Green-path test for scripts/fitness/check_frontend_data_path.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_frontend_data_path.py"


def test_data_path_clean_or_baseline_matched() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"new data-path violation\n{proc.stdout}"
```

- [ ] **Step 7: Run the green-path test**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_frontend_data_path.py -q`
Expected: PASS.

- [ ] **Step 8: Wire into run_all.sh**

In `scripts/fitness/run_all.sh`, add after the `check_react_query_keys.py` block:

```bash
run_check "check_frontend_data_path.py" \
  python3 "${SCRIPT_DIR}/check_frontend_data_path.py" "${SCOPE_ARGS[@]}"
```

Run: `bash scripts/fitness/run_all.sh 2>&1 | grep check_frontend_data_path`
Expected: `check_frontend_data_path.py: OK (...)`.

- [ ] **Step 9: Commit**

```bash
git add scripts/fitness/check_frontend_data_path.py scripts/fitness/check_frontend_data_path.baseline scripts/fitness/run_all.sh backend/tests/unit/scripts/test_check_frontend_data_path.py backend/tests/unit/scripts/test_check_frontend_data_path_canary.py
git commit -m "ci(fitness): enforce frontend single read path (supabase.from / VITE_API_URL)"
```

---

### Task 5: `check_file_size` ratchet (freeze drift) (TDD)

**Files:**
- Modify: `scripts/fitness/check_file_size.py`
- Create: `scripts/fitness/check_file_size.baseline`
- Create: `backend/tests/unit/scripts/test_check_file_size.py`
- Create: `backend/tests/unit/scripts/test_check_file_size_canary.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `check_file_size.py` with `--baseline P` and `--update-baseline`; exit `0` (no offender grew / no new offender), `1` otherwise.

- [ ] **Step 1: Write the canary test (fails first)**

Create `backend/tests/unit/scripts/test_check_file_size_canary.py`:

```python
"""Canary for the file-size ratchet in scripts/fitness/check_file_size.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_file_size.py"


def _mk(root: Path, rel: str, lines: int) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("x = 1\n" * lines)


def _run(root: Path, baseline: Path, max_lines: int = 50):
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(root), "--baseline", str(baseline), "--max-lines", str(max_lines)],
        capture_output=True, text=True, timeout=15,
    )


def test_new_offender_fails(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/new_god.py", 80)
    baseline = tmp_path / "bl"; baseline.write_text("")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1, proc.stdout
    assert "new_god.py" in proc.stdout


def test_baselined_growth_fails(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 90)
    baseline = tmp_path / "bl"; baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 1, proc.stdout


def test_baselined_unchanged_passes(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 80)
    baseline = tmp_path / "bl"; baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout


def test_baselined_shrink_passes(tmp_path: Path) -> None:
    _mk(tmp_path, "backend/app/god.py", 60)
    baseline = tmp_path / "bl"; baseline.write_text("backend/app/god.py:80\n")
    proc = _run(tmp_path, baseline)
    assert proc.returncode == 0, proc.stdout
```

- [ ] **Step 2: Run the canary to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_file_size_canary.py -q`
Expected: FAIL (current `check_file_size.py` ignores `--baseline`, always exits 0 → `test_new_offender_fails` and `test_baselined_growth_fails` fail).

- [ ] **Step 3: Rewrite `check_file_size.py` as a ratchet**

Replace the full contents of `scripts/fitness/check_file_size.py` with:

```python
#!/usr/bin/env python3
"""check_file_size.py — prumo fitness function (ratchet).

Freezes file-size drift: a baselined oversized file may not GROW, and no new
file may cross the soft ceiling. Shrinking is always allowed (and lets you
tighten the baseline with --update-baseline). The actual splitting of the
current god files is a separate cleanup effort.

Baseline format: one `path:max_lines` per currently-oversized file.

Usage:
  python check_file_size.py [--repo-root P] [--max-lines N] [--baseline P]
  python check_file_size.py --update-baseline   # rewrite baseline from tree

Exit codes: 0 (no growth, no new offender) | 1 (regression) | 2 (internal).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_BASELINE = SCRIPT_DIR / "check_file_size.baseline"
MAX_LINES_DEFAULT = 800

SCAN_ROOTS = ("backend/app", "frontend")
SCAN_EXTS = {".py", ".ts", ".tsx"}
SKIP_DIR_NAMES = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build", ".pytest_cache", "coverage"}
SKIP_PATH_PARTS = ("frontend/types/api/", "integrations/supabase/types.ts")


def scan(repo_root: Path, max_lines: int) -> dict[str, int]:
    offenders: dict[str, int] = {}
    for root in SCAN_ROOTS:
        base = repo_root / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SCAN_EXTS or not path.is_file():
                continue
            if any(part in SKIP_DIR_NAMES for part in path.parts):
                continue
            rel = path.relative_to(repo_root).as_posix()
            if any(skip in rel for skip in SKIP_PATH_PARTS):
                continue
            try:
                n = sum(1 for _ in path.open("rb"))
            except OSError:
                continue
            if n > max_lines:
                offenders[rel] = n
    return offenders


def load_baseline(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {}
    out: dict[str, int] = {}
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        rel, _, num = ln.rpartition(":")
        if rel and num.isdigit():
            out[rel] = int(num)
    return out


def write_baseline(path: Path, offenders: dict[str, int]) -> None:
    header = "# file-size ratchet baseline — oversized files frozen at current size.\n# May shrink (re-run --update-baseline to tighten), never grow. Cleanup is a separate effort.\n"
    body = "\n".join(f"{rel}:{n}" for rel, n in sorted(offenders.items()))
    path.write_text(header + body + ("\n" if body else ""))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--max-lines", type=int, default=MAX_LINES_DEFAULT)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--update-baseline", action="store_true")
    args = parser.parse_args()

    started = time.time()
    offenders = scan(args.repo_root.resolve(), args.max_lines)

    if args.update_baseline:
        write_baseline(args.baseline, offenders)
        print(f"file-size baseline written: {len(offenders)} oversized files -> {args.baseline}")
        return 0

    baseline = load_baseline(args.baseline)
    regressions: list[str] = []
    for rel, n in sorted(offenders.items(), key=lambda kv: -kv[1]):
        cap = baseline.get(rel)
        if cap is None:
            regressions.append(f"NEW over-ceiling file: {rel} has {n} lines (> {args.max_lines})")
        elif n > cap:
            regressions.append(f"GREW: {rel} has {n} lines (baseline cap {cap})")

    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if regressions else 0

    telemetry_out = os.environ.get("PRUMO_TELEMETRY_OUT")
    if telemetry_out:
        with open(telemetry_out, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "check": "check_file_size",
                "status": "fail" if regressions else "ok",
                "regressions": regressions,
                "offender_count": len(offenders),
                "duration_ms": duration_ms,
            }) + "\n")

    if regressions:
        print(f"check_file_size.py: FAIL ({duration_ms} ms; {len(regressions)} regression(s))")
        for r in regressions:
            print(f"  {r}")
        print(f"Shrink the file, or (only if intentional) run --update-baseline and commit {args.baseline.name}.")
    else:
        print(f"file-size: OK ({duration_ms} ms; {len(offenders)} oversized, none grew, no new offenders)")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the canary to confirm it passes**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_file_size_canary.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Generate the freeze baseline from the current tree**

Run: `python3 scripts/fitness/check_file_size.py --update-baseline`
Expected: `file-size baseline written: N oversized files -> .../check_file_size.baseline` (N includes seed.py, extraction_export_service.py, etc.).

Run: `python3 scripts/fitness/check_file_size.py; echo "exit=$?"`
Expected: `file-size: OK (...)` and `exit=0`.

- [ ] **Step 6: Write the green-path test**

Create `backend/tests/unit/scripts/test_check_file_size.py`:

```python
"""Green-path test for the file-size ratchet."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_file_size.py"


def test_current_tree_matches_baseline() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=20)
    assert proc.returncode == 0, f"a file grew past its baseline\n{proc.stdout}"
```

- [ ] **Step 7: Run the green-path test**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_file_size.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/fitness/check_file_size.py scripts/fitness/check_file_size.baseline backend/tests/unit/scripts/test_check_file_size.py backend/tests/unit/scripts/test_check_file_size_canary.py
git commit -m "ci(fitness): promote file-size from warn-only to a freeze ratchet"
```

---

### Task 6: `check_skill_router_sync` fitness gate (TDD)

**Files:**
- Create: `scripts/fitness/check_skill_router_sync.py`
- Create: `backend/tests/unit/scripts/test_check_skill_router_sync.py`
- Create: `backend/tests/unit/scripts/test_check_skill_router_sync_canary.py`
- Modify: `scripts/fitness/run_all.sh`

**Interfaces:**
- Consumes: the `## Which skill to load` section of `CLAUDE.md` (Task 1) and the dirs under `.claude/skills/` (incl. `frontend-development` from Task 3).
- Produces: a check asserting every backticked skill named in the router resolves to a real `.claude/skills/<name>/` dir (no dead entries).

- [ ] **Step 1: Write the canary test (fails first)**

Create `backend/tests/unit/scripts/test_check_skill_router_sync_canary.py`:

```python
"""Canary for scripts/fitness/check_skill_router_sync.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_skill_router_sync.py"


def _setup(root: Path, router_skills: list[str], real_skills: list[str]) -> None:
    claude = root / "CLAUDE.md"
    lines = ["# x", "", "## Which skill to load", ""]
    lines += [f"- area → `{s}`" for s in router_skills]
    claude.write_text("\n".join(lines) + "\n")
    for s in real_skills:
        (root / ".claude" / "skills" / s).mkdir(parents=True, exist_ok=True)


def _run(root: Path):
    return subprocess.run([sys.executable, str(CHECK), "--repo-root", str(root)], capture_output=True, text=True, timeout=15)


def test_dead_router_entry_fails(tmp_path: Path) -> None:
    _setup(tmp_path, router_skills=["backend-development", "ghost-skill"], real_skills=["backend-development"])
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert "ghost-skill" in proc.stdout


def test_in_sync_passes(tmp_path: Path) -> None:
    _setup(tmp_path, router_skills=["backend-development", "code-review"], real_skills=["backend-development", "code-review", "debugging"])
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout
```

- [ ] **Step 2: Run the canary to confirm it fails**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_skill_router_sync_canary.py -q`
Expected: FAIL (check does not exist yet).

- [ ] **Step 3: Write the check**

Create `scripts/fitness/check_skill_router_sync.py`:

```python
#!/usr/bin/env python3
"""check_skill_router_sync.py — prumo fitness function.

Asserts every skill named in CLAUDE.md's `## Which skill to load` router
resolves to a real `.claude/skills/<name>/` directory. A dead router entry
sends agents to a skill that does not exist; this fires the moment the router
and the skills tree drift apart.

Exit codes: 0 (no dead entries) | 1 (dead entry) | 2 (router section missing).
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

ROUTER_HEADING = "## Which skill to load"
SKILL_TICK_RE = re.compile(r"→\s*`([a-z][a-z0-9-]+)`")


def router_skills(claude_md: str) -> list[str]:
    lines = claude_md.splitlines()
    out: list[str] = []
    in_section = False
    for line in lines:
        if line.strip() == ROUTER_HEADING:
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section:
            m = SKILL_TICK_RE.search(line)
            if m:
                out.append(m.group(1))
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo skill-router sync check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--emit-telemetry", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    claude_path = root / "CLAUDE.md"
    skills_dir = root / ".claude" / "skills"

    if not claude_path.is_file():
        print(f"ERROR: CLAUDE.md not found: {claude_path}", file=sys.stderr)
        return 2

    started = time.time()
    named = router_skills(claude_path.read_text(encoding="utf-8"))
    if not named:
        print(f"ERROR: no '{ROUTER_HEADING}' router entries found in CLAUDE.md", file=sys.stderr)
        return 2

    existing = {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.is_dir() else set()
    dead = [s for s in named if s not in existing]
    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if dead else 0

    if dead:
        print(f"check_skill_router_sync.py: FAIL ({duration_ms} ms; {len(dead)} dead router entries)")
        for s in dead:
            print(f"  `{s}` in CLAUDE.md router has no .claude/skills/{s}/ dir")
    else:
        print(f"check_skill_router_sync.py: OK ({duration_ms} ms; {len(named)} router entries all resolve)")
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the canary to confirm it passes**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_skill_router_sync_canary.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the green-path test**

Create `backend/tests/unit/scripts/test_check_skill_router_sync.py`:

```python
"""Green-path test for scripts/fitness/check_skill_router_sync.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_skill_router_sync.py"


def test_router_in_sync_with_skills() -> None:
    proc = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0, f"dead router entry\n{proc.stdout}"
```

- [ ] **Step 6: Run the green-path test (validates Tasks 1+3 landed)**

Run: `cd backend && uv run pytest tests/unit/scripts/test_check_skill_router_sync.py -q`
Expected: PASS (every router skill, incl. `frontend-development`, resolves).

- [ ] **Step 7: Wire into run_all.sh**

In `scripts/fitness/run_all.sh`, add after the `check_frontend_data_path.py` block:

```bash
run_check "check_skill_router_sync.py" \
  python3 "${SCRIPT_DIR}/check_skill_router_sync.py"
```

Run: `bash scripts/fitness/run_all.sh 2>&1 | grep check_skill_router_sync`
Expected: `check_skill_router_sync.py: OK (...)`.

- [ ] **Step 8: Commit**

```bash
git add scripts/fitness/check_skill_router_sync.py scripts/fitness/run_all.sh backend/tests/unit/scripts/test_check_skill_router_sync.py backend/tests/unit/scripts/test_check_skill_router_sync_canary.py
git commit -m "ci(fitness): keep the CLAUDE.md skill router in sync with .claude/skills/"
```

---

### Task 7: De-dup verification + full-gate green

**Files:**
- Modify: `.markdownlintignore` (add this plan)
- Modify (only if the audit finds duplication): `CLAUDE.md`, `.claude/rules/*`

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Add this plan to `.markdownlintignore`**

Append to `.markdownlintignore` (under the "Active in-flight plans" group):

```
docs/superpowers/plans/2026-06-22-architecture-clarity.md
```

- [ ] **Step 2: De-dup audit — no prose duplicates a gate**

Run: `grep -rn 'ruff format\|ruff check' CLAUDE.md .claude/rules/ | grep -iv 'command\|make lint'`
Expected: no rule that *instructs running* ruff as a behavioral rule (the PostToolUse hook + CI own it). If any prose rule says "always run ruff format", delete it (the `make lint-backend` command reference in `## Commands` is fine — it documents the command, not a rule).

Run: `grep -rn 'check_layered_arch\|check_react_query_keys\|check_frontend_data_path' .claude/rules/`
Expected: rules reference each gate by name (point to it) rather than restating its logic — confirm, no edits needed.

- [ ] **Step 3: De-dup audit — single source per fact**

Run: `grep -rin 'English only\|ApiResponse envelope\|error.message' CLAUDE.md docs/reference/constitution.md .claude/rules/backend.md`
Expected: each fact appears as a terse shape in CLAUDE.md/rules AND as the deep principle in the constitution — that layering is intended. Confirm there is no *verbatim* paragraph duplicated across two files; if found, keep the rules/CLAUDE.md terse version and let the constitution hold the full one.

- [ ] **Step 4: Run the full fitness suite**

Run: `bash scripts/fitness/run_all.sh`
Expected: Summary shows OK for all checks, including `check_frontend_data_path.py`, `check_file_size.py`, `check_skill_router_sync.py`. Final exit 0.

- [ ] **Step 5: Run the fitness unit tests**

Run: `cd backend && uv run pytest tests/unit/scripts/ -q`
Expected: all pass (existing + the 6 new test files).

- [ ] **Step 6: Run the full quality gate**

Run: `make quality-scan`
Expected: lint + typecheck + tests + architectural fitness all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(context): de-dup audit + register plan in markdownlintignore"
```

---

## Self-Review

- **Spec coverage:** WS1 → Tasks 1, 2, 7 (Working principles, router, rules directives, repository rule, de-dup). WS2 → Task 3 (`frontend-development` skill + rules shapes in Task 2). WS3 → Tasks 4, 5, 6 (data-path gate, file-size ratchet, router-sync). Out-of-scope drift cleanup correctly excluded (Task 5 freezes only). All spec acceptance criteria map to a task.
- **Deviation from spec:** the router-sync check enforces "no dead router entries" (router ⊆ skills) rather than a strict bijection — a bijection would break CI whenever a non-routed process skill is added. Documented in Task 6.
- **Type/name consistency:** check filenames, baseline filenames, and CLI flags (`--repo-root`, `--baseline`, `--update-baseline`, `--max-lines`) are consistent across the checks, their tests, and `run_all.sh` wiring. `frontend-development` is spelled identically in the router (Task 1), the skill dir (Task 3), and the router-sync green test (Task 6).
- **Placeholders:** none — every check, baseline-generation step, and test has complete code; the two skill `references/*.md` (Task 3 steps 2–3) specify exact content + the existing file to mirror, not a TODO.
