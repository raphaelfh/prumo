---
status: in_progress
last_reviewed: 2026-09-06
owner: '@raphaelfh'
---

# `/ship-spec` v2 — orchestrator, guards, evidence — design

> Consolidated on 2026-09-05 from a five-round adversarial review of the
> original `.claude/commands/ship-spec.md` (file audit, SOTA research
> against the current Claude Code docs, subagent architecture, and three
> user decisions on ceiling, auto-merge and context). Built on
> 2026-09-06 in one PR with one commit per slice (§4); every mechanism
> below was checked against what the repo and the harness actually do
> before it was written, and §6 records what was and was not verified.
>
> The one-line thesis: every mechanism the original command *described
> in prose* already existed as machinery in this repo or the harness —
> the SDD ledger, `bash-guard.sh`, the Stop hook, `/goal`, the Workflow
> tool, skill evals — and the command used none of them. v2 is wiring,
> not invention. The command now lives at
> `.claude/skills/ship-spec/SKILL.md` (same `/ship-spec` invocation) so
> its eval suite can sit beside it.

## 1. Decisions (locked)

1. **Orchestrator + workers, in one session.** The main session is the
   orchestrator because it is the only context that can call
   `AskUserQuestion` (subagents cannot; workflows take no mid-run input).
   It holds the ceiling, the paths, the ledger and schema'd stage results
   — never a diff, a test log or a file body. Every other seat is a
   defined subagent with a fresh, task-shaped context. Session splits
   were considered and rejected: they make the human the scheduler.
2. **Ceiling ladder; `--to prod` goes straight through.** Rungs
   `dev < staging < prod` are a config table, not flags. The ceiling is
   the human decision, taken once at invocation; a green run promotes
   without re-asking. `--confirm-promote` stays as an opt-in. The single
   exception is a data-destructive Alembic migration in the promoted
   range (DROP / TRUNCATE / column removal): the guard asks once, at any
   rung that shares a database, because a deploy is reversible and that
   is not.
3. **Auto-merge stays the default.** The defect was arming a second PR
   while one is armed on strict `dev` (both go BEHIND). Fix: precheck the
   train before arming, queue otherwise, and a `/merge-train` command
   (loopable) that arms the next CLEAN PR and update-branches any BEHIND
   one. The promotion PR uses `--auto --merge` the same way.
4. **Context contract.** `autoCompactWindow` at roughly a third of the
   window (`350k`, tune from the status line); a `PostCompact` /
   `SessionStart(compact|resume)` hook re-injects the run state and the
   ledger tail; a `## Compaction` block in `CLAUDE.md` names what a
   summary must keep; the ledger is written at every phase boundary and
   every task completion; the orchestrator never reads a diff or a test
   log directly.
5. **Evidence is an artifact, and the generator is not the judge.** The
   gate-runner writes `quality-scan.log` with the SHA it ran on; the
   Stop hook refuses to end a turn in phases 4–7 without a log for the
   current `HEAD`; review runs in a fresh subagent that sees only the
   diff, the plan and a rubric, and every blocking finding is
   cross-verified by a refuter before it is reported.
6. **Reuse, don't invent.** Run state lives in SDD's own workspace
   (`.superpowers/sdd/<plan-basename>/`, gitignored). Guards went into
   the existing `bash-guard.sh`. The gate went into the existing Stop
   hook. The panel is a saved Workflow.

## 2. Verified defects in the original command (2026-09-05)

Each item was checked against the file, the harness, GitHub, or the docs.

- `allowed-tools` listed `mcp__Claude_Preview__*` (does not exist; the
  browser surface is `mcp__Claude_Browser__*`) and `Task` (the dispatch
  tool is `Agent`); it omitted `Skill`. Per the docs the grant is
  pre-approval for one turn that clears on the next user message — so it
  expired after Phase 1's brainstorming exchange, before the write-heavy
  phases. It also pre-approved `Bash(gh:*)`, which includes the exact
  commands a `dev`-ceiling run must never issue. Restriction has to come
  from a hook, not from this list.
