# Automated PR review — orchestration contract

How any *automated* surface (the `pr-review` cloud routine, a future CI
hook, a manual "review PR N" session) runs this skill against a pull
request and posts the result. The review checklist itself lives in
`SKILL.md` + the sibling references — this file only defines the
plumbing and the output contract, so every surface produces the same
review and the knowledge is maintained in exactly one place.

## Procedure

1. **Identify the PR.** Take the PR number `N` from the trigger context
   (GitHub event payload, `pr:<N>` in the prompt text, or a PR URL).
   Fallback: the most recently opened open PR —
   `gh pr list -R raphaelfh/prumo --state open --json number,createdAt --jq 'sort_by(.createdAt)|last|.number'`.
2. **Skip drafts.** `gh pr view $N --json isDraft` — exit on drafts.
3. **Dedup (mandatory).** If any existing comment on `$N` starts with
   `## Claude review`, exit without posting. One review comment per PR,
   ever.
4. **Get the diff.** `gh pr diff $N > /tmp/pr.diff`. For full-file
   context: `git fetch origin pull/$N/head:prhead && git checkout prhead`.
   If the diff exceeds ~4,000 lines, review only `backend/app/`,
   `frontend/{services,hooks,components}/`, `supabase/migrations/`,
   and `backend/alembic/` — and say so in the summary.
5. **Review.** Apply the prumo checklist from `SKILL.md` (incident
   classes + their `references/*.md` playbooks). Skip style nits —
   ruff/eslint gate formatting. Report only findings you are confident
   about: every false positive costs the solo maintainer real time.
   Target 0–6 findings, each with `file:line` and a concrete fix.

## Output contract

Post ONE comment (`gh pr comment $N --body-file /tmp/review.md`):

```markdown
## Claude review
**Verdict:** LGTM | LGTM with nits | Needs attention
**Scope:** <one line: what the PR does, proving the reviewer understood it>

### Findings
<one bullet per finding: `severity` `file:line` — issue — suggested fix.
If none: "No findings above the confidence bar — the deterministic
gates cover the rest.">

### Incident-class sweep
<one-line-per-class table: BOLA, TOCTOU, swallowed errors, envelope,
TanStack cache, schema drift, RLS — each "ok", "finding", or "n/a">
```

## Hard rules

- Comment-only: never `REQUEST_CHANGES`, never `APPROVE`, never push,
  never edit files, never merge or close. The deterministic CI gates
  decide mergeability; this review is the second pair of eyes.
- Skip automation noise: PRs whose head branch starts with `claude/` or
  `autofix/`, unless labeled `needs-review`.
- Stay under 10 minutes; if the diff was too large to review honestly,
  state exactly which parts were reviewed.
- Machine-parseable last line of the session:
  `pr_review_done pr=<N> verdict=<lgtm|nits|attention> findings=<count>`
