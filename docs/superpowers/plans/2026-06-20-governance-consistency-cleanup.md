---
status: draft
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Governance & Context-Consistency Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent-facing knowledge corpus self-consistent with
code/CI/git and cheaper to maintain — resolving the 41 findings in
[the audit spec](../specs/2026-06-20-governance-consistency-cleanup-design.md)
so each governance fact lives in one authoritative place and the conventions the
corpus declares are CI-enforced.

**Architecture:** Almost entirely documentation edits (constitution, deployment,
root indices, plans/specs frontmatter, memory) plus **one** behaviour-correct
frontend fix (`apiKeysService.ts`) and **two** small CI-gate additions
(`check-frontmatter.sh` status/owner checks; a `.markdownlintignore` resolve
assertion). Source of truth after the cleanup: `ci.yml` for gates, the running
Railway env for deploy values, `backend/app/**` for contracts, `git`/HEAD for
lifecycle, `CLAUDE.md` for rules, `docs/README.md` for the doc index.

**Tech Stack:** Markdown + YAML frontmatter, Bash (`scripts/docs/*.sh`),
TypeScript + Vitest (`npm run test:run`), `git`, `gh`.

## Global Constraints

- **English only** for code, comments, commits, docs, copy (CLAUDE.md:66). The
  one sanctioned exception this plan creates is a frozen-spec verbatim-quote
  carve-out (Task 14) — ratify first.
- **Conventional commits** (`feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`).
  These changes are overwhelmingly `docs:` and `chore:`; the frontend fix is
  `fix:`; CI-script changes are `ci:`/`chore:`.
- **PRs target `dev`, squash-merged.** Branch from `dev` (do not commit on
  `dev`/`main`). This whole plan can ship as one PR or one PR per workstream.
- **Frontend services must route through the typed client**
  (`frontend/integrations/api/client.ts`) and never call `fetch()` directly
  (.claude/rules/frontend.md). Task 5 honors this directionally with a minimal
  fix; the full client migration is explicitly out of scope (it belongs to the
  in-progress data-path consolidation).
- **docs-ci must stay green:** every edited `docs/**`/root `*.md` keeps valid
  frontmatter (`status`/`last_reviewed`/`owner`); `make` not required, but run
  `bash scripts/docs/check-frontmatter.sh` after frontmatter edits.
- **Read-only on the audit itself:** this plan *executes* fixes; it does not
  re-run the audit.

## Prerequisites — ratification gate (do FIRST)

The five §7 open questions were **RATIFIED 2026-06-20** toward the more
SOTA-aligned option in every case (context-engineering: one authoritative source,
minimal agent read-surface, no legacy on the active surface).

| # | Question | **RATIFIED 2026-06-20 (SOTA)** | Tasks |
| --- | --- | --- | --- |
| Q1 | Status taxonomy + re-status vs archive | Per-layer enum **kept on MADR for ADRs**; **ARCHIVE** shipped plans/specs out of the agent read-path (not re-status in place) | 5, 7, 14, 15 |
| Q2 | `deployment.md` config | **Stop documenting env *values*** — document the contract + point at Railway; add a boot-time env-contract check (live-CORS check is a separate operational TODO) | 2, 2b |
| Q3 | Frozen-doc / legacy | **No legacy on the active surface** — extract durable rationale to `docs/explanation/`, ARCHIVE the historical spec, repoint CLAUDE.md to the canonical reference doc | 17 |
| Q4 | `llms.txt` frontmatter | Add frontmatter **and** widen the gate glob to include `llms.txt` | 8, 18 |
| Q5 | Memory ownership | **DONE 2026-06-20** — agent applied the SOTA consolidation (5 dead pointers, 2 dedups, 1 stale-claim fix); only the in-repo arch-doc fix remains | 19 |

### Ratified amendments to the task bodies (these override the task defaults below)

- **Q1 → ARCHIVE (Tasks 5, 7, 14, 15):** instead of re-statusing shipped
  plans/specs in place, `git mv` each into
  `docs/superpowers/plans/archive/2026-06-20-governance-sweep/` (plans) or the
  matching `specs/archive/` dir, set the moved file's status to
  `shipped`/`superseded`, and drop its now-redundant `.markdownlintignore` entry
  (archives are already glob-ignored). `docs/README.md` then lists only the
  genuinely-active specs/plans. *Why:* every shipped doc an agent globs into
  context is pollution + token cost; Git preserves the history.
- **Q2 → CONTRACT NOT VALUES (Task 2 + new Task 2b):** beyond the critical
  `LINEAR_TEAM_ID` fix, REMOVE env *values* (team UUID, CORS origin, …) from the
  `deployment.md` tables; document each variable's *contract* (name + semantics)
  and name the Railway dashboard as the source of truth. New **Task 2b**: add a
  Pydantic-settings boot validator that fails fast on a missing/malformed
  required origin or team id (same fail-fast philosophy as the existing
  `check_pending_migrations()` startup gate). The live-CORS question becomes an
  operational check, not a doc value.
- **Q3 → NO LEGACY (Task 17):** do not leave an annotated-but-broken frozen spec
  on the active surface. Extract its durable design rationale into a new
  `docs/explanation/extraction-hitl-design-rationale.md` (Diátaxis explanation
  quadrant), `git mv` the 2026-04-27 spec into `specs/archive/`, and repoint the
  CLAUDE.md "Immutable design spec" line to the canonical
  `extraction-hitl-architecture.md` (+ the new explanation doc). Translate any
  verbatim quote that survives into the explanation doc (English-only holds on
  the active surface; the archived original keeps the source language).
- **Q4 → as written (Tasks 8, 18).**
- **Q5 → DONE:** Task 19's memory half is complete (applied 2026-06-20). Only the
  in-repo arch-doc ConsensusRule fix (E6) remains — see Task 19 Step 1.

