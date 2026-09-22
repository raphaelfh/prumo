---
status: stable
last_reviewed: 2026-09-21
owner: '@raphaelfh'
---

# Use the agent skills

prumo's Claude Code skills come from three places: the project (`.claude/skills/`, `.claude/commands/`), the required `superpowers` plugin, and the built-in commands. This guide says which one to reach for at each step of a change, so they compose instead of overlapping.

Model-invoked skills load on their own when the task matches their description, and you can also type their name. User-invoked ones (written here with a leading `/`) run only when you type them.

## Pick the route first

- **Spec-sized change** (new capability, several layers, or a migration): run `/ship-spec`. It drives brainstorm, plan, `ship-panel` review, subagent implementation, review, and the PR, up to the ceiling you set. The rest of this guide describes what it does internally; don't run those steps by hand alongside it.
- **Small change** (one layer, a fix, a density pass): walk the steps below yourself.
- **Bug**: go straight to step 4.

## 1. Shape the problem

- `superpowers:brainstorming` for any new feature or behaviour change. It turns an idea into an agreed design.
- A domain term that is fuzzy or new: settle it in the glossary, `docs/reference/extraction-hitl-architecture.md` §6, and its mirror in the quality loop; `check_glossary_sync.py` keeps the two in step. A decision worth an ADR: copy `docs/adr/0000-template.md`.

## 2. Plan

- `superpowers:writing-plans` turns the agreed design into tasks, each with a verify step.
- `superpowers:using-git-worktrees` isolates the work. Remove the worktree once the PR merges.

## 3. Build

- The domain skills load when the task matches their description: `backend-development`, `frontend-development`, `ui-styling`, `web-testing`, and `frontend-ux` before deciding layout or density.
- `superpowers:test-driven-development` drives each task. `web-testing` says where the seam is and which test type fits.
- `superpowers:subagent-driven-development` runs independent tasks in fresh sub-agents.

## 4. Debug

- `debugging` is the entry point for any bug, failing test, or odd state. Its first gate is a red loop: one fast, deterministic command that fails on the exact symptom. No hypothesis before that command exists.
- It layers prumo's evidence map and incident classes over `superpowers:systematic-debugging`, whose `root-cause-tracing` and `defense-in-depth` files cover walking back from a symptom and closing the class of bug.

## 5. Verify and review

- `/design-review` on every screen you changed, before calling it done.
- `code-review` before any "done", PR, or reply to review. It covers the verification gate, the incident checklist, and the spec axis when a spec exists.
- `/simplify` for a quality pass on the diff; `/security-review` when the diff touches auth, ownership guards, or RLS.
- `make quality-scan` is the full local gate.

## 6. Ship

- `superpowers:finishing-a-development-branch`, then a PR to `dev`.
- `/merge-train` arms auto-merge on one PR at a time.
- `/preflight` then `/deploy-release` for a promotion to `main`. The promotion is hook-enforced; see AGENTS.md.

## 7. Improve the environment

- `/retro` after a session that went badly. It proposes where each lesson should land, strongest first: a fitness gate or hook, a review rule, a pointer, and only last a memory entry.
- `writing-for-agents` whenever you edit a skill, AGENTS.md, a rule, or memory.
- `architectural-quality-loop` finds and fixes violations of rules prumo already has, on a scoped slice.
- `/improve-codebase-architecture` proposes deeper modules in recently changed areas, as an HTML report, then walks through the one you pick. Reach for it too when an interface itself is in question: where the seam goes, whether a module is shallow. Its output is a spec for step 2, not a commit.

## Between sessions

- `/handoff` writes a handoff note outside the repo for a fresh session.
- `/wait-what` asks the agent to re-explain its last message in plain words and glossary terms.

## When two skills overlap

- Receiving and requesting review: `superpowers:receiving-code-review` and `superpowers:requesting-code-review` carry the generic process; `code-review` adds prumo's verification commands and incident checklist.
- Debugging: use `debugging`. It layers prumo's evidence and commands over `superpowers:systematic-debugging`.
- Drift versus design: use `architectural-quality-loop` for violations and `/improve-codebase-architecture` for deepening.
