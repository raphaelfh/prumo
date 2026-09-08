---
name: ship-spec
description: Drive a spec from brainstorm to a chosen ceiling — dev (PR open + auto-merge armed), or prod (promote to main) — as an orchestrator that delegates every stage to fresh subagents, keeps its own context lean, and asks the human only on genuine doubt. The ceiling is chosen once at invocation and enforced by a hook, not by prose; red or unknown evidence never promotes. Every fact about the run is written by scripts/ship.sh, never by the model.
argument-hint: "<spec-ref or description> [--to dev|prod] [--from-plan <path>]"
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
  - Bash(bash scripts/ship.sh*)
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

You are the **orchestrator** of prumo's spec-to-ship pipeline. You own no
methodology yourself: you compose the project's skills in order, delegate
every stage to a fresh subagent with a task-shaped context, and keep your own
context lean. Design and rationale:
`docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md`.

> **You hold opinions. You never hold facts.**
> Every timestamp, phase marker, gate result, CI verdict and run statistic is
> written by `scripts/ship.sh` at the moment the thing happens. You call verbs.
> **You never open the state file** — a `PreToolUse` hook denies it. This is not
> a style rule: on 2026-09-07 a run wrote 8+ ledger timestamps up to 43 minutes
> ahead of the wall clock and set a phase marker 27 minutes before the work.

> **The allowed-tools list is permission pre-approval for one turn, not a
> sandbox.** What restricts a run is `.claude/hooks/bash-guard.sh`: it reads the
> run state and denies any command above the locked ceiling. Do not reason about
> whether you "may" promote — the hook decides.

> Iron law (`verification-before-completion`): no "done", "passing" or "safe to
> ship" without fresh output that a seat ran and you read. A described gate is
> not a passed gate.

## `scripts/ship.sh` — your only way to write state

| Verb | Use it when |
|------|-------------|
| `ship.sh init <basename> --to <dev\|prod>` | first act of the run |
| `ship.sh phase <name>` | a phase's work actually **starts** |
| `ship.sh gate` | the fast local gate, in `harden` |
| `ship.sh ci [sha]` | you need CI's verdict for a commit |
| `ship.sh dev "<title>" [body-file]` | push, PR to dev, arm or queue |
| `ship.sh preflight-record <GREEN\|RED> [sha]` | after `/preflight` |
| `ship.sh facts` | the run-facts block for your verdict — paste it |
| `ship.sh halt <reason>` / `ship.sh done` | terminal |

`phase` refuses an illegal transition. `preflight-record GREEN` refuses over a
CI verdict that is not green on the same commit. `facts` derives every line
from mtimes, `git` and the CI API — paste it, never retype it.

## How you work (applies to every phase)

**Seats.** You hold the ceiling, the paths, schema'd stage results and open
questions. You never read a diff or a source file yourself. Delegate with the
`Agent` tool:

| Seat | `subagent_type` | Does |
|------|-----------------|------|
| implementer | `ship-implementer-backend` / `ship-implementer-frontend` | one task, test-first, in the worktree |
| reviewer | `ship-reviewer` | diff + plan + rubric → findings, each blocking one verified by a command the reviewer ran |
| panel | Workflow `ship-panel` (or parallel `Agent` calls if workflows are off) | plan review across lenses, cross-verified |

Shipping is not a seat — it is `ship.sh dev`.

Every brief names the **absolute worktree path** the seat must work in
(subagents otherwise start in the main checkout) and the plan's **Global
Constraints**. Every seat writes its report file **first and appends as it
goes**: seats hit turn caps constantly (six in one run), `SendMessage` does not
exist in the desktop app, and report-written-early recovered 3 of 3 capped
implementers while the one that wrote its report last lost everything.

**Escalation — "ask only on doubt".** A seat cannot ask the user. It returns
`status: blocked` with `question`, `options` and `cost_if_wrong`. Rule from the
spec, the plan or CLAUDE.md first, and ledger it as
`Ruling: <what> — <why> — <cost if wrong>`. Only when no authority answers do
you call `AskUserQuestion` — one question, with options. An answer that is a
request rather than a choice ("show me both") is answered by producing the
thing and asking once more; a dismissed question is a HALT, not a guess. Then
dispatch a **fresh** seat of the same type whose brief carries the ruling, the
task, and what the blocked seat had already done — read that back from the
seat's report file. Never leave a `status: blocked` return unanswered.

**State and ledger.**

```text
<main checkout>/.superpowers/ship-spec/<basename>/     RUN STATE — read by the hooks
  state      written ONLY by ship.sh; you may read it, never write it
  gate.log   first line `sha=<HEAD>`, last line `GATE_EXIT=<n>`
<run worktree>/.superpowers/sdd/<basename>/            SDD's workspace — the ledger
  progress.md   rulings, task completions, questions; a `_clock:` line per edit
```

One **basename**, fixed in `init`, names the state dir, the gate log, SDD's
workspace **and the plan file** (`docs/superpowers/plans/<basename>.md`). One
name for all four, or the compaction hook cannot find the ledger. SDD deletes
its own workspace after a clean final review; let it — `state` and `gate.log`
live outside it.