- [ ] **Step 0: Branch from `dev`**

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/intelligent-neumann-7cafa8 switch -c chore/governance-consistency-cleanup
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/intelligent-neumann-7cafa8 branch --show-current   # expect: chore/governance-consistency-cleanup
```

> All paths below are repo-relative to the worktree root
> `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/intelligent-neumann-7cafa8`.
> Subagents default to the main checkout — pin every command with that root.

---

## Workstream 1 — Re-ratify constitution & reference docs against CI

### Task 1: Fix the constitution's stale CI facts (A1, A1b)

**Files:**
- Modify: `docs/reference/constitution.md:187` and `docs/reference/constitution.md:182-192`

**Interfaces:**
- Consumes: ci.yml as source of truth for gates.
- Produces: a constitution whose CI section no longer contradicts ci.yml or its
  own tooling table (line 160).

- [ ] **Step 1: Verify the contradiction exists**

```bash
grep -n 'cov-fail-under=70' docs/reference/constitution.md
grep -n 'cov-fail-under' .github/workflows/ci.yml
```
Expected: constitution line 187 shows `=70`; ci.yml shows `=62`.

- [ ] **Step 2: Fix the coverage number (A1)**

In `docs/reference/constitution.md:187`, replace the line:
```markdown
2. **backend-test**: PostgreSQL 15 + migrations applied → `pytest --cov-fail-under=70`.
```
with:
```markdown
2. **backend-test**: PostgreSQL 15 + migrations applied → `pytest` with the ratcheted coverage gates (62% global / 80% diff / 85% critical-path — see `ci.yml`, the authoritative source for gate numbers).
```

- [ ] **Step 3: Replace the 5-job enumeration with a pointer (A1b)**

In `docs/reference/constitution.md:182-192`, replace the "Every push/PR …" list
and its `1.`–`5.` items with:
```markdown
Every push/PR to `main` or `dev` MUST pass the full CI gate defined in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). That workflow is
the authoritative, complete list of jobs (backend lint/tests/E2E/build,
**architectural fitness**, diff- and critical-path coverage, frontend
lint/tests/E2E/build, and the API-contract drift gate). No merge is permitted
when any required gate fails.
```

- [ ] **Step 4: Bump the amendment metadata**

In `docs/reference/constitution.md`, update the frontmatter `last_reviewed` to
`2026-06-20` and the visible status line if present; append a one-line note to
the §Governance amendment block (line 234+): `> 2.1.1: CI-Pipeline section
re-pointed to ci.yml (was a stale 5-job/70% snapshot).` and set
`**Last Amended**: 2026-06-20`.

- [ ] **Step 5: Verify and gate**

```bash
grep -n 'cov-fail-under=70' docs/reference/constitution.md   # expect: no output
bash scripts/docs/check-frontmatter.sh                       # expect: passed
```

- [ ] **Step 6: Commit**

```bash
git add docs/reference/constitution.md
git commit -m "docs(constitution): re-point CI section to ci.yml (fix stale 70% gate + 5-job list)"
```

### Task 2: Fix `deployment.md` env values — critical Linear UUID + CORS (A2, A2c)

**Files:**
- Modify: `docs/reference/deployment.md:113` (LINEAR_TEAM_ID), `docs/reference/deployment.md:104` (CORS)

**Interfaces:**
- Consumes: live Railway worker env (LINEAR_TEAM_ID=`23d83039-…`, key FEE) and
  the implemented `linear-integration-design.md:37`.

- [ ] **Step 1: Verify the wrong UUID**

```bash
grep -n 'LINEAR_TEAM_ID' docs/reference/deployment.md
grep -n '23d83039\|9b86c9ed' docs/superpowers/specs/2026-05-30-linear-integration-design.md
```
Expected: deployment.md:113 shows the **Prumo** UUID `9b86c9ed-…`; the
implemented spec shows the **Feedback** UUID `23d83039-…`.

- [ ] **Step 2: Fix LINEAR_TEAM_ID (A2 — critical)**

Replace `docs/reference/deployment.md:113`:
```markdown
| `LINEAR_TEAM_ID` | Linear team id for the Prumo team (`9b86c9ed-ede9-4f36-99d1-c2f53fb82370`) | `web`, `worker` |
```
with:
```markdown
| `LINEAR_TEAM_ID` | Linear **Feedback** team id (`23d83039-4f9a-444f-905a-9a4cb9fea2b6`, key `FEE`) — in-app feedback routes here; the Prumo team (`9b86c9ed-…`) is GitHub-sync/automation only. Must be the UUID, not the `FEE` slug. | `web`, `worker` |
```

- [ ] **Step 3: Confirm the live CORS value before editing (A2c — Q2 gate)**

```bash
# Read the running web service env; do NOT edit the doc to a value the live
# allow-list lacks. If railway CLI is unavailable, ask the owner to confirm.
railway variables --service web 2>/dev/null | grep -i CORS_ORIGINS || echo "CONFIRM CORS_ORIGINS WITH OWNER"
```

- [ ] **Step 4: Fix CORS origin (A2c) — only if confirmed drift**

If the live allow-list uses `prumoai.vercel.app`, replace
`docs/reference/deployment.md:104`:
```markdown
| `web` | `CORS_ORIGINS` | `https://prumo-alpha.vercel.app` |
```
with:
```markdown
| `web` | `CORS_ORIGINS` | `https://prumoai.vercel.app` (live prod frontend; was `prumo-alpha`) |
```
If the live allow-list genuinely lacks `prumoai`, STOP — that is a real prod
bug, not doc drift; file it separately and leave the doc with a `<!-- TODO:
verify against Railway -->` note.

- [ ] **Step 5: Bump `last_reviewed` to 2026-06-20, verify, commit**

```bash
grep -n '9b86c9ed' docs/reference/deployment.md   # expect: only in the parenthetical context, not as the value
bash scripts/docs/check-frontmatter.sh
git add docs/reference/deployment.md
git commit -m "docs(deployment): fix LINEAR_TEAM_ID to Feedback team + correct prod CORS origin"
```

### Task 3: Fix the API-envelope skill sketch + de-numericize test-strategy (A3b, A4)

**Files:**
- Modify: `.claude/skills/code-review/references/api-envelope.md:7-13`
- Modify: `docs/reference/test-strategy.md:224` (and `:44` if present)

**Interfaces:**
- Consumes: `backend/app/schemas/common.py:79-92` (real `ApiResponse` shape).

- [ ] **Step 1: Verify both drifts**

```bash
sed -n '7,13p' .claude/skills/code-review/references/api-envelope.md
grep -n '488 passed' docs/reference/test-strategy.md
grep -n '1860 passed' docs/adr/0009-extraction-finalize-completeness-gate.md
```
Expected: api-envelope sketch shows `meta`/missing `ok`; test-strategy shows the
stale `488 passed / 31 skipped`.

- [ ] **Step 2: Correct the envelope sketch (A3b)**

In `.claude/skills/code-review/references/api-envelope.md:7-13`, replace the
JSON sketch with the real shape:
```json
{
  "ok": true,
  "data": <payload> | null,
  "error": null | { "code": "string", "message": "string", "details": {...} | null },
  "trace_id": "string"
}
```
(Remove the invented `meta`; pagination lives inside `data` via
`PaginatedResponse`, not a top-level `meta`.)

- [ ] **Step 3: De-numericize the suite count (A4)**

In `docs/reference/test-strategy.md`, replace every hard-coded
`488 passed / 31 skipped` (line 224, and line 44 if the grep found it) with
`the full backend suite via \`make test-backend\` (counts are point-in-time —
CI output is authoritative)`. Bump `last_reviewed` to `2026-06-20`.

