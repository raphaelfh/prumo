---
description: One tick of prumo's merge-train — when no PR into dev is armed, arm auto-merge on the oldest CLEAN one; update-branch any BEHIND PR; report. Idempotent and read-mostly, designed for `/loop 10m /merge-train`. Never merges by hand, never touches main.
argument-hint: "[--dry-run]"
disable-model-invocation: true
allowed-tools:
  - Bash(gh:*)
---

# /merge-train — one tick

User-supplied arguments: `$ARGUMENTS`

`dev` is strict (up-to-date required) and GitHub's merge queue is
org-only, so this repo's queue is a convention: **one armed auto-merge
at a time** (CLAUDE.md § Branch & merge). Two armed PRs go `BEHIND` and
invalidate each other. This command is the mechanical part of that
convention, so a human never has to babysit it. Run it once, or on a
loop: `/loop 10m /merge-train`.

## Tick

1. **Inventory.**

   ```bash
   gh pr list --base dev --state open \
     --json number,title,isDraft,autoMergeRequest,mergeStateStatus,reviewDecision,createdAt \
     --jq 'sort_by(.createdAt)'
   ```

   Ignore drafts. `autoMergeRequest != null` means armed.

2. **If one PR is armed:** the train is occupied.
   - `mergeStateStatus == BEHIND` → unstick it with
     `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/update-branch` (never a
     hand rebase; never `@dependabot rebase` a grouped PR — it recreates
     the PR under a new number).
   - Otherwise report and stop. Do not arm a second PR.

3. **If more than one PR is armed:** the convention was broken. Report
   the numbers; disarm all but the oldest with
   `gh pr merge <n> --disable-auto`, then treat the oldest as the armed one.

4. **If none is armed:** pick the oldest non-draft PR whose
   `mergeStateStatus` is `CLEAN` and arm it:

   ```bash
   gh pr merge <n> --auto --squash
   ```

   Squash is the only method into `dev`. If no PR is `CLEAN`:
   `BEHIND` ones get update-branch (they re-run CI and become CLEAN on a
   later tick); `BLOCKED` / `UNSTABLE` ones are reported with the failing
   check names (`gh pr checks <n>`), never armed.

5. `--dry-run`: print what steps 2–4 would do; run nothing that writes.

## Hard limits

- Never `gh pr merge` without `--auto`; never `--merge` or `--rebase`;
  never anything with `--base main` or against `main`. Promotion is
  `/ship-spec --to prod` or `deploy-release`, and the ceiling hook in
  `.claude/hooks/bash-guard.sh` denies it here anyway.
- Never close, edit or comment on a PR.

## Report

One block, always:

```
## MERGE-TRAIN
armed: #<n> <title> (<mergeStateStatus>) | none
action: armed #<n> | update-branch #<n> | disarmed #<n>,#<m> | none
waiting: #<n> <status>, ...
```
