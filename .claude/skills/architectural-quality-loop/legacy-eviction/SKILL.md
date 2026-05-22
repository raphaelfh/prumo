---
name: legacy-eviction
description: Safely delete legacy code from prumo — proves the symbol is unused, deletes in ONE commit (no two-PR deprecation dance), and adds a fitness rule / regression test that prevents the concept from coming back. Trigger when the architectural-quality-loop APPLY phase routes a `category=legacy` finding here, or when the user explicitly says "evict <symbol>", "remove dead <thing>", "delete the legacy X". Always runs inside a git worktree (via superpowers:using-git-worktrees) — the main tree is never partially mutated.
---

# Legacy Eviction (prumo)

Deletes a piece of legacy code that the architectural-quality-loop SCAN flagged, with a discipline that prevents the deleted concept from sneaking back. This is the **APPLY** path for `category=legacy` findings; it is also invocable directly when the user knows what they want gone.

The project's history is full of "we ripped this out for good reasons" moments (the 0001 baseline squash, the `extracted_values` drop, the `ai_suggestions` migration, the `prediction_models` magic-string saga). Each time, the deletion was scoped, atomic, and accompanied by a guard that made the deletion **permanent**. This skill encodes that pattern.

## When to use

- The quality loop's PLAN phase decided a finding's resolution is a pure deletion (`fix_must_add="fitness-rule"` or no APPLY scope larger than removing the dead artefact).
- The user said "evict X", "remove dead X", "delete the legacy Y", "purge `<symbol>`".
- A `legacy-spotter` subagent finding has `confidence ≥ 0.85` and you have a concrete symbol/file to delete.

Do **not** use for:
- Renames (the symbol still exists, just under a new name → use the relevant domain skill).
- Anything that requires writing replacement logic (use `backend-development` / `ui-styling` instead).
- A deprecation dance with a transition period (prumo explicitly rejects this pattern — see CLAUDE.md `.claude/CLAUDE.md`).

## The 4-step contract

Every eviction follows these 4 steps in order. Skipping any step is how the same legacy concept returns next quarter.

### 1. Prove unused (the multi-grep)

Search the **entire repository** for the symbol — not just the file you intend to delete. Two greps minimum:

```bash
# A. Live identifier search across all extensions
grep -rn "\\b<symbol>\\b" \
  --include="*.py" --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.jsx" --include="*.sql" \
  --include="*.md" --include="*.yml" \
  /Users/raphael/PycharmProjects/prumo \
  --exclude-dir=node_modules --exclude-dir=__pycache__ \
  --exclude-dir=.git --exclude-dir=.venv --exclude-dir=.claude/worktrees

# B. Git log -S (the pickaxe): when did this symbol last appear in a diff?
( cd /Users/raphael/PycharmProjects/prumo && \
  git log -S '<symbol>' --oneline --since="6 months ago" )
```

Decide:
- **Zero live imports / references** outside the file you intend to delete → safe to evict.
- **Imports exist but the importer is itself dead** → recurse on the importer first; do NOT chain-delete in one shot (one commit per dead file keeps reverts cheap).
- **Imports exist in live code** → STOP. This is not eviction; the symbol is in use. Either close the finding as wrong, or open a separate refactor task to migrate the users first.
- **External consumers (`__all__`, schema export, public type)** → STOP. Public API removal needs a separate decision and a SemVer-aware plan; not in scope here.

Document the grep result in the iteration md under `## Proof of unused`:

```markdown
## Proof of unused

```bash
$ grep -rn "\\bEntityTreeNode\\b" --include="*.ts" ...
frontend/types/extraction.ts:117:export type EntityTreeNode = ...
(no other matches)
```

`git log -S 'EntityTreeNode'` last touched 2026-04-18 in commit
`04040d5` (introducing it), with no consumer commits since.
```

### 2. Delete in one commit (no two-step deprecation)

In a git worktree (always — see step 0 below), delete:
- The symbol's definition.
- All exports referencing it (`__all__`, barrel re-exports).
- The dead file itself if the only export was the dead symbol.
- Any test file that exists **solely** to cover the dead symbol (`test_<symbol>.py` etc.).