- [ ] **Step 4: Verify and commit**

```bash
grep -n '488 passed' docs/reference/test-strategy.md   # expect: no output
grep -n '"meta"' .claude/skills/code-review/references/api-envelope.md   # expect: no output
bash scripts/docs/check-frontmatter.sh
git add .claude/skills/code-review/references/api-envelope.md docs/reference/test-strategy.md
git commit -m "docs: correct API-envelope sketch (ok/trace_id, drop meta) + de-numericize test suite count"
```

---

## Workstream 2 — Fix the frontend error-envelope violation

### Task 4: Make `apiKeysService` read `error.message`, not `detail` (A3)

**Files:**
- Modify: `frontend/services/apiKeysService.ts:102,130,151,175`
- Test: `frontend/services/apiKeysService.test.ts` (create)

**Interfaces:**
- Consumes: the live envelope — a 4xx body is
  `{ ok: false, error: { code, message }, trace_id }` with **no** top-level
  `detail` (`backend/app/core/error_handler.py:233-243`).
- Produces: `createKey`/`updateKey`/`deleteKey`/`validateKey` surface
  `error.message` on failure.

- [ ] **Step 1: Write the failing test**

Create `frontend/services/apiKeysService.test.ts`:
```ts
import {afterEach, describe, expect, it, vi} from 'vitest';
import {apiKeysService} from './apiKeysService';

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('apiKeysService error envelope', () => {
  it('createKey surfaces error.message from the envelope (not detail)', async () => {
    mockFetchOnce(400, {ok: false, error: {code: 'bad_request', message: 'Provider already configured'}, trace_id: 't1'});
    await expect(apiKeysService.createKey('tok', {provider: 'openai', apiKey: 'sk-x'}))
      .rejects.toThrow('Provider already configured');
  });

  it('deleteKey surfaces error.message on 404', async () => {
    mockFetchOnce(404, {ok: false, error: {code: 'not_found', message: 'API key not found'}, trace_id: 't2'});
    await expect(apiKeysService.deleteKey('tok', 'missing-id'))
      .rejects.toThrow('API key not found');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from repo root): `npm run test:run -- apiKeysService`
Expected: FAIL — current code throws the generic `Error creating API key: 400`
string because it reads `errorData.detail` (undefined).

- [ ] **Step 3: Replace the four `detail` reads**

In `frontend/services/apiKeysService.ts`, change each of lines 102, 130, 151,
175 from `errorData.detail` to `errorData.error?.message`. Concretely, line 102:
```ts
        throw new Error(errorData.error?.message || `Error creating API key: ${response.status}`);
```
line 130:
```ts
        throw new Error(errorData.error?.message || `Error updating API key: ${response.status}`);
```
line 151:
```ts
        throw new Error(errorData.error?.message || `Error deleting API key: ${response.status}`);
```
line 175:
```ts
        throw new Error(errorData.error?.message || `Error validating API key: ${response.status}`);
```

- [ ] **Step 4: Run the tests + typecheck**

```bash
npm run test:run -- apiKeysService   # expect: PASS
npm run typecheck                    # expect: 0 errors
```

- [ ] **Step 5: Commit**

```bash
git add frontend/services/apiKeysService.ts frontend/services/apiKeysService.test.ts
git commit -m "fix(api-keys): read error.message from the envelope instead of FastAPI detail"
```

> Follow-up (out of scope, note in PR): `apiKeysService` still uses raw `fetch`
> + `import.meta.env.VITE_API_URL`, violating the typed-client rule
> (.claude/rules/frontend.md). Full migration belongs to the data-path
> consolidation, not this cleanup.

---

## Workstream 3 — Define & enforce one canonical doc status vocabulary

### Task 5: Re-author the status enum as per-layer subsets (A5) — Q1 gate

**Files:**
- Modify: `docs/README.md:70` (and the surrounding "Doc conventions" block)

**Interfaces:**
- Produces: the canonical, layered status taxonomy that Task 6 enforces.

- [ ] **Step 1: Confirm the current single-enum line**

```bash
sed -n '67,73p' docs/README.md
```
Expected: line 70 declares the flat 6-value enum.

- [ ] **Step 2: Replace the single enum with per-layer subsets**

Replace `docs/README.md:70` with:
```markdown
- Status values are scoped by layer (enforced by `scripts/docs/check-frontmatter.sh`):
  - **Reference / how-to** (`docs/reference`, `docs/how-to`, `docs/README.md`, `docs/ROADMAP.md`): `stable` · `draft` · `deprecated`.
  - **ADRs** (`docs/adr`, MADR lifecycle — see [0001](./adr/0001-use-madr.md)): `proposed` · `accepted` · `rejected` · `deprecated` · `superseded` · `template`.
  - **Specs / plans** (`docs/superpowers/{specs,plans}`): `draft` · `approved` · `in_progress` · `implemented` · `shipped` · `superseded` · `frozen`.
