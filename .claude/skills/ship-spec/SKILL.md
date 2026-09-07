---
name: ship-spec
description: Drive a spec from brainstorm to a chosen ceiling — dev (PR open + auto-merge armed), or prod (promote to main) — as an orchestrator that delegates every stage to fresh subagents, keeps its own context lean, records state in the SDD ledger, and asks the human only on genuine doubt. The ceiling is chosen once at invocation and enforced by a hook, not by prose; red or unknown evidence never promotes.
argument-hint: "<spec-ref or description> [--to dev|prod] [--from-plan <path>] [--no-worktree] [--no-automerge] [--confirm-promote] [--dry-run]"
disable-model-invocation: true
allowed-tools:
  - Agent
  - Skill
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(git:*)
  - Bash(gh:*)
  - Bash(make:*)
  - Bash(npm run*)
  - Bash(npx:*)
  - Bash(uv run*)
  - Bash(cd backend*)
  - Bash(curl:*)
  - Bash(railway:*)
  - mcp__Claude_Browser__preview_start
  - mcp__Claude_Browser__computer
  - mcp__Claude_Browser__read_page
---

# /ship-spec — spec → chosen ceiling

User-supplied arguments: `$ARGUMENTS`

You are the **orchestrator** of prumo's spec-to-ship pipeline. You own
no methodology yourself: you compose the project's skills in order,
delegate every stage to a fresh subagent with a task-shaped context, and
keep your own context lean. Design and rationale:
`docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md`.

> **The list above is permission pre-approval for one turn, not a
> sandbox.** It clears at the next user message. What actually restricts
> a run is `.claude/hooks/bash-guard.sh`: it reads the run state written
> in Phase 0 and denies any command above the locked ceiling. Do not
> reason about whether you "may" promote — the hook decides.

> Iron law (`verification-before-completion`): no "done", "passing" or
> "safe to ship" without fresh output that a seat ran and you read. A
> described gate is not a passed gate.

## How you work (applies to every phase)

**Seats.** You hold the ceiling, the spec/plan/ledger paths, schema'd
stage results and open questions. You never read a diff, a test log or
a source file yourself. Delegate with the `Agent` tool:

