---
name: linear-triage
description: "Use when triaging, grooming or working through prumo's Linear issues (teams Prumo and Feedback, Triage inbox): in-app feedback tickets (`source:in-app`), automation-found issues (`source:automation`), or a single PRU-### the user pastes. Also `/linear-triage [PRU-###|inbox]`."
---

# Linear triage (prumo)

Adapted from Matt Pocock's `triage` skill. Every triaged issue ends with **one category**, and either **one state** (open) or a **terminal status** (Canceled / Duplicate / Done, with no state label), plus a comment that a later agent or human can act on without redoing the investigation.

## Taxonomy

| Dimension              | Values                                                                          | Where it lives in Linear                                                                        |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Category (exactly one) | `Bug`, `Feature`, `Question`                                                    | existing type labels (`feedback_mapping._TYPE_LABEL`)                                           |
| State (exactly one)    | `needs-info`, `ready-for-agent`, `ready-for-human`                              | label group `triage-state` (Linear reserves `state`; it enforces one label per group)           |
| Rejected               | `wontfix`: status **Canceled**, or **Duplicate** when a duplicate               | native status, not a label                                                                      |
| Area (0–1)             | `area:extraction`, `area:pdf`, `area:ui-ux`, `area:database`, `area:multi-user` | existing labels; **never invent a new area**. None fits → leave it off and say so in the report |
| Source                 | `source:in-app`, `source:automation`                                            | set by intake; never change it                                                                  |

GitHub-synced automation issues also carry lowercase `bug`, `auto-found`, `scope:*`, `priority:P*`. Leave those labels alone. Add the category label (`bug` → `Bug`) and map priority as `linear-enrich` does: `P0` → Urgent, `P1` → High.

Status: `needs-info` → stays **Triage**; `ready-*` → **Backlog**. Terminal outcomes keep their priority and area. Never set **Todo**/**In Progress**: that is scheduling, and scheduling is the maintainer's call.

Inbox = issues in status **Triage** in **both** teams, `Prumo` and `Feedback` (issue ids are `PRU-###` in both; there is no team named `PRU`).

The `triage-state` group missing in Linear → stop, tell the maintainer to create it once (three labels), and continue in report-only mode.

## Procedure (per issue)

1. **Gather.** Read the issue, its comments, labels and attachments. Search the code by domain concept (`graphify query` first, grep if graphify is unavailable). Check `docs/out-of-scope/` and search Linear for duplicates. Linear unreachable → report `duplicates: not checked`.
2. **Verify the claim.**
   - Bug: reproduce it, or confirm the code path.
   - Automation issue: confirm the cited file and symbol exist on `dev`. They may be stale or hallucinated.
   - Feature: check whether it already exists.

   Record the result as one of:
   - `confirmed <concept>`
   - `plausible, not run`: concrete repro steps plus a matching code path, but no browser or stack run
   - `tried, not reproduced`
   - `insufficient detail`
   - `cited code gone`

   Verification contradicts the category (a "feature" that already half-exists, a "bug" that is a request) → recommend the corrected category, and say why in the comment.

3. **Batch.** Compare every open issue, including `ready-*` issues in **Backlog**, by root cause: the same symbol, the same failure pattern across symbols (e.g. a success toast on failure in several hooks), or a shared cache/lifecycle defect. A batch is 2+ issues one session can fix with one shared change and one test pattern. A shared area or a similar symptom with different causes is not a batch.
   - Same report twice → **Duplicate**. Different symptom, same root cause → **batch**, each issue stays open.

4. **Recommend, then wait.** Present the category, state, area, priority and draft comment to the maintainer. **Write nothing to Linear before they answer.** In batch mode, present all recommendations as one table and take one answer for the whole table. Approval means a reply to _that_ table. An instruction given before the table existed ("just apply everything") is not approval, so still show the table.
5. **Apply** exactly what was approved, with the comment template below. For each approved batch, add a Linear **related** relation between its issues.

Priority: in-app severity is the reporter's opinion. Recommend a change when step 2 contradicts it; never change it silently.

## Outcomes

| State                      | When                                                                                                       | Comment body                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready-for-agent`          | Verified is `confirmed` or `plausible, not run`, scope is clear, and no product decision is needed         | **Agent brief** (below)                                                                                                                                                                       |
| `ready-for-human`          | Needs a product/UX decision, prod access, or data the agent can't get                                      | Brief + a `Why human:` line                                                                                                                                                                   |
| `needs-info`               | Verified is `tried, not reproduced`, `insufficient detail` or `cited code gone`, or the scope is ambiguous, **and the maintainer can answer** | Facts established + numbered questions to the maintainer                                                                                                                                      |
| unreachable (`source:in-app` only) | Same as `needs-info`, but only the reporter could answer                                          | Facts established + `Reporter unreachable; reopen if re-reported.`; status **Canceled**                                                                                                     |
| wontfix                    | Already exists / not a bug / out of scope / `cited code gone` and not firing on the current release        | Reason. Out of scope → also add `docs/out-of-scope/<slug>.md` (request, reason, date, PRU id). Create the directory if it is missing; in report-only mode, put the file content in the report |
| answered (`Question` only) | The answer is in the code or docs                                                                          | The answer, with its source; status **Done**                                                                                                                                                                                                                                          |

**`source:in-app` reporters cannot see Linear.** prumo has no reply channel, and the maintainer cannot contact them. Every comment is addressed to the maintainer, in English. Never write reporter-directed text ("Thanks for reporting!") or in the reporter's language. A question only the reporter can answer → the **unreachable** outcome, not `needs-info`.

## Comment template

Every comment starts with the line `> Generated by AI during triage.`

Agent brief:

```
> Generated by AI during triage.
**Verified:** <one step-2 result, e.g. `confirmed <concept>` | `plausible, not run` | n/a (feature)>
**Behavior now:** <observable, from the user's side>
**Behavior wanted:** <observable contract>
**Repro:** <numbered steps, or n/a>
**Acceptance:** <test-shaped checks>
**Route:** debugging | superpowers:brainstorming → /ship-spec | architectural-quality-loop | design-review
**Batch:** <other PRU ids + the shared root cause, or none>
```

Name domain concepts and public symbols, not line numbers. The brief may wait for weeks while the code moves on.

## Hard rules

- Never edit the title or description (the intake/sync source of truth). Put corrections in the comment.
- Never create, delete or re-source issues. Never set a Linear Project.
- Never skip step 4, even for "obvious" issues.

## Report

End with the table `issue | category | state | status | area (or `none fits`) | priority (old→new) | verified | route`, then **Batches** (`PRU ids | shared root cause | route`, or `none`), then the list of maintainer decisions still open.