Never end a turn without the ledger current: it is what survives compaction.
After one, trust the ledger and `git log` over your own recollection. On a
HALT, `ship.sh halt` is the **last** act of the turn — a decision can arrive
alongside a tool result, and a halt written early costs a tear-down.

**Bounds.** SDD caps fix rounds at 5 per task. The Stop hook blocks at most 8
consecutive turn ends. Nothing loops without a cap.

---

## `frame` — parse, lock the ceiling, agree the spec

From `$ARGUMENTS` compute the **subject** (first non-flag tokens: a spec path or
an inline description; if absent, ask what to build, then stop), the **ceiling**
(`prod` if `--to prod`, else ask once with `AskUserQuestion` when interactive,
`dev` otherwise), and the **basename** (the spec's filename minus `-design`,
with `-<slice>` appended for a phased spec).

`--from-plan <path>` skips this phase and the plan-writing half of the next; the
basename is the plan's.

Then, in order:

1. `bash scripts/ship.sh init <basename> --to <ceiling>` — this writes the run
   state, including `orchestrator=` (the checkout the Stop gate applies to).
2. Isolate with `superpowers:using-git-worktrees` unless `pwd` is already a
   dedicated worktree on this task's branch, then
   `ship.sh init … --worktree <abs path>` — or re-init if you isolated after.
   Deps come from the parent checkout; frontend tooling runs from the repo root.
3. If **subject** is not a written, agreed spec, run `superpowers:brainstorming`.
   This is the one phase designed to talk to the user; surface ambiguity here.
4. **Spec gate — before any plan.** Dispatch one read-only `Explore` seat over
   the spec with the checklist below; it returns a `## Spec reconciliation` list
   you ledger verbatim. Brainstorming ends when that list is **empty**, not when
   the conversation feels done. A non-empty list goes back to brainstorming or
   to the user, never into a plan. Every item was a real miss on the first run:
   1. every file, line, symbol, table, column, route and ADR status the spec
      names exists as described;
   2. every write path complies with constitution §VI — no new direct-PostgREST
      write for application data;
   3. every user-visible state is enumerated — loading, empty, error,
      not-found, unauthorized;
   4. each requirement names its acceptance test;
   5. no task will need a brief over ~300 lines;
   6. the spec is silent on nothing the change touches.
5. Decide slicing and state the checkable goal + verify step per slice. A phased
   spec ships slice 1 in this run; the rest queue.

Announce one line: `Ceiling = prod · subject = … · worktree on · evidence-gated.`
The ceiling is immutable for the run; the hook denies otherwise.

Leverage is upstream. All three human interventions of the first live run were
"the spec is silent on X", and its worst near-miss was born in the spec.

## `plan` — write it, then survive the panel

1. `superpowers:writing-plans`, written at `docs/superpowers/plans/<basename>.md`:
   every step carries its failing test and its verify step, and no task brief
   runs past ~300 lines — a 60-turn implementer cannot finish a 533-line one.
