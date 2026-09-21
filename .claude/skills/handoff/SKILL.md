---
name: handoff
description: Compact the current conversation into a handoff document a fresh session can pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document so a fresh agent can continue the work. Save it in the session scratchpad directory, or `$TMPDIR` when there is none, never in the repo. Print its absolute path.

Include, in this order:

1. **Goal and state.** What the work is for, what is done, what is next. One short paragraph.
2. **Where things are.** Branch, worktree path, PR link, and for `/ship-spec` the ceiling and the run-state path.
3. **Modified files.** The list, or the `git diff --stat` base to recompute it.
4. **Evidence.** Every test or gate command with its last result and the SHA it ran on. Say "not run" where true.
5. **Open questions and rulings.** Decisions the user made, and questions still open.
6. **Suggested skills.** Which skills the next agent should load first, and why.

Reference existing artifacts instead of copying them: specs, plans, ADRs, ledgers, PRs, commits. Point by path or URL.

Redact secrets, tokens, and personal data.

If the user passed arguments, treat them as the next session's focus and tailor the document to it.

Adapted from mattpocock/skills (MIT).
