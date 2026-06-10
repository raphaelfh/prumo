# Receiving feedback (prumo)

Reviewers are colleagues, not customers. You owe them a technical response, not a customer-service performance.

## The response pattern

`READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT`

| Step      | What it means                                                                                          | What it is not                                                |
| --------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| READ      | Read the entire comment. Read the surrounding comments.                                                | Skimming the first sentence.                                  |
| UNDERSTAND| Restate the comment in your head. Identify the underlying concern, not just the surface ask.            | Inferring the "vibe" and moving on.                           |
| VERIFY    | Open the file. Run the suggested check. Confirm the reviewer's premise is correct.                      | Trusting the reviewer's claim about your code.                |
| EVALUATE  | Decide: do I agree? Disagree? Need clarification? What's the cost vs benefit?                           | Skipping straight to "OK I'll do it".                         |
| RESPOND   | Reply on the diff before implementing. Either commit to the change or explain the disagreement.         | Silent implementation. Silent rejection.                      |
| IMPLEMENT | Make the change. Mark resolved. Or open a follow-up issue and link it.                                  | Implementing and hoping no one notices it wasn't quite what they asked for. |

The most-skipped step is VERIFY. The reviewer is human, possibly tired, possibly looking at a stale diff, possibly missing context you have. Verifying their claim is not disrespect — it's the only way to give them a useful response.

## Banned phrases (performative agreement)

These commit you to changes you haven't evaluated. They are noise, not engagement.

- "You're absolutely right!"
- "Great catch!" / "Great point!"
- "Thanks for the feedback!"
- "Good idea, let me do that."
- "Sure, will do!"

Replace with one of the four real responses.

## The four real responses

### 1. Restate the requirement

```
> "This should use ensure_project_member, not just the auth dependency."

You're asking me to add ensure_project_member at line 88 because the
current handler only checks token validity, not project membership.
Confirming — fix incoming.
```

This forces you to actually understand what's being asked, and proves to the reviewer you understood. If your restatement is wrong, the reviewer corrects you cheaply before you ship the wrong fix.

### 2. Ask a clarifying question

```
> "Wrap this in a transaction."

Do you mean the full handler, or just the two-statement state
transition at lines 142–148? I'd prefer the narrower scope so the
read at line 130 stays outside the lock, but happy to widen if there's
a consistency concern I'm missing.
```

Only use when you genuinely don't know. Not as a stall, not as a passive-aggressive "what do you mean".

### 3. Push back with technical reasoning

```
> "This is going to N+1."

I think it isn't — line 67 does a selectinload of the relationship,
and the per-item access at line 89 hits the already-loaded collection.
I just ran `SQLALCHEMY_ECHO=1` and saw a single query for the run plus
one for the children. Did you have a different access path in mind?
```

Always with evidence: `file:line`, command output, doc reference. Never "I disagree because I think so."

### 4. Just start working

When the request is clear, correct, and small — implement, push, mark resolved. No ceremony.

## When to push back

Push back when the suggestion is:

- **Factually wrong** about your code. Grep / file:line proves it.
- **More expensive than the problem.** "Add a metric for this" is fine in principle, but if the metric is only useful in 0.01% of cases, it's not free.
- **YAGNI.** "We might want X someday" is not a reason to add X now. Grep for usage — if there are zero callers, it's speculative.
- **In conflict with the architecture docs.** `docs/reference/extraction-hitl-architecture.md` and `docs/reference/migrations.md` are load-bearing.
- **Style preference dressed as correctness.** "Tabs vs spaces" disguised as "this doesn't follow conventions" — call it out politely.

## When to defer to the reviewer

- The reviewer is the **domain owner** of the touched code and you are not.
- The reviewer is the **architecture owner** for the area (HITL stack: see `docs/reference/extraction-hitl-architecture.md`).
- The reviewer has more **production context** (recent incidents, known constraints you weren't part of).

When you defer, defer fully — implement what they asked, don't add a reluctant comment about it.

## Handling "show me the evidence" politely

You can ask the reviewer to ground a vague comment in evidence without sounding combative:

```
> "This feels off."

Could you point me to the specific line that's off, or the behavior
you'd expect to see? I want to make sure I'm fixing what you have in
mind rather than guessing.
```

The reviewer's instinct is sometimes right but underspecified. Pulling out the underlying concern saves both of you a round-trip.

## Triage of multiple comments

When a review lands with N comments, triage before responding:

1. **Critical** — security, correctness, data loss. Fix now. Block the PR on these.
2. **Important** — bug-class risks (BOLA, TOCTOU, error swallowing), test gaps, doc drift. Fix in this PR.
3. **Minor** — style, naming, minor refactor opportunity. Fix if cheap, defer otherwise.
4. **Out of scope** — "while we're here" suggestions that double the PR. File a follow-up issue, link in PR body, reply with the link.

Respond to every comment. Silent drops erode reviewer trust.

## When the reviewer is wrong

It happens. You verified, you have the evidence, the suggestion is wrong. Don't:

- Implement it anyway "to avoid conflict".
- Sneer in the reply.
- Argue without evidence ("but I think...").

Do:

- Reply with the evidence (`file:line`, command output, doc link).
- Offer an alternative that addresses the underlying concern, if there is one.
- Ask the reviewer to confirm before you mark resolved.

## When you're wrong

Equally common. You pushed back, the reviewer doubled down with new evidence, and they're right. Don't:

- Concede performatively ("oh wow, you're absolutely right!").
- Hide the original push-back by deleting the thread.

Do:

- "You're right — I missed that X. Fixing." (One line. No ceremony.)
- Mark the thread resolved when fixed.
- Carry forward: if this is a recurring class of mistake, note it in your own memory.

## After implementation

- Push the fix as a **new commit**, not an amended one. The reviewer wants to re-review the delta, not your full PR.
- Reply on the thread: "Done in commit `abc123`."
- Mark the thread resolved.
- Don't squash until just before merge, and only with reviewer approval.

## Receiving feedback from AI agents

AI-generated review comments are a fast first pass, not a verdict. Apply the same standard you would to a human reviewer with less context:

- Demand `file:line` or a command. "This pattern is bad" without a line number is noise.
- Verify the AI's claim before implementing. Hallucinated reviews exist.
- Don't disregard wholesale — sometimes the AI sees a real pattern. Just verify.

## Bottom line

Technical correctness over social comfort. Verify, then respond. Push back when wrong, implement when right. Never the performative-agreement script. Reviewer time is the scarcest resource — protect it by giving real responses, not customer-service replies.