```
> Decision (Q1): keep `deprecated` (valid MADR/reference terminal state);
> `in_progress` uses the underscore form everywhere; `completed`/`ready`/
> `planned`/`paused`/`cancelled` are NOT in the active set — map them at
> normalization time (Task 7): `completed`→`shipped`, `ready`/`planned`→`draft`,
> `in-progress`→`in_progress`.

- [ ] **Step 3: Verify, gate, commit**

```bash
bash scripts/docs/check-frontmatter.sh   # still passes (value check not added yet)
git add docs/README.md
git commit -m "docs(index): replace flat status enum with per-layer status subsets"
```

### Task 6: Enforce the status enum + owner format in CI (A5, A5b, G3)

**Files:**
- Modify: `scripts/docs/check-frontmatter.sh`

**Interfaces:**
- Consumes: the layered enum from Task 5.
- Produces: a gate that fails on out-of-enum status or non-`@` owner.

> **Sequencing:** run Task 7 (normalize all frontmatter) BEFORE flipping this
> check to hard-fail, or existing files break CI. Land this task's code but keep
> it green by first normalizing.

- [ ] **Step 1: Add value + owner checks to the script**

In `scripts/docs/check-frontmatter.sh`, after the `REQUIRED_KEYS` loop
(after line 34, inside the `while` body), insert:
```bash
  # --- value checks (added 2026-06-20) ---
  fm() { awk '/^---$/{c++; next} c==1' "$file"; }
  status_val="$(fm | sed -n 's/^status:[[:space:]]*//p' | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')"
  owner_val="$(fm | sed -n 's/^owner:[[:space:]]*//p' | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')"

  case "$file" in
    docs/adr/*.md)                         allowed="proposed accepted rejected deprecated superseded template" ;;
    docs/superpowers/specs/*|docs/superpowers/plans/*) allowed="draft approved in_progress implemented shipped superseded frozen" ;;
    *)                                     allowed="stable draft deprecated" ;;
  esac
  if [[ -n "$status_val" ]] && ! grep -qw -- "$status_val" <<<"$allowed"; then
    echo "BAD status '${status_val}' (allowed: ${allowed}): $file"
    FAIL=1
  fi
  # owner must be an @-handle (optionally quoted)
  if [[ -n "$owner_val" ]] && [[ ! "$owner_val" =~ ^\'?@[A-Za-z0-9_-]+\'?$ ]]; then
    echo "BAD owner '${owner_val}' (want '@handle'): $file"
    FAIL=1
  fi
```

- [ ] **Step 2: Run it — expect failures listing every out-of-enum file**

```bash
bash scripts/docs/check-frontmatter.sh || true
```
Expected: prints `BAD status …` for the ~26 out-of-enum files and `BAD owner …`
for `dev-workflow-sota.md`. This is the worklist for Task 7.

- [ ] **Step 3: Commit the gate (still flips green after Task 7)**

```bash
git add scripts/docs/check-frontmatter.sh
git commit -m "ci(docs): enforce per-layer status enum + @owner format in check-frontmatter"
```

---

## Workstream 4 — Re-status / archive shipped plans & specs

### Task 7: Normalize all out-of-enum + shipped frontmatter (A5b, G3, B3–B12) — Q1 gate

**Files (modify line 2 `status:` unless noted):**
- `docs/superpowers/plans/2026-06-08-runopen-slowload-phase2-runview.md` → `shipped` (B3)
- `docs/superpowers/plans/2026-06-11-react-compiler-enablement.md` → `shipped` (B4)
- `docs/superpowers/plans/2026-06-11-react-compiler-zero-bailouts.md` → `shipped` (B5)
- `docs/superpowers/plans/2026-06-11-extraction-llm-stack-migration.md` → `shipped` (B6)
- `docs/superpowers/plans/2026-06-19-manager-blind-review.md` → `shipped` (B7)
- `docs/superpowers/plans/2026-06-19-blind-review-cleanup.md` → `shipped` (B7)
- `docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md` → `shipped` (B8; also fix team in Task 9)
- `docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md` → `shipped` (B9)
- `docs/superpowers/plans/2026-06-14-publication-ready-xlsx-export.md` → `shipped` (B10)
- `docs/superpowers/plans/2026-05-30-run-user-facing-vocabulary.md` → `shipped` (B11)
- `docs/superpowers/plans/2026-06-19-extraction-data-path-finish.md` → already `completed`, set `shipped`
- `docs/superpowers/plans/2026-06-18-extraction-review-stage-restore.md` → `implemented` (in-enum; leave)
- `docs/superpowers/specs/2026-05-24-test-infra-hardening-design.md` → `shipped` + fix body banner (B12)
- Specs `approved`/`implemented`/`shipped`/`frozen`/`in_progress` are in-enum — leave.
- Plans `2026-06-19-grounded-extraction-and-hitl-highlight.md` (`planned`→`draft`) and `2026-06-19-structured-pdf-parsing-at-ingest.md` (`planned`→`draft`): genuinely unshipped → map to `draft`.

**Interfaces:** Consumes the Task-6 worklist; produces a tree where
`check-frontmatter.sh` passes clean.

- [ ] **Step 1: Snapshot the worklist**

```bash
bash scripts/docs/check-frontmatter.sh 2>&1 | grep '^BAD' | tee /tmp/frontmatter-worklist.txt
```

- [ ] **Step 2: Re-status the shipped plans (verified in HEAD)**

For each plan above mapped to `shipped`, edit line 2 `status: <old>` →
`status: shipped`. Confirm each PR is in HEAD first:
```bash
for sha in a991ed4 c281ce3 29e786e aa71e6b f9af2de 25922fc 8b0b480 a73e3df 8e1ab09; do
  git merge-base --is-ancestor "$sha" HEAD && echo "$sha IN HEAD" || echo "$sha MISSING"
done
```
Expected: all IN HEAD (these back B3–B11).

- [ ] **Step 3: Map the genuinely-unshipped values**

`grounded-extraction-and-hitl-highlight.md:2` and
`structured-pdf-parsing-at-ingest.md:2`: `status: planned` → `status: draft`.
`extraction-data-path-finish.md:2`: `status: completed` → `status: shipped`.

- [ ] **Step 4: Fix the test-infra spec two-line mismatch (B12, A5b)**

In `docs/superpowers/specs/2026-05-24-test-infra-hardening-design.md`: line 2
`status: in-progress` → `status: shipped`; reconcile the body status banner
(line ~10 "Draft") to "Shipped (Layers 1–2; Layer 3/xdist out of scope)".

- [ ] **Step 5: Fix the bare owner (G3)**

In `docs/superpowers/plans/2026-06-10-dev-workflow-sota.md:4`:
`owner: raphaelfh` → `owner: '@raphaelfh'`.

- [ ] **Step 6: Bump `last_reviewed: 2026-06-20` on every file touched, then gate**

```bash
bash scripts/docs/check-frontmatter.sh   # expect: passed (no BAD lines)
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers
git commit -m "docs(plans): re-status shipped plans/specs + normalize status enum & owner format"
```

### Task 8: Verify-then-status the two medium-confidence plans (B2, B13)

**Files:**
- `docs/superpowers/plans/2026-06-08-runopen-slowload-phase1.md`
- `docs/superpowers/plans/2026-05-24-integration-test-pollution-cleanup.md`

- [ ] **Step 1: B2 — confirm Phase-1 intent shipped via PR bodies**

```bash
gh pr view 224 --json title,state,mergedAt 2>/dev/null || git log --oneline --grep='slow-load dedup'
```
If the dedup intent is confirmed merged (#224 + #324), set
`runopen-slowload-phase1.md:2` `status: in_progress` → `status: shipped`; else
leave and refresh `last_reviewed` with a note.

- [ ] **Step 2: B13 — confirm SAVEPOINT closed the residual pollution**

```bash
# Does the SAVEPOINT db_session escape-hatch exist (proxy that the pollution class is gone)?
grep -n 'db_session_real\|SAVEPOINT\|savepoint' backend/tests/conftest.py | head
```
If present and the pollution plan's residual is structurally resolved, set
`integration-test-pollution-cleanup.md:2` → `status: superseded` and add a body
line cross-linking the test-infra-hardening spec; else refresh `last_reviewed`.

- [ ] **Step 3: Gate + commit**

```bash
bash scripts/docs/check-frontmatter.sh
git add docs/superpowers/plans
git commit -m "docs(plans): re-status runopen-phase1 + pollution-cleanup after PR/suite verification"
```

### Task 9: Fix the ADR-00XX placeholder + Linear team target (F5, B8)

**Files:**
- `docs/superpowers/plans/2026-06-18-extraction-review-stage-restore.md:70,485`
- `docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md:11`

- [ ] **Step 1: Verify both stale pointers**

```bash
grep -n 'ADR-00XX' docs/superpowers/plans/2026-06-18-extraction-review-stage-restore.md
grep -n 'PRU\|Prumo (PRU)\|Prumo team' docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md
```

- [ ] **Step 2: Replace the placeholder ADR (F5)**

Replace both `ADR-00XX-extraction-review-stage.md` references with
`docs/adr/0010-extraction-review-stage-for-collaboration.md` and mark that
artifact row done (the plan is `status: implemented`).

- [ ] **Step 3: Fix the feedback team target (B8)**

In `2026-05-30-in-app-feedback-to-linear.md:11`, change the routing target from
the Prumo (PRU) team to the **Feedback (FEE)** team
(`23d83039-4f9a-444f-905a-9a4cb9fea2b6`), matching the live worker config.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-18-extraction-review-stage-restore.md docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md
git commit -m "docs(plans): point review-stage plan at ADR-0010 + correct feedback team to FEE"
```

### Task 10: Update CLAUDE.md "Current focus" + ROADMAP "Current cycle" (B1, E2)

**Files:**
- `CLAUDE.md:9-16`
- `docs/ROADMAP.md` ("Current cycle" milestone)

- [ ] **Step 1: Verify both name shipped work as active**

```bash
sed -n '9,16p' CLAUDE.md
grep -n -i 'data-path\|consolidation\|current cycle' docs/ROADMAP.md
```

- [ ] **Step 2: Collapse CLAUDE.md "Current focus" to a ROADMAP pointer (B1, E2)**

Replace `CLAUDE.md:9-16` "## Current focus" body with:
```markdown
## Current focus

- See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the active cycle. As of
  2026-06-20: structured PDF parsing / grounded extraction (ADR-0011, ADR-0013).
  The extraction data-path consolidation shipped (#228, #324) — do not treat it
  as active.
- Project history lives in `git log` and `docs/adr/` — keep this section ≤ 5 lines.
```
(Two bullets = within the ≤5-line budget, resolving E2.)

- [ ] **Step 3: Mark consolidation shipped in ROADMAP (B1)**

In `docs/ROADMAP.md`, move "extraction data-path consolidation" to a
"Recently shipped" line (check the box) and point the current cycle at the
parsing/grounded-extraction work. Fix the body "Last reviewed" line and bump
frontmatter `last_reviewed` to `2026-06-20` (overlaps Task 12/D4).

- [ ] **Step 4: Verify + commit**

```bash
grep -n 'runopen-slowload' CLAUDE.md   # expect: no output
bash scripts/docs/check-frontmatter.sh
git add CLAUDE.md docs/ROADMAP.md
git commit -m "docs: mark data-path consolidation shipped; point Current focus at active parsing work"
```

---

## Workstream 5 — Collapse duplicated root indices & dual-maintained metadata

### Task 11: Single-source the root indices (D1)

**Files:**
- `CLAUDE.md` (stack + hard rules = canonical), `llms.txt`, `README.md`,
  `docs/README.md` (doc index = canonical)

- [ ] **Step 1: Verify the drift**

```bash
grep -n -i 'gunicorn\|tailwind' README.md CLAUDE.md   # README has them, CLAUDE omits
```

- [ ] **Step 2: Reduce `llms.txt` + `README.md` stack blocks to pointers**

In `README.md` "Stack" and `llms.txt:3-6`, keep a one-line summary and add:
`> Authoritative stack + hard rules: [CLAUDE.md](CLAUDE.md).` Remove the
duplicated dependency enumeration (gunicorn/Tailwind/etc.) from the secondary
copies — CLAUDE.md is the single source. In `llms.txt`, keep only the curated
"read these first" + "must-read before touching extraction" pointers; point the
full index at `docs/README.md`.

- [ ] **Step 3: Make the routing table single-sourced**

Ensure `CLAUDE.md`'s read-first table and `docs/README.md` reference table agree
(add the missing `deployment.md` + `test-strategy.md` rows to whichever is
canonical); reduce the third/fourth copies to `> Full doc map:
[docs/README.md](docs/README.md).`

- [ ] **Step 4: Gate + commit (human-review, do not auto-merge)**

```bash
bash scripts/docs/check-frontmatter.sh
git add CLAUDE.md llms.txt README.md docs/README.md
git commit -m "docs: single-source stack/rules in CLAUDE.md and the doc index in docs/README.md"
```

### Task 12: Kill the dual-maintained last_reviewed + directory "Active" labels (D4, D6)

**Files:**
- `docs/README.md:69` (convention), `docs/README.md:52-53` ("Active" labels),
  `docs/ROADMAP.md:9`, `docs/reference/migrations.md:7`

- [ ] **Step 1: Verify the date drift**

```bash
for f in docs/ROADMAP.md docs/reference/migrations.md; do echo "== $f =="; sed -n '1,12p' "$f" | grep -n 'last_reviewed\|Last reviewed'; done
```
Expected: frontmatter `2026-06-10` vs body `2026-05-24`.

- [ ] **Step 2: Drop the duplicated visible "Last reviewed" body line (D4)**

Update `docs/README.md:69` to require frontmatter only (remove the "and a
visible status line at the top" clause). Remove the standalone body
`Last reviewed:` line from ROADMAP.md and migrations.md (keep frontmatter as the
single source the staleness gate reads), or regenerate it to match frontmatter.

- [ ] **Step 3: Neutralize the directory "Active" labels (D6)**

In `docs/README.md:52-53`, change "Active design specs" / "Active implementation
plans" to "Design specs" / "Implementation plans" (lifecycle lives in per-file
frontmatter).

- [ ] **Step 4: Gate + commit**

```bash
bash scripts/docs/check-frontmatter.sh
git add docs/README.md docs/ROADMAP.md docs/reference/migrations.md
git commit -m "docs: single-source last_reviewed in frontmatter; drop coarse 'Active' dir labels"
```

### Task 13: Relocate the misfiled observability doc (D2)

**Files:**
- Move: `docs/how-to/observability-extraction.md` → `docs/reference/observability-extraction.md`
- Modify: `docs/README.md:27` (index row)

- [ ] **Step 1: Move the file (preserve history)**

```bash
git mv docs/how-to/observability-extraction.md docs/reference/observability-extraction.md
```

- [ ] **Step 2: Fix the two-H1 + vocabulary split**

Demote the second H1 (line ~36 "Extraction E2E and Database Observability") to
`##` under one title, or split out the legacy `evaluation_*` H1 (line 9) into a
short historical note; reconcile `evaluation_*`/`extraction_*` terms to the
`extraction-hitl-architecture.md` glossary. Extract the 5-step "How to inspect
results" block into a brief `docs/how-to/` recipe that links back, OR keep it as
a `## Usage` subsection.

- [ ] **Step 3: Update the index quadrant (D2)**

In `docs/README.md`, move the observability row from the "How-to guides" table
to the "Reference" table, repathed to `./reference/observability-extraction.md`.
Update the lychee scan path list in `.github/workflows/docs-ci.yml:54` if it
enumerated the old path (it scans `docs/how-to` + `docs/reference` directories,
so no change needed — verify).

- [ ] **Step 4: Gate + commit**

```bash
bash scripts/docs/check-frontmatter.sh
git add docs/reference/observability-extraction.md docs/README.md
git commit -m "docs: refile observability-extraction under reference/ (it is a metrics catalog, not a recipe)"
```

### Task 14: Clean `.markdownlintignore` + assert resolvability + missing entries (G6, G7)

**Files:**
- `docs/superpowers/plans/2026-06-14-publication-ready-xlsx-export.md` (example only)
- Modify: `.markdownlintignore` (delete lines 9–14, 17), `.github/workflows/docs-ci.yml` (add assertion)

- [ ] **Step 1: Confirm the seven dead entries**

```bash
for p in \
  "docs/superpowers/plans/2026-04-27-sidebar-revitalization.md" \
  "docs/superpowers/plans/2026-05-03-screening-phase0-foundation.md" \
  "docs/superpowers/plans/2026-05-21-security-hardening-wave.md" \
  "docs/superpowers/plans/2026-05-22-dark-light-ux-tokenization.md" \
  "docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md" \
  "docs/superpowers/plans/2026-06-06-197-frontend-typecheck-burndown.md"; do
  [ -f "$p" ] && echo "LIVE $p" || echo "DEAD $p"
done
git ls-files 'docs/superpowers/plans/2026-*-pdf-viewer-*.md'   # expect: empty (line 9 glob is dead)
```
Expected: all DEAD / empty (they live under `archive/`, already covered by line 2).

- [ ] **Step 2: Delete the seven stale entries (G6)**

Remove `.markdownlintignore` lines 9, 10, 11, 12, 13, 14, 17 (the pdf-viewer
glob + the six archived plan paths). Keep the live entries (15, 16, 18+).

- [ ] **Step 3: Reconcile the three plans missing ignore coverage (G7) — Q-dependent**

If the per-plan-ignore convention still holds, collapse the per-file plan list
into one glob `docs/superpowers/plans/2026-*.md` (covers all three —
e2e-fixture, linear-integration, run-user-facing-vocabulary — and future
plans); otherwise leave and update the `reference_docs_ci_plan_doc_requirements`
memory in Task 17.

- [ ] **Step 4: Add a CI assertion that non-glob ignore paths resolve**

Add a step to `.github/workflows/docs-ci.yml` `markdownlint` job (after line 30):
```yaml
      - name: Assert .markdownlintignore non-glob entries resolve to tracked files
        run: |
          fail=0
          while IFS= read -r line; do
            case "$line" in ''|\#*|*'*'*) continue ;; esac
            git ls-files --error-unmatch "$line" >/dev/null 2>&1 || { echo "stale ignore: $line"; fail=1; }
          done < .markdownlintignore
          exit $fail
```

- [ ] **Step 5: Verify + commit**

```bash
while IFS= read -r line; do case "$line" in ''|\#*|*'*'*) continue;; esac; git ls-files --error-unmatch "$line" >/dev/null 2>&1 || echo "stale: $line"; done < .markdownlintignore
git add .markdownlintignore .github/workflows/docs-ci.yml
git commit -m "ci(docs): drop 7 stale .markdownlintignore entries + assert ignore paths resolve"
```

### Task 15: Archive the orphan shipped specs (F6) — Q1-dependent

**Files:**
- Move three shipped orphan specs to `docs/superpowers/specs/archive/` (if Q1 = archive)

- [ ] **Step 1: Confirm zero active inbound refs**

```bash
for s in 2026-04-27-sidebar-revitalization-design 2026-05-22-dark-light-ux-tokenization-design 2026-05-22-preflight-slash-command-design; do
  echo "== $s =="; grep -rl "$s" docs CLAUDE.md llms.txt README.md --include='*.md' | grep -v '/archive/' | grep -v "$s.md"
done
```
Expected: no non-archive backlinks (only the generic dir link).

- [ ] **Step 2: Archive (default: keep in place + leave `shipped`)**

Per Q1 default (re-status in place), these are already `status: shipped` — leave
them. Only if the owner chose "archive": `git mv` each into
`docs/superpowers/specs/archive/2026-06-10-shipped-sweep/`. Re-status or link
`screening-and-imports-design.md` (`in_progress`, unbacked) from an active plan
or set it `superseded`.

- [ ] **Step 3: Commit (only if anything moved)**

```bash
git add docs/superpowers/specs
git commit -m "docs(specs): resolve orphan design specs (archive shipped; re-status unbacked)" || echo "no change (kept in place)"
```

---

## Workstream 6 — Repair dead doc pointers & reconcile memory↔doc ownership

### Task 16: Repair the dead doc links (F1, F4)

**Files:**
- `docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md:20,259`
- `docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md:34,446,493`

- [ ] **Step 1: Verify the dead targets**

```bash
ls docs/architecture/ 2>&1 ; ls docs/reference/tests.md 2>&1   # both: no such file
grep -n 'architecture/' docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md
grep -n 'reference/tests.md' docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md
```

- [ ] **Step 2: Repoint autoloop links (F1)**

In the autoloop spec, replace all four `../../architecture/…` paths with
`../../reference/…` (`extraction-hitl-architecture.md`, `migrations.md`,
`test-strategy.md`).

- [ ] **Step 3: Repoint the e2e plan testing-doc target (F4)**

In the e2e-fixture plan, replace every `docs/reference/tests.md` with
`docs/reference/test-strategy.md` and delete the "if none exists, create
docs/reference/tests.md" branch.

- [ ] **Step 4: Verify + commit**

```bash
grep -rn 'docs/architecture/\|reference/tests.md' docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md   # expect: empty
git add docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md
git commit -m "docs: repair dead links (architecture/->reference/; tests.md->test-strategy.md)"
```

### Task 17: Frozen-spec editor's notes + English-only carve-out (F2, F3, G5) — Q3 gate

**Files:**
- `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` (frozen — notes only)
- `CLAUDE.md` + `llms.txt` (carve-out)

- [ ] **Step 1: Add the frozen-doc exception to the hard rule (Q3)**

In `CLAUDE.md` hard rules and `llms.txt:40`, append:
`Frozen archival specs (status: frozen) may quote source material verbatim in
its original language and may retain historical path citations; corrections land
as editor's notes, not silent rewrites.`

- [ ] **Step 2: Add editor's notes in the frozen spec (F2, F3, G5)**

At the top of `2026-04-27-extraction-hitl-and-qa-design.md` (below frontmatter,
not editing frozen body prose), add one HTML-comment-free note block:
```markdown
> **Editor's note (2026-06-20, status: frozen):** Historical pointers below to
> `docs/planos/ROADMAP.md` and `docs/unified-evaluation-clean-slate.md` refer to
> docs retired in the 2026-05-24 overhaul / the 008-stack drop. Current state:
> [`docs/reference/extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md)
> and [`docs/ROADMAP.md`](../../ROADMAP.md). The verbatim Portuguese quote is
> preserved per the frozen-spec carve-out.
```

- [ ] **Step 3: Gate + commit**

```bash
bash scripts/docs/check-frontmatter.sh
git add CLAUDE.md llms.txt docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md
git commit -m "docs: add frozen-spec verbatim/historical carve-out + editor's notes for dead pointers"
```

### Task 18: Add `llms.txt` frontmatter + widen the gate glob (G4) — Q4 gate

**Files:**
- `llms.txt`, `scripts/docs/check-frontmatter.sh`, `scripts/docs/check-staleness.sh`

- [ ] **Step 1: Add frontmatter to llms.txt**

Prepend to `llms.txt`:
```markdown
---
status: stable
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

```

- [ ] **Step 2: Widen the gate to include llms.txt**

In `scripts/docs/check-frontmatter.sh:35`, change the feed
`git ls-files -z '*.md'` to also include `llms.txt`:
```bash
done < <(git ls-files -z '*.md' 'llms.txt')
```
and add `llms.txt` to the enforced-path `case` (line 18-21):
```bash
    docs/*.md|docs/**/*.md|README.md|CLAUDE.md|.claude/CLAUDE.md|llms.txt) : ;;
