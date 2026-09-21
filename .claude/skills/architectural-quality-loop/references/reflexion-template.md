# Reflexion template

Between VERIFY (judge returns `RESOLVES`) and CONVERGE, the orchestrator appends a Reflexion paragraph to the iteration's md file. Two lines, no more. Cheap; catches blind spots the gates miss.

## The template (verbatim)

```markdown
## Reflexion (iteration <n>)
**What could still go wrong:** <≤ 2 sentences naming the most plausible residual risk despite the gates being green>
**What I'd do differently next time:** <≤ 2 sentences naming a concrete change to the loop, the prompts, or the gates; "nothing" is acceptable if honest>
```

## Worked examples

```markdown
## Reflexion (iteration 001)
**What could still go wrong:** The dropped function's name went into check_retired_symbols.py's RETIRED list, which scans only .py/.ts/.tsx under backend/app, backend/tests and frontend, so a future migration that recreates the function would slip through.
**What I'd do differently next time:** Pair every retired SQL object with a schema-drift test that asserts it stays dropped, like `test_check_cardinality_one_stays_retired`.
```

```markdown
## Reflexion (iteration 002)
**What could still go wrong:** The new integration test passes against the seeded data the factory provides, but does not cover the case where two reviewers race to insert the same (run, instance, field) tuple — the deferred unique index would catch it at commit time, but the test doesn't exercise that path.
**What I'd do differently next time:** Add a `test-gaps` subagent prompt heuristic that flags "missing race-condition test" when the function under test holds a row lock or relies on a unique index.
```

```markdown
## Reflexion (iteration 003)
**What could still go wrong:** Nothing material — the diff is small, the gates are comprehensive, and the counterfactual probe confirmed the fix is non-vacuous.
**What I'd do differently next time:** Nothing.
```

## Why this is non-optional

Iteration-end reflection is the cheap version of post-mortem culture. Skipping it leaves blind spots in the loop's own design. Two-line cost; one production incident saved per quarter justifies it forever.

## Where the reflexion goes

Appended to `docs/superpowers/quality-runs/<run-id>/iterations/<n>-<finding-slug>.md`, after the `## DIFF` section, before any `## Judge verdict` summary. Final layout of an iteration md:

```
# Iteration <n> — <finding slug>

## Finding (from findings.jsonl)
...

## PLAN
...

## DIFF
- commit: <sha>
- LOC added: X, removed: Y
- files: ...

## Gate output (verify_all.sh)
...

## Counterfactual probe
...

## Judge verdict
RESOLVES
<justification line>

## Reflexion (iteration <n>)
**What could still go wrong:** ...
**What I'd do differently next time:** ...
```
