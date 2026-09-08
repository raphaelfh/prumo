---
status: approved
last_reviewed: 2026-09-08
owner: '@raphaelfh'
---

# `/ship-spec` v3 — the model holds opinions, never facts — design

> Supersedes `docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md`
> (now `status: superseded`). v2 asked *what machinery should exist*; every
> answer it gave is still standing. v3 asks the question the first live run
> forced: *who is allowed to state a fact about the run*.
>
> The one-line thesis: **v2's engineering was sound and its self-knowledge was
> not.** The run's own account of itself — timestamps, phase markers, gate
> results, KPI counts — was authored by the model into files the hooks then
> trusted. v3 moves every one of those facts behind a script the model calls
> and a hook that stops the model writing them by hand. Nothing in v2's
> topology is being rethought; the guards it built are the parts that held.

## 1. The evidence this is built on

The first live `--to prod` run (2026-09-07, `projects-hub-shell`, PRs #852 /
#853 / #854) plus its follow-up (#858). Every item below was verified against
mtimes, `git log` and the CI API — never against the run's own narration,
because the run's narration is the defect under study.

| Observed | Class |
|---|---|
| 8+ ledger headings up to 43 min ahead of the file's mtime | authored fact |
| `phase=3` set 27 min before the first code commit | authored fact |
| A KPI line (`questions asked, prompts, tokens`) that is unmeasurable, silently skipped | authored fact |
| A self-count of subagent turn caps that did not add up | authored fact |
| 1 of 4 prose mandates in Phase 4 actually ran | prose is not a gate |
| A truncated gate log with a correct `sha=` passed the Stop hook twice | presence-check, not content-check |
| 12 spec claims contradicted the tree; 1 prescribed a constitution violation | leverage is upstream |
| Halted on a leftover fixture in the shared local Supabase, CI green on the same SHA | the laptop is not the clean room |
| 6 subagent turn caps in one run; `SendMessage` absent in the desktop app | seats die |
| 3 slugs for one run; 4.5 h in which a compaction would have restored no ledger | identity decided late |
| 5 flags → 32 modes, 4 evals, 0 executed | unwalked paths |

`#858` already fixed the second half of that table: the gate log is
content-checked (`QUALITY_SCAN_EXIT=0`, no `SKIP`/red), the panel keeps
`unverified` findings blocking, the reinject hook falls back to the newest
ledger, one basename is fixed in Phase 0, and `ledger-clock.sh` stamps the true
time beside every ledger edit. **v3 finishes the first half**: the facts
themselves.

A thirteenth item, found while writing this spec and not present in any run
log: `.agents/` and `.codex/` existed in the working tree as untracked,
unignored snapshots of a pre-#858 `/ship-spec`, still carrying a
`--confirm-promote` flag, a `ship-gate-runner` seat and a `phase=halted first`
rule the real skill had already retired. Drift does not need a run to happen.

## 2. Decisions (locked)

1. **One writer for run state.** `scripts/ship.sh` is the only thing that
   writes `.superpowers/ship-spec/<basename>/state`. The model calls verbs; it
   never opens the file. A `PreToolUse` hook denies `Edit`/`Write` against that
   path, so this is a mechanism and not an instruction.
2. **CI is the arbiter; the laptop runs a fast subset.** `.githooks/pre-push`
   already states this policy for humans — *"the heavy gates stay in CI"* — and
   `/ship-spec` was the only place in the repo contradicting it. The local gate
   becomes ruff + tsc on changed layers plus the touched suite (~2 min). The
   authoritative gate is the branch-protection contract on `dev`: 9 required
   contexts, `strict: true`.
3. **Pending CI is an allowed turn end.** The Stop hook blocks a *lie* (a
   recorded green the API contradicts) and blocks *promotion* without success
   on the promoted SHA. It never blocks waiting. This is deliberate: a gate
   that blocks while the thing it gates is still running is the deadlock shape
   this repo has already shipped three times.
4. **Phases are names, not numbers.** `frame → plan → build → harden → ship →
   promote → verify → done | halted`. A name cannot be off-by-one, and a hook
   condition reads as `case $phase in ship|promote|verify)`.
5. **Two flags.** `--to` and `--from-plan`. Every other mode is deleted rather
   than documented, because an unwalked path is a latent defect and 32 modes
   can never be walked.
6. **Four seats.** Two implementers, a reviewer, a verifier. The shipper
   becomes a script verb, because it was four `gh` calls wearing a 25-turn cap.
7. **`.claude/` is the single source.** No hand-copied port to another harness.
   If one is ever needed it is generated and its drift is gated in CI.

## 3. `scripts/ship.sh` — the contract

Bash, no dependencies beyond `git`, `gh` and `jq`, all already required by the
hooks. Every verb is idempotent and every verb stamps its own clock.

| Verb | Writes | Refuses when |
|---|---|---|
| `init <basename> --to <ceiling>` | `ceiling`, `phase=frame`, `worktree`, `orchestrator=$(pwd)`, `started=<clock>` | a live run already names this orchestrator |
| `phase <name>` | `phase`, `<name>_at=<clock>` | the transition is not legal from the current phase, or `promote` is entered without `preflight=GREEN@<origin/dev>` |
| `gate` | `gate.log` with `sha=<HEAD>` first | never; exits non-zero on red |
| `ci [sha]` | `ci=GREEN@<sha>` or `ci=RED@<sha>:<contexts>` | never; it reports, it does not judge |
| `dev` | `pr=<url>`, `train=<armed\|queued behind #n>` | the tree is dirty, or the branch is `dev`/`main` |
| `preflight-record <verdict>` | `preflight=<verdict>@<sha>` | `GREEN` while `ci` on the same SHA is not green |
| `facts` | nothing — prints | never |
| `halt <reason>` / `done` | `phase=halted\|done`, `ended=<clock>` | never |

Two of these deserve their rationale stated.

**`ci` is a read of `repos/{owner}/{repo}/commits/{sha}/check-runs`**, measured
at 0.49 s. Green means every one of the 9 required contexts is `success`
**and** no check-run on that SHA is `failure`, `timed_out`, `cancelled` or
`action_required`. The second clause is what makes markdownlint count: it is
not a required context, yet it produced the only red of the first prod run.
`skipped` (Supabase Preview) is not a failure.

**`facts` is the whole Phase-8 run-facts block**, derived from the state
file's own mtimes, `git log --oneline origin/dev..`, the PR, and the CI API.
The model pastes it. It cannot author it, which is the entire point: the v2
skill said those facts were "every one machine-derived" and they were not,
because saying so was the only thing making it true.

### What the model still decides

Everything that is a judgement: whether a panel finding is real, whether a
ruling holds, whether a preflight note is benign, whether to halt. v3 removes
no discretion. It removes the model's ability to *assert* a measurement.

## 4. Hooks — what refuses what

Three existing hooks, one new, all keyed on the named phases.

- **`bash-guard.sh`** (unchanged in behaviour) — the ceiling. It is the single
  best mechanism in the pipeline and v3 touches only its phase vocabulary.
  Ownership is `orchestrator=` against the hook input's `cwd`; the deny path is
  evidence, not ownership.
- **`stop-format-gate.sh`** — in `harden`, requires the fast gate log for HEAD.
  In `ship`/`promote`/`verify`, requires that any recorded `ci=GREEN@<sha>`
  still matches the API, and that `promote` is not entered without success on
  the promoted SHA. Pending is allowed. This retires the friction the first run
  paid three times: a docs commit no longer invalidates a four-minute local
  scan, because the local scan is no longer the gate.
- **`protect-run-state.sh`** (new, ~10 lines) — `PreToolUse` on `Edit|Write`,
  denies any write whose `file_path` is under
  `.superpowers/ship-spec/*/state`, naming the `ship.sh` verb to use instead.
- **`ledger-clock.sh`**, **`reinject-run-state.sh`** — unchanged.

### The constraint every one of them is written under

*A gate must not read the state it gates.* This repo has shipped that bug three
times (#847 twice, #850 once). `scripts/tests/test-ship.sh` therefore builds a
throwaway repo in `$TMPDIR` and runs there, the way `test-bash-guard.sh`
already does, so `ship.sh`'s own test can never go red merely because a run is
live. Any new reader of run state must answer *whose run is this* before it
acts, and shared visibility is never ownership.

## 5. Phases

| Phase | Does | Human? |
|---|---|---|
| `frame` | brainstorm if needed, then the spec gate: a read-only seat returns a reconciliation list, and a non-empty list never becomes a plan | yes — the brainstorm |
| `plan` | `writing-plans`, then the panel (6 lenses, cross-verified, 4 arrays) | no |
| `build` | SDD: fresh implementer per task, task review after each | no |
| `harden` | reviewer on the whole diff, then the fast local gate | no |
| `ship` | `ship dev` — precheck, push, PR, arm; then CI is the gate | no |
| `promote` | preflight, then the merge-commit PR the ceiling hook allows | yes — only if the range carries a destructive migration |
| `verify` | post-deploy smoke, health, bundle content, contract probe | no |

Two human touchpoints, both already true in v2 and both preserved: the spec,
and the destructive-migration ask. `harden` and `ship` are one phase in
practice — a two-minute gate does not deserve a phase boundary — but they stay
distinct names because the Stop hook's predicate genuinely differs across them.

Leverage stays upstream. All three human interventions of the first run were
*"the spec is silent on X"*, and the run's worst near-miss — a deleted error
surface rendering as a permanent `aria-hidden` shimmer — was born in the spec
and inherited by the plan. The `frame` phase's checklist is the cheapest gate
in the pipeline and it runs before a line of code exists.

## 6. Deleted

- **Flags**: `--dry-run` (two contradictory definitions in one file: Phase 0
  said "stops after the panel", Phase 5 had a live branch printing a would-be
  PR body), `--no-worktree` (`--from-plan` covers it), `--no-automerge` (the
  train precheck already queues instead of arming).
- **The `staging` rung** — in the ladder since v2 with no infrastructure behind
  it.
- **`ship-shipper`** — becomes `ship dev`. Its clean-tree precheck is the one
  that refused Phase 5 on every run until `.claude/agent-memory/` was ignored.
- **Phase 4's four-row lane table** — it named 4 lanes CI runs that the local
  gate does not. CI runs 20 jobs; `verify_all.sh` runs 12 lanes. The 14-row
  gap is not filled, it is dissolved: with CI as the arbiter the table has
  nothing to say.
- **`.agents/`, `.codex/`** — deleted and gitignored.

`scripts/verify_all.sh` is **not** changed. It remains the
`architectural-quality-loop`'s gate, where its 12 lanes are exactly right. It
simply stops being `/ship-spec`'s arbiter.

## 7. Definition of done

Not the eval suite. **One trivial spec — a single UI copy key — driven through
`/ship-spec --to prod` untouched, landing in production.**

Phases 6–8 of v2 have never executed: the one prod landing to date was a human
merge plus a human verification, not the pipeline's. Every remaining defect
lives in that unexecuted stretch, and no synthetic eval will find it — the
first live run found eleven defects in an hour that five rounds of adversarial
review had missed.

The eval suite (4 modes, all now reachable) is the regression net *after* that
run, not the proof before it.

## 8. Verified while writing this spec

Claims here were checked against the tree, not recalled. Treating a spec's
concrete claims as hypotheses is itself one of the lessons.

- `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` returns per-check
  conclusions in **0.49 s** — inside the Stop hook's 30 s budget. Verified on
  `b055ddaf`.
- Branch protection on `dev`: **9 required contexts**, `strict: true`.
- CI runs **20 jobs** across 6 workflows; `verify_all.sh` runs **12 lanes**.
- `.githooks/pre-push` already implements the fast local subset and already
  documents the CI-is-the-arbiter policy.
- `docs/superpowers/plans/**` and `specs/2026-*-design.md` are already globbed
  into `.markdownlintignore`; `**/docs/superpowers/**` is in cspell's
  `ignorePaths`. New plan and spec docs need frontmatter and nothing else.
- The `.agents/` / `.codex/` forks diverged from `.claude/` in exactly the ways
  listed in §1, confirmed by `diff`.

## 9. Not verified

- That the Stop hook's CI predicate behaves correctly against a **pending**
  run. It is designed to allow it; only a live run proves it.
- That `ship.sh dev` reproduces `ship-shipper`'s merge-train behaviour under a
  genuinely occupied train. The precheck is the same `gh` query; the seat's
  judgement around it is what is being replaced by a branch.
- Anything about Phases `promote` and `verify`, which have never run.