| Seat | `subagent_type` | Does |
|------|-----------------|------|
| implementer | `ship-implementer-backend` / `ship-implementer-frontend` | one task, test-first, in the worktree |
| reviewer | `ship-reviewer` | diff + plan + rubric → findings; dispatches `ship-verifier` per blocking finding |
| gate-runner | `ship-gate-runner` | runs a gate, writes `quality-scan.log`, returns failures + SHA only |
| shipper | `ship-shipper` | merge-train precheck, push, PR, auto-merge (SDD's implementers commit; the shipper refuses a dirty tree) |
| panel | Workflow `ship-panel` (or parallel `Agent` calls if workflows are off) | plan review across lenses, cross-verified |

Every brief names the **absolute worktree path** the seat must work in
(subagents otherwise start in the main checkout) and the plan's
**Global Constraints**. Subagents do not receive auto-memory; the prumo
lessons they need are written into each agent's body and preloaded
through its `skills:`. Each agent also has `memory: project`, so
`.claude/agent-memory/<name>/` accumulates over runs (it is created on
first use and is meant to be committed).

**Escalation protocol — "ask only on doubt".** A seat cannot ask the
user. It returns `status: blocked` with `question`, `options` and
`cost_if_wrong`. You first try to rule from the spec, the plan or
CLAUDE.md (SDD's "Rulings, not stalls"); ledger the ruling as
`Ruling: <what> — <why> — <cost if wrong>`. Only when no authority
answers do you call `AskUserQuestion` — one question, with options.
Either way the seat then continues, by one of two routes: resume the
*same* seat with `SendMessage` where the client offers that tool, and
otherwise dispatch a **fresh** seat of the same type whose brief carries
the ruling, the task, and what the blocked seat had already done. Read
that last part back from the ledger — carrying a blocked seat's progress
across a restart is what the ledger is for. Do not assume `SendMessage`
exists: the desktop app disables it for the session and its subagents,
and a resume you cannot perform is a stall. Never leave a `status:
blocked` return unanswered. Every ruling and every question lands in the
ledger.

**State and ledger.** Two directories, deliberately separate:

```
<main checkout>/.superpowers/ship-spec/<plan-basename>/     the RUN STATE — read by the hooks
  state             ceiling=<dev|staging|prod>  phase=<0-8|halted|done>  preflight=GREEN@<sha>|RED@<sha>
                    worktree=<absolute path of the run's working tree>
  quality-scan.log  gate output; first line `sha=<HEAD it ran on>`
<run worktree>/.superpowers/sdd/<plan-basename>/            SDD's workspace — the ledger
  progress.md       rulings, task completions, questions, KPI line
```

The main-checkout root is `dirname "$(git rev-parse --path-format=absolute
--git-common-dir)"`, the same from the main checkout and from any worktree,
which is why the hooks resolve it that way. SDD resolves its own workspace
with the plugin's `sdd-workspace` script and **deletes it after a clean
final review** — that is fine because `state` and the gate log live
outside it; copy the KPI line into `state` before Phase 4 ends. Both
directories are gitignored.

Write `state` (ceiling, phase, worktree) before anything else in Phase 0,
update `phase=` at every phase boundary, and never end a turn without the
ledger current: it is what survives compaction — after one, trust the
ledger and `git log` over your own recollection (a
`SessionStart`/`PostCompact` hook re-injects both). On a HALT or a
question that ends your turn, set `phase=halted` first; on completion,
`phase=done`. `halted` and `done` are terminal for every hook; a state
untouched for 24 hours is treated as a crashed run.

**Bounds.** SDD caps fix rounds at 5 per task. The Stop hook blocks at
most 8 consecutive turn ends. If the user set `/goal`, its evaluator
decides completion, not you. Nothing loops without a cap.

Create one todo per phase before you start.

---

## Phase 0 — Parse arguments, lock the ceiling, write state

From `$ARGUMENTS` compute:

- **subject** — the first non-flag token(s): a written spec path or an
  inline description. Required; if absent, ask what to build, then stop.
- **ceiling** — `prod` if `--to prod`, else `dev`. If `--to` is absent
  and the session is interactive, ask once with `AskUserQuestion`
  (`dev` recommended); otherwise `dev`. The ladder is `dev < staging <
  prod`; `staging` is reserved until its infrastructure exists.
- `--from-plan <path>` — skip Phase 1 and the plan-writing half of 2.
- `--no-worktree`, `--no-automerge`, `--confirm-promote`, `--dry-run` —
  as named. `--dry-run` runs every read-only gate, prints what each
  write step would do, and makes no commit, push, PR or deploy; it stops
  at the end of Phase 5 regardless of ceiling.

Then write `state` (`ceiling=<c>`, `phase=0`, `worktree=<absolute path
of the checkout this run edits — the worktree from Phase 1, or the
current checkout under --no-worktree>`) under
`<main checkout>/.superpowers/ship-spec/<plan-basename>/` and announce
one line:

> Ceiling = prod · subject = ADR-0013 stored-markdown tier · worktree on · auto-merge armed · evidence-gated.

The ceiling is immutable for the run. A `dev` run that later "should
also promote" is a bug, and the hook will deny it anyway.

## Phase 1 — Frame (skip if `--from-plan`)

- If **subject** is not a written, agreed spec, run
  `superpowers:brainstorming`. This is the one phase designed to talk to
  you; surface ambiguity here, not later.
- Unless `--no-worktree`, isolate with `superpowers:using-git-worktrees`
  (native tool first), then update `worktree=` in `state` to the new
  absolute path — the Stop hook compares the gate log against *that*
  checkout's `HEAD`. Deps come from the parent checkout; frontend
  tooling runs from the repo root.
- Decide slicing and state the checkable goal + verify step per slice.
  A phased spec ships slice 1 in this run; the rest queue.

## Phase 2 — Plan, then survive the panel

1. `superpowers:writing-plans`: every step carries its failing test and
   its verify step.
2. **Panel.** Run the saved workflow `ship-panel` with the plan path
   (lenses: constitution/layering, security/RLS/BOLA, migration-safety,
   simplicity/YAGNI, test-coverage; each finding cross-verified by a
   second agent before it is reported). If workflows are unavailable,
   dispatch the five lenses as parallel `Agent` calls with the same
   rubric. **Rubric:** a finding is *blocking* only if it would fail a
   CI gate, violate `docs/reference/constitution.md`, or reproduce a
   recurring incident class (BOLA, run-state TOCTOU, error swallowing,
   schema drift, envelope drift, stale cache); everything else is
   advisory. One round, one reconcile. Revise the plan for blocking
   findings, ledger the rulings on advisory ones, proceed.

## Phase 3 — Execute with SDD

Run `superpowers:subagent-driven-development` on the plan **as written**
— it owns the per-task loop: fresh implementer per task, a task review
after each, a whole-branch review at the end, the ledger, the 5-round
cap. Bind its seats to this pipeline's agents (`ship-implementer-*`,
`ship-reviewer`). Two rulings this pipeline adds:

- **Push stop overridden.** SDD stops for "a push to a shared branch".
  Here the ceiling was chosen at invocation; pushing the feature branch
  and opening the PR in Phase 5 needs no further consent. Promotion is
  governed by the hook, not by this ruling.
- **Migrations.** A model change ⇒ Alembic migration in the same task
  ⇒ the roundtrip head-pin moves in the same change (`backend-development`).
- **Workspace deletion.** SDD deletes its workspace (`rm -rf`) after a
  clean final review. Let it: the run `state` and `quality-scan.log`
  live in `.superpowers/ship-spec/<plan>/`, not there. Before SDD's
  final review, copy the ledger's KPI line into `state`; the hooks keep
  enforcing the ceiling through Phases 4–8.

For a frontend screen, the task review includes `/design-review`.

## Phase 4 — Harden (the Iron Law gate)

1. `/simplify`, then `architectural-quality-loop` on the touched slice,
   then `code-review` via `ship-reviewer` on the whole diff (`/security-review`
   if it touched risk-sensitive paths). Reviewers see the diff and the
   plan, not your reasoning.
2. Dispatch `ship-gate-runner` for `make quality-scan` plus the suites
   the diff touches (`web-testing` names the layers; an endpoint diff
   needs direct endpoint-coroutine unit tests). It writes
   `quality-scan.log` with `sha=<HEAD>` and returns only failures.
3. Set `phase=4` before step 2: from here the Stop hook refuses to let
   a turn end without a `quality-scan.log` for the current `HEAD`. Red
   ⇒ fix through SDD's review loop and re-run the gate. **Never proceed
   on "should pass".** Record the KPI line in the ledger: questions
   asked, permission prompts, manual unsticks, tokens, wall-clock.

## Phase 5 — Ship to dev

**`--dry-run`: do not dispatch the shipper.** Print the branch, the
would-be PR title and body, and the merge-train state
(`gh pr list --base dev --json autoMergeRequest`), then go to the
ceiling guard below. Otherwise dispatch `ship-shipper` with the branch,
a conventional-commit title and the PR body. It runs the **merge-train
precheck** (`gh pr list --base
dev --json autoMergeRequest`): if a PR is already armed, it opens the PR
unarmed and reports "queued behind #n"; otherwise it arms
`gh pr merge --auto --squash` (unless `--no-automerge`). Required checks
are read from branch protection, never hardcoded. A PR that goes
`BEHIND` is unstuck with `gh api -X PUT .../update-branch`, not a rebase.

**Ceiling guard.** If ceiling is `dev` (or `--dry-run`): set
`phase=done`, report PR URL, CI state and auto-merge status, and STOP.
Phase 6 is not for you; the hook denies it regardless.

## Phase 6 — Promote to prod (ceiling = prod only)

1. Wait for the dev PR to squash-merge and `dev` to go green (bounded:
   poll with a Monitor or scheduled wakeup, not a busy loop).
2. `git fetch origin dev`, then run `/preflight`. Record the verdict in
   `state` as `preflight=GREEN@<origin/dev sha>` or `preflight=RED@<sha>`.
   `GREEN with notes` counts as GREEN (the notes go in the ledger); any
   FAIL or UNKNOWN is RED ⇒ **HALT** with the evidence verbatim.
3. If `--confirm-promote`, ask once. Otherwise green evidence
   auto-proceeds: the ceiling *was* the human decision.
4. Promote — merge-commit PR, never a push:

   ```bash
   gh pr create --base main --head dev --title "Promote dev to main"
   gh pr merge <n> --auto --merge
   ```

   The hook allows this only with `ceiling=prod` and a GREEN preflight on
   the exact `origin/dev` commit, and asks once if the promoted range
   carries a data-destructive migration. `deploy-release` is the source
   of truth for Railway's Wait-for-CI, the SKIPPED-SHA wedge and its
   recovery.

## Phase 7 — Verify in prod, or roll back

Production is verified by the `post-deploy-smoke` workflow, never by a
suite pointed at prod. Both deploys race CI: Vercel publishes the
frontend on push; Railway waits for the full Actions suite.

- Wait for both Railway services to report SUCCESS on the promoted SHA.
- `/health` → 200, then **re-run `post-deploy-smoke`** (the push-triggered
  run certifies the previous build) and require green; it asserts
  `/health.commit` == promoted SHA.
- Frontend: the prod alias serves a new `/assets/index-<hash>.js` for
  the promoted build (`deploy-release` § verify).
- For an API change, prove the contract is live: probe
  `openapi.json` for the new route, or the 401-vs-404 route probe.
- If a user-facing surface changed, run `/design-review` against a local
  server built from the promoted commit (browsing `*.vercel.app` is
  blocked by policy) and say so.
- **Red anywhere here ⇒ roll back first, report second**, per
  `deploy-release §Rollback`: fast path is redeploying the last green
  Railway image; slow path is `git revert` on `main`. The hook allows
  `railway redeploy` without a preflight for exactly this reason.

## Phase 8 — Verdict

Set `phase=done` (or `halted`) and end with one block:

- `## RESULT: SHIPPED TO DEV` — PR URL, CI state, auto-merge status; or
- `## RESULT: SHIPPED TO PROD` — main SHA, Railway/Vercel state,
  `/health` code, smoke run URL, bundle hash; or
- `## RESULT: HALTED AT <phase>` — the red/unknown evidence verbatim and
  exactly what to fix to resume; or
- `## RESULT: ROLLED BACK` — what was reverted, current prod SHA, why.

Plus the KPI line from the ledger. Report faithfully: a skipped step is
named as skipped; a failed gate shows its output; a green you did not
capture is not a green. If the work was a phased slice, name the next.

**Then close the workspace.** If the run used a worktree, say in the
verdict that it is now disposable and give the two commands
(`git worktree remove <path>` and `git branch -d <branch>`, from the main
checkout). A session cannot remove the worktree it is running in, so this
is the human's step, and it is not cosmetic: a worktree under
`.claude/worktrees/` is a second full checkout of `.claude/`, so every
model-invocable project skill in it registers a **second** time as
`.claude/worktrees/<name>:<skill>` for as long as it exists. There is no
setting that excludes it. Leaving merged worktrees around is how the
skill list doubles.
