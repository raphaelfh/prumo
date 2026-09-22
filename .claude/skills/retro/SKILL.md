---
name: retro
description: Retrospective on a coding session that turns its mistakes and friction into changes to prumo's agent environment.
disable-model-invocation: true
---

You are suggesting improvements to the coding agent's **environment** so future runs go better. You propose; the user decides. Change nothing until they pick.

## Steps

1. Load `writing-for-agents` for the style rules any proposed text must follow.

2. Read the primary sources for the session the user names; default to the current one. Past sessions are JSONL transcripts under `~/.claude/projects/-Users-raphael-PycharmProjects-prumo*/`. For `/ship-spec` runs, also read the ledger and gate log under `.superpowers/ship-spec/`.

3. Find candidates in these categories. Each names where the fix lands on prumo, strongest first:

   - **Automated checks.** The agent made a mistake a machine could catch. Land it as a script in `scripts/fitness/` (wired through `run_all.sh`), a ratchet baseline, a lint rule, or a hook in `.claude/hooks/`. _Use when_ a mistake was mechanical.
   - **Review rules.** The reviewer missed a mistake. Add or sharpen an item in the `code-review` checklist or `.claude/agents/ship-reviewer.md`. Standards belong to review, which has the least context pressure, not to implementation. _Use when_ a defect reached a PR.
   - **Navigation.** Finding the right file or doc took too long. Add a pointer in AGENTS.md, a skill description, or `.claude/rules/`. _Use when_ exploration dominated the session.
   - **Information access.** A crucial fact was unavailable: server logs, CI output, prod state. Propose a command, MCP, or runbook line. _Use when_ the agent guessed at a fact.
   - **Tool economy.** A tool call was expensive or repeated. Propose a script or a narrower command. _Use when_ output was dumped and re-read.
   - **Steering files.** AGENTS.md or a skill carries a no-op, a duplicate, or a line that belongs in a gate. Propose the deletion. _Use when_ steering files have grown.
   - **Memory.** A non-obvious fact not derivable from the repo. This is the weakest landing spot: prefer every category above when one fits. Check `MEMORY.md` for an entry to update before proposing a new one.

4. Present candidates in order of severity. For each: what went wrong (quote the transcript), the category, the exact file and change, and what would now catch it. Stop and let the user choose.

Adapted from mattpocock/skills (MIT).