Do **not**:
- Add `// DEPRECATED` comments and ship a no-op stub.
- Rename to `_unused_<symbol>` and ship.
- Stage a "removal PR" that ships the deletion without the guard from step 3.

The deletion + guard land in the **same** commit.

### 3. Add the recurrence guard (the fitness rule)

If the deletion is at the file/path level: extend the allowlist removal in `scripts/fitness/check_legacy_concepts.py` so a future `grep`-based reintroduction is caught. If the symbol is sui generis (an enum value, a type alias, a function name): consider adding a new pattern to the legacy-patterns blacklist (see `../references/legacy-patterns.md` for the format) and a regex to `check_legacy_concepts.py`, with a canary test in `backend/tests/unit/scripts/test_check_legacy_concepts_canary.py`.

If the symbol is a runtime concept (not a string match): add an integration test that asserts the symbol's behaviour is gone. Example: when `extracted_values` was dropped, the regression test `test_schema_drift.py::test_calculate_model_progress_signature_locked` was added to ensure the function never re-references the dropped table by name.

The guard goes in the SAME commit as the deletion. Without the guard, the LLM judge's "no recurrence guard" rule returns `DOES_NOT_RESOLVE`.

### 4. Update the canonical docs

If the deleted concept appeared in `docs/architecture/extraction-hitl-architecture.md` §6 Legacy or in `CLAUDE.md` Recent Changes, update those entries. The skill's `../references/legacy-patterns.md` mirror is the secondary source — `check_glossary_sync.py` (Phase 4) catches drift between the two.

## Step 0 — worktree isolation (always)

Before any of the 4 steps above, invoke `superpowers:using-git-worktrees` to create an isolated worktree:

```
.claude/worktrees/quality-loop-<run-id>-<iter>/
```

All edits + commits happen in that worktree. If VERIFY fails or the judge rejects, the worktree is torn down by the orchestrator (`git worktree remove`) — the main tree never sees the partial state. Only when the judge returns `RESOLVES` does the orchestrator cherry-pick / merge the commit into `dev`.

## House rules

- **One symbol per iteration.** Two unrelated deletions = two iterations.
- **One commit per deletion.** No squashing the guard into a separate commit.
- **No stub left behind.** No `// removed` comment with no code; no `_unused_x` rename; no empty file.
- **Tests are deleted with the symbol they cover** — orphan tests are themselves a legacy smell.
- **Public API exit requires a separate plan.** This skill refuses to touch anything in a published `__all__` or in `package.json` `exports`.
- **External package removal** (`npm uninstall`, `uv remove`) is in scope and ships in the same commit as the source deletion + guard.

## Cross-skill flow

1. Quality loop SCAN flags a `category=legacy` finding with `confidence ≥ 0.85`.
2. TRIAGE prioritises it; PLAN decides "pure deletion" and routes APPLY to this skill.
3. APPLY: invoke `superpowers:using-git-worktrees` → step 1 grep → step 2 delete → step 3 guard → step 4 doc.
4. VERIFY: `scripts/verify_all.sh` runs in the worktree (must include `check_legacy_concepts.py` re-run, which should NOW reject the pattern if you added a regex).
5. Judge: receives FINDING + DIFF (your commit) + GATE_OUTPUT + COUNTERFACTUAL_PROBE. Returns `RESOLVES` only if:
   - The grep proof is verbatim in the iteration md.
   - The diff deletes the dead symbol AND adds a guard.
   - All gates exit 0.
   - The counterfactual probe (revert your diff, re-run check_legacy_concepts.py) shows the new pattern would fire.
6. Reflexion paragraph: one line on the residual risk (e.g. "the symbol may still appear in third-party packages indexing the repo"), one line on what to do differently next time.
7. CONVERGE: re-SCAN — if 0 findings ≥ 0.7 AND verify_all.sh exit 0 → STOP.

## Quick reference

- Worktree skill: `superpowers:using-git-worktrees`
- Verify wrapper: `scripts/verify_all.sh`
- Legacy patterns blacklist: `../references/legacy-patterns.md`
- Fitness function: `scripts/fitness/check_legacy_concepts.py`
- Judge prompt: `../references/judge-prompt.md`
- Canary test pattern: `backend/tests/unit/scripts/test_check_legacy_concepts_canary.py`