```
Apply the same `llms.txt` inclusion to `check-staleness.sh` if it globs `*.md`.

- [ ] **Step 3: Verify + commit**

```bash
bash scripts/docs/check-frontmatter.sh   # expect: passes, now also covering llms.txt
git add llms.txt scripts/docs/check-frontmatter.sh scripts/docs/check-staleness.sh
git commit -m "ci(docs): add frontmatter to llms.txt and enforce it in the gate"
```

### Task 19: Reconcile memory ↔ doc ownership (E4, E5, E6) — Q5 gate (propose, don't force)

**Files (OUTSIDE the repo — propose a diff for the owner to apply):**
- `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_railway_deploys_from_main.md`
- `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_api_error_envelope.md`
- `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_hitl_config_inert.md`
- In-repo: `docs/reference/extraction-hitl-architecture.md:390-391` (arch-doc fix, E6)

- [ ] **Step 1: Fix the arch-doc ConsensusRule overstatement (E6, in-repo)**

In `docs/reference/extraction-hitl-architecture.md:390-391`, change the
ConsensusRule glossary from "Drives when consensus triggers and how it resolves"
to: "Stored/frozen per-run config (display + CRUD only); the backend finalize
path does **not** read it. Finalize gates are (1) `consensus_count > 0`
(EmptyFinalizeError) and (2) the extraction-only required-field completeness
gate (ADR-0009). See `run_lifecycle_service.py`." Bump `last_reviewed`.

- [ ] **Step 2: Verify + commit the in-repo fix**

```bash
grep -n 'Drives when consensus' docs/reference/extraction-hitl-architecture.md   # expect: empty
bash scripts/docs/check-frontmatter.sh
git add docs/reference/extraction-hitl-architecture.md
git commit -m "docs(arch): correct ConsensusRule glossary — stored/inert, not a finalize gate"
```

- [ ] **Step 3: Propose the memory diffs (Q5 — do NOT silently overwrite)**

Present to the owner (do not auto-apply): (a) fix the dead pointer in
`reference_railway_deploys_from_main.md:100`
(`docs/architecture/deployment.md`→`docs/reference/deployment.md`) and trim it to
durable nuggets (SKIPPED-SHA recovery, broken `--path-as-root`, `railway up`
from root) linking to `deployment.md`; (b) shrink `reference_api_error_envelope.md`
to a one-line pointer (the auto-loaded `.claude/rules/backend.md` already
enforces it); (c) update `reference_hitl_config_inert.md`'s "ONLY gate" line to
acknowledge the ADR-0009 completeness gate. Also flag the 4 other dead memory
pointers (2 archived plans, 2 branch-local UX docs) from the audit's Appendix B.

---

## Self-Review

**Spec coverage (41 findings → tasks):**
- WS-1: A1,A1b→T1 · A2,A2c→T2 · A3b,A4→T3
- WS-2: A3→T4
- WS-3: A5→T5 · A5b,G3 (+enforcement of A5)→T6
- WS-4: B3–B12,A5b,G3-normalize→T7 · B2,B13→T8 · F5,B8→T9 · B1,E2→T10
- WS-5: D1→T11 · D4,D6→T12 · D2→T13 · G6,G7→T14 · F6→T15
- WS-6: F1,F4→T16 · F2,F3,G5→T17 · G4→T18 · E4,E5,E6→T19
All 41 findings map to a task. (B-cluster B3–B13 are folded into T7/T8; E1/D3/D5/D7/C1/C2/G1/G2/G8 were merged into the listed IDs during audit dedup and travel with their primary finding.)

**Placeholder scan:** every doc edit shows the exact before/after string or the
exact `sed`/`grep` locator; the one code change (T4) carries a full failing
test + the four exact line edits; the two CI-script changes (T6, T14, T18) show
complete bash/yaml. No "TBD"/"handle edge cases"/"similar to Task N".

**Type/▸name consistency:** the envelope shape `{ok,data,error:{code,message,
details},trace_id}` is used identically in T3 (doc) and T4 (test); status values
in T5 (enum), T6 (gate), T7 (normalization) are the same three per-layer sets;
the Feedback UUID `23d83039-…` is identical in T2, T9.

**Sequencing guard:** T6 lands the value-gate code but T7 normalizes the tree so
CI stays green; T5 (enum definition) precedes T6/T7; Q-gated tasks (T2-CORS,
T5/T7-taxonomy, T15-archive, T17-frozen, T18-llms, T19-memory) each name their
§7 question.

---

## Execution Handoff

**Plan complete and saved to
`docs/superpowers/plans/2026-06-20-governance-consistency-cleanup.md`.**

This plan executes the fixes the audit only mapped — so it should run **after**
the owner ratifies the §7 open questions (the Prerequisites table). It is also
naturally splittable: WS-1+WS-2 (highest agent-impact, smallest) can ship as a
first PR, then WS-4, then WS-3, then WS-5+WS-6.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review
   between tasks. Best here because tasks are independent and reviewer-gateable.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