- No `disable-model-invocation: true` on a pipeline whose terminal state
  is a production deploy. The docs name this field for "workflows with
  side effects".
- "Wait for the **8 required checks**": branch protection on `dev` lists
  9. No other file hardcoded a count; the command invented one and it
  drifted.
- The Railway URL and the ASGI blind spot were inlined, duplicating
  `deploy-release` and `web-testing`, which the command itself named as
  the sources of truth.
- `--dry-run` was defined twice with incompatible stops (Phase 5 "stop
  here regardless of ceiling"; Phase 6 "also stops here after
  preflight"). Phase 0 both defaulted `TARGET` to `dev` and asked when
  `--to` was absent.
- Phase 6 gated on a binary reading of `/preflight`, which emits three
  verdicts (GREEN, GREEN with notes, RED). Ruling: GREEN with notes
  proceeds; RED halts.
- Phase 7 had no failure branch: after production changed, red smoke
  ended in a report. `deploy-release §Rollback` already had the fast
  path (redeploy last green image) and the slow path (`git revert` on
  `main`).
- Phase 7 checked only the backend; Vercel deploys the frontend on push,
  ahead of CI, so a red `main` leaves a new bundle live against the old
  API. The bundle-hash check existed in memory and not in the command.
- Phase 5 armed auto-merge without checking whether another PR was
  armed (CLAUDE.md merge-train rule; GitHub's merge queue is still
  org-only).
- Phase 3 reimplemented `subagent-driven-development` inline without
  its ledger, its 5-round cap or its per-task review seat — and
  contradicted its stop condition on pushing to a shared branch without
  saying so.
- The panel told five reviewers "find what kills it" and then required
  "no blocking objection": a reviewer prompted for gaps reports some
  (docs caveat). No severity rubric, no round cap, no defined agents;
  subagents ran in the main checkout and received no auto-memory, so
  the prumo lessons never reached them.
- `Bash(railway:*)` was pre-approved for Phase 7 while `railway domain`
  with no arguments creates a domain — a footgun that fired twice, once
  with the memory already on file.
- Two runs that week (both `--to dev`); the `--to prod` path had
  plausibly never executed. No eval fixtures existed. One run's summary
  recorded lanes needing a second attempt after a rate limit.

## 3. What was built

### Seats (`.claude/agents/`)

| Seat | Agent | Context shaping |
|------|-------|-----------------|
| orchestrator | the main session running `ship-spec` | holds ceiling, paths, ledger, schema'd results |
| implementer | `ship-implementer-backend` / `ship-implementer-frontend` | `skills:` preload (TDD + domain + web-testing), `memory: project`, `maxTurns: 60`, no `Agent` |
| reviewer | `ship-reviewer` | `skills: [code-review]`, read-only (`disallowedTools: Edit, Write`), dispatches the verifier |
| verifier | `ship-verifier` | read-only, no `Agent`; one finding, refute-or-confirm with evidence |
| gate-runner | `ship-gate-runner` | `Bash, Read` only; writes `quality-scan.log` with `sha=<HEAD>`; returns failures only |
| shipper | `ship-shipper` | `Bash, Read` only; merge-train precheck; never targets `main` |
| panel | `.claude/workflows/ship-panel.js` | five lenses in parallel → dedup → two refuters per blocking finding (`agentType: ship-verifier`) |

Two corrections reality forced on the earlier draft: implementers are
split by layer so each preloads ~25 KB of skills instead of ~45 KB, and
`isolation: worktree` was dropped — SDD's brief already names the
worktree path, and a per-agent worktree would put the implementer's
commits on a branch the orchestrator then has to merge. Every agent
body carries the lessons subagents cannot get from auto-memory
(worktree discipline, ASGI blind spot, head-pin, ownership guards,
React Compiler rules, copy keys, knip, jsdom limits).

### Escalation protocol

Workers return `status: done | blocked` with `question`, `options` and
`cost_if_wrong`. The orchestrator rules from the spec, the plan or
`CLAUDE.md` when it can (SDD "Rulings, not stalls"), ledgers the ruling,
and resumes the *same* worker via `SendMessage`; otherwise it asks the
user one question and resumes the worker with the answer.

### Run state

```
<main checkout>/.superpowers/ship-spec/<plan-basename>/   read by the hooks; survives SDD's cleanup
  state             ceiling=<dev|staging|prod>  phase=<0-8|halted|done>  preflight=GREEN@<sha>|RED@<sha>
                    worktree=<absolute path of the run's working tree>
  quality-scan.log  gate output; first line `sha=<HEAD it ran on>`
<run worktree>/.superpowers/sdd/<plan-basename>/          SDD's workspace (deleted after a clean final review)
  progress.md       the ledger (rulings, task completions, questions, KPI line)
```

The hooks resolve the main-checkout root through the common git dir
(`git rev-parse --git-common-dir`), so the main checkout and every
worktree read the same state; the Stop hook compares the gate log with
`HEAD` of the recorded `worktree=`. This replaced the first draft's
single SDD-owned directory after review found that SDD deletes it on
success (which would have silently removed the ceiling) and that the
hook's root and the worktree's `HEAD` differ in worktree mode. `halted`
and `done` are terminal for every hook; a state untouched for 24 hours
is a crashed run.

### Guards (deterministic)

- `bash-guard.sh` — promotion (`gh pr create --base main`,
  `gh pr merge --merge`) and deploy (`railway up|redeploy`) commands
  resolve the single active run state: no active run → `ask` (a manual
  promotion keeps its human touch); `ceiling != prod` → `deny`;
  `ceiling=prod` promotion → requires `preflight=GREEN@<origin/dev>` on
  the exact commit, then `ask` only if the promoted range carries
  destructive DDL. Deploys are ceiling-checked only, so the rollback
  fast path (`railway redeploy`) stays one command. Also: any push
  whose refspec targets `main` → `deny`; `railway domain` → `ask`.
  Twenty tests in `.claude/hooks/tests/test-bash-guard.sh`.
- `stop-format-gate.sh` — the existing ruff-format check, plus: while a
  run state is in phase 4–7, block the turn unless
  `quality-scan.log`'s SHA equals `HEAD`. Not "any branch with a diff",
  which the earlier draft said: that would have blocked every turn of
  every session. `phase=halted` lifts it, which is how a HALT report
  ends the turn.
- `reinject-run-state.sh` — `SessionStart(compact|resume)` and
  `PostCompact`: emits the active state and the last 40 ledger lines as
  `additionalContext`; silent when no run is active.

### Noise removed on the way

- The two inline graphify hooks in `settings.json` fired "MANDATORY"
  on every grep, `ls` and read — harness files and docs included —
  about twenty times per session. Replaced by `graphify-hint.sh`:
  product source paths only, once per session.
- `.githooks/post-commit` and `post-checkout` (output of
  `graphify hook install`) had been committed in #822 despite
  CLAUDE.md saying they must not be: with `core.hooksPath=.githooks`
  they warn on every commit for anyone without graphify. Untracked and
  gitignored.
- `paths:` added to the four domain skills, so they load
  deterministically for a matching file instead of by reminder.

## 4. Slices — shipped as one PR, one commit each

All three are harness configuration and documentation; no product
code. One PR instead of three because the merge-train serialises PRs
and there is nothing here that benefits from separate CI runs.

- **Slice 1 — guards and rot.** `bash-guard.sh` + tests; the command
  rewritten (frontmatter, no hardcoded constants, contradictions
  resolved, preflight tri-state ruling, Phase 7 rollback and bundle
  hash, SDD push ruling, merge-train precheck) and moved to
  `.claude/skills/ship-spec/SKILL.md`; `.githooks` untracked.
- **Slice 2 — delegation and context.** Six agents; Stop hook extended;
  re-inject hook; `settings.json` (`autoCompactWindow`, hook
  registrations, graphify hint); `CLAUDE.md` compaction block and
  hook-enforced-promotion note; `paths:` on the domain skills.
- **Slice 3 — orchestration and evals.** `ship-panel` workflow;
  `/merge-train` command; `evals/evals.json` with four fixtures
  (dry-run dev, from-plan, forced-red HALT, dev-ceiling attempting
  `main`) and the fixture specs/plan they reference.
- **Slice 4 — staging rung (deferred).** `--to staging` is one row in
  the ladder once a Railway environment, a Vercel alias and a Supabase
  branch exist.

## 5. Open questions (the user's)

- Reviewer model: pinned to the strongest tier or `inherit`? Shipped as
  `inherit`; the orchestrator can override per dispatch.
- `autoCompactWindow`: `350k` is a starting point; revisit after two
  runs with the status line.
- Whether `/promote` should also exist as a standalone entry point for
  a promotion with no code change (re-promote after a wedge).

## 6. Verified / not yet verified

**Fresh-context review round (2026-09-06).** A read-only reviewer
subagent that saw only the diff found three blocking defects and eleven
advisories, all with reproduced evidence, all fixed in the same PR:
the ceiling regexes required whitespace after `main`/`--merge`, so a
closing quote, `;` or `bash -c "…"` bypassed them (now the command is
normalized, prose-flag values dropped, quotes removed, and split into
simple commands — 44 guard tests, including every bypass and the
false-positive chains such as `git fetch origin main && git push origin
feature`); SDD's `rm -rf <workspace>` would have deleted the run state
(state moved to `.superpowers/ship-spec/`); the Stop hook compared the
launch checkout's `HEAD` with a log written from the worktree
(`worktree=` recorded in state, hooks resolve the root through the
common git dir); the DDL scan matched `downgrade()` bodies (upgrade only,
read from `origin/dev`); a dead lens read as "covered, 0 findings"
(`null` kept); `--dry-run` still dispatched the shipper (it no longer
does); force-push-to-main asked instead of denying (rule order);
`halted` and whitespace-padded phases counted as live (terminal, trimmed,
24 h staleness); `-m`, `-Bmain`, `--rebase`, env-prefixed and
absolute-path invocations slipped (covered). The guard test is now a
fitness check in `scripts/fitness/run_all.sh`, so CI runs it.

Verified on 2026-09-06, in the worktree, with output read:

- `test-bash-guard.sh`: 44/44 (incident rules; quote/`;`/`bash -c`/
  `-Bmain`/`-m`/env-prefix/absolute-path bypasses denied; command chains
  and PR bodies mentioning `--base main` allowed; no-run `ask`; dev
  `deny`; prod without/with stale/with RED preflight `deny`; prod with
  fresh GREEN allowed; `railway redeploy` allowed at prod; `done`,
  `halted` and whitespace-padded states ignored). Also runs as a fitness
  check in `scripts/fitness/run_all.sh` (16/16 checks green).
- Stop hook: blocks in phase 4 with no log; passes once the log's SHA
  equals `HEAD`; ruff check unchanged.
- Re-inject hook: silent with no active run; emits state + trust line
  when one exists.
- Graphify hint: fires once per session on a `frontend/` read and on a
  `grep` over `backend/app/`; silent on `.claude/` files and on the
  second call.
- `ship-panel.js` parses as a workflow body with matching phase titles;
  `settings.json` and `evals.json` are valid JSON; the docs frontmatter
  check passes.

Not yet exercised:

- A live `/ship-spec` run on the new command, and a live `ship-panel`
  run (the Workflow tool needs an explicit opt-in; the first real
  `/ship-spec` invocation is the test). Evals 1–4 are written, not run.
- `autoCompactWindow` at project-settings scope (the docs describe the
  user-settings path; confirm with `/autocompact` on the next session).
- The `memory: project` field on agents (needs auto-memory enabled,
  which it is). An earlier draft of this review claimed the memory
  index was over its load limit; that was not verified and was wrong
  (11 KB) — the real memory debt was 96 topic files no longer in the
  index, consolidated in the same session.
- `SessionStart`/`PostCompact` hooks under a real compaction; their
  output contract matches the documented `additionalContext` form.