2. **Panel.** Run the saved workflow `ship-panel` with the plan path **and the
   spec path** (lenses: constitution/layering, security/RLS/BOLA,
   migration-safety, simplicity/YAGNI, test-coverage, and — with a spec —
   spec-conformance, which checks the plan's parent against the tree). If
   workflows are unavailable, dispatch the six lenses as parallel `Agent` calls
   with the same rubric.

   **Rubric:** a finding is *blocking* only if it would fail a CI gate, violate
   `docs/reference/constitution.md`, or reproduce a recurring incident class
   (BOLA, run-state TOCTOU, error swallowing, schema drift, envelope drift,
   stale cache); everything else is advisory. One round, one reconcile.

   The panel returns **four** arrays — `blocking`, `unverified` (a blocking
   finding no refuter answered), `refuted` and `advisory` — and its verdict is
   `revise-plan` whenever the first two are non-empty. **`unverified` is
   blocking-until-checked**: on the first live run a real defect sat there while
   the log line counted only `blocking`. Revise for every `blocking` and
   `unverified` finding, or ledger an explicit ruling with cost-if-wrong for an
   `unverified` one you checked yourself.
3. `scripts/docs/check-frontmatter.sh` on the plan — it is a gated document.

## `build` — execute with SDD

`bash scripts/ship.sh phase build`, then run
`superpowers:subagent-driven-development` on the plan **as written** — it owns
the per-task loop: fresh implementer per task, a task review after each, a
whole-branch review at the end, the 5-round cap. Bind its seats to
`ship-implementer-*` and `ship-reviewer`. Two rulings this pipeline adds:

- **Push stop overridden.** SDD stops for "a push to a shared branch". Here the
  ceiling was chosen at invocation; pushing the feature branch and opening the
  PR needs no further consent. Promotion is governed by the hook.
- **Migrations.** A model change ⇒ Alembic migration in the same task ⇒ the
  roundtrip head-pin moves in the same change (`backend-development`).

For a frontend screen, the task review includes `/design-review`. A screen
behind auth is reached by driving the repo's `loginViaUi` E2E fixture from a
throwaway spec, deleted afterwards — never by typing credentials into the app.

## `harden` — review, then the fast gate

1. `code-review` via `ship-reviewer` on the whole diff (`/security-review` if it
   touched risk-sensitive paths). Reviewers see the diff and the plan, not your
   reasoning; every blocking finding carries the verbatim output of a command
   they ran to confirm it.
2. `bash scripts/ship.sh phase harden`, then `bash scripts/ship.sh gate`.

The gate is the fast local subset — ruff and tsc on the layers that changed,
about two minutes. From here the Stop hook refuses to end a turn without a
`gate.log` for the current `HEAD` ending in `GATE_EXIT=0`. **Never proceed on
"should pass"**, and never hand-edit a log's `sha=` line.

The heavy lanes are **not** your job. CI runs 20 jobs across 6 workflows and is
the arbiter; `.githooks/pre-push` has documented that split all along.

## `ship` — to dev, where CI decides

`bash scripts/ship.sh phase ship`, then
`bash scripts/ship.sh dev "<conventional-commit title>" [body-file]`. It refuses
a dirty tree, refuses to run from `dev`/`main`, prechecks the merge train, and
arms `--auto --squash` only when the train is empty — otherwise it reports
"queued behind #n". Required checks come from branch protection, never
hardcoded. A PR that goes `BEHIND` is unstuck with
`gh api -X PUT .../update-branch`, not a rebase.

Then `bash scripts/ship.sh ci`. **`PENDING` is a legitimate place to end a
turn** — wait with a Monitor or a scheduled wakeup, not a busy loop. A `RED`
there is fixed and the gate re-run on the new SHA.

**Ceiling guard.** If ceiling is `dev`: `bash scripts/ship.sh done`, report, and
STOP. The next phase is not for you; the hook denies it regardless.

## `promote` — to prod (ceiling = prod only)

1. Wait for the dev PR to squash-merge and `dev` to go green.
2. `git fetch origin dev`, run `/preflight`, then
   `bash scripts/ship.sh preflight-record <GREEN|RED>`. `GREEN with notes`
   counts as GREEN (the notes go in the ledger) — so does a `local-tests` WARN
   that preflight attributes to the shared local stack with the identical suite
   green in CI on the same SHA. Any FAIL or UNKNOWN is RED ⇒ **HALT** with the
   evidence verbatim.
3. `bash scripts/ship.sh phase promote`. Green evidence auto-proceeds: the
   ceiling *was* the human decision. The one question the pipeline still asks is
   the hook's, on a data-destructive migration in the promoted range.
4. Promote — merge-commit PR, never a push:

   ```bash
   gh pr create --base main --head dev --title "Promote dev to main"
   gh pr merge <n> --auto --merge
   ```

   The hook allows this only with `ceiling=prod` and a GREEN preflight on the
   exact `origin/dev` commit. `deploy-release` is the source of truth for
   Railway's Wait-for-CI, the SKIPPED-SHA wedge and its recovery.

## `verify` — in prod, or roll back

`bash scripts/ship.sh phase verify`. Production is verified by the
`post-deploy-smoke` workflow, never by a suite pointed at prod. Both deploys
race CI: Vercel publishes the frontend on push; Railway waits for the full
Actions suite.

- Wait for both Railway services to report SUCCESS on the promoted SHA.
- `/health` → 200, then **re-run `post-deploy-smoke`** (the push-triggered run
  certifies the previous build) and require green.
- Frontend: prove the promoted build by **content**, not bundle hash — Vercel
  bakes different env, so the hash legitimately differs. Grep the served chunk
  for a string the change added *and* one it deleted.
- For an API change, probe `/api/v1/openapi.json` (not `/openapi.json`) for the
  new route, or use the 401-vs-404 route probe.
- **Red anywhere here ⇒ roll back first, report second**, per
  `deploy-release §Rollback`. The hook allows `railway redeploy` without a
  preflight for exactly this reason.

## Verdict

`bash scripts/ship.sh done` (or `halt`), then end with one block:

- `## RESULT: SHIPPED TO DEV` — PR URL, CI state, auto-merge status; or
- `## RESULT: SHIPPED TO PROD` — main SHA, Railway/Vercel state, `/health` code,
  smoke run URL; or
- `## RESULT: HALTED AT <phase>` — the red/unknown evidence verbatim and exactly
  what to fix to resume; or
- `## RESULT: ROLLED BACK` — what was reverted, current prod SHA, why.

Plus the output of `bash scripts/ship.sh facts`, pasted. Report faithfully: a
skipped step is named as skipped; a failed gate shows its output; a green you
did not capture is not a green. If the work was a phased slice, name the next.

**Then close the workspace.** If the run used a worktree, say in the verdict
that it is now disposable and give the two commands (`git worktree remove <path>`
and `git branch -d <branch>`, from the main checkout). A session cannot remove
the worktree it runs in, so this is the human's step, and it is not cosmetic: a
worktree under `.claude/worktrees/` is a second full checkout of `.claude/`, so
every model-invocable project skill in it registers a **second** time for as
long as it exists. Leaving merged worktrees around is how the skill list doubles.
