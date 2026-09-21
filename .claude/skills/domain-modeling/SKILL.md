---
name: domain-modeling
description: Build and sharpen prumo's domain model while designing. Use when a domain term is fuzzy, contested, or new, when editing the extraction/HITL glossary, or when recording or amending an ADR.
---

# Domain Modeling (prumo)

Actively sharpen the domain model as you design: challenge terms, invent edge-case scenarios, and write the glossary and decisions down the moment they crystallise. Merely *reading* the glossary for vocabulary is not this skill; any skill does that. This skill is for when you are changing the model.

## Where the model lives

- **Glossary, canonical**: `docs/reference/extraction-hitl-architecture.md` §6. One entry per term, as a top-level bullet: `- **Term** — definition.`
- **Glossary, mirror**: `.claude/skills/architectural-quality-loop/references/concept-glossary.md`. A compact copy the quality loop scans against. `scripts/fitness/check_glossary_sync.py` fails when a mirror term is missing from §6.
- **User-facing vocabulary**: §2.1 of the same doc lists words the UI uses instead of internal ones (the UI never says "Run"). Keep internal and user-facing words apart.
- **Decisions**: `docs/adr/NNNN-slug.md`, MADR format, template at `docs/adr/0000-template.md`.

There is no root `CONTEXT.md` on prumo. Do not create one: a second glossary is the drift this repo's gate exists to stop.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with §6, call it out immediately. "The glossary defines ReviewerState as the materialized latest decision, but you seem to mean the decision itself. Which is it?"

### Sharpen fuzzy language

When the user uses a vague or overloaded term, propose the precise canonical one. "You're saying 'answer': do you mean a ProposalRecord or a ReviewerDecision? Those are different things."

### Discuss concrete scenarios

Stress-test relationships with specific scenarios that probe edge cases: two reviewers, a reopened consensus, a template edited mid-run, a `many`-cardinality section with zero instances.

### Cross-reference with code

When the user states how something works, check whether the code agrees. Surface contradictions: "The service rejects edits after finalize, but you just said managers can amend. Which is right?"

### Update the glossary inline

When a term is resolved, edit §6 right there, and mirror the change in `concept-glossary.md` in the same commit. Then run:

```bash
python3 scripts/fitness/check_glossary_sync.py
```

Rules for an entry:

- **Be opinionated.** When several words exist for one concept, pick one and name the rejected ones in the definition ("not 'answer'").
- **Keep definitions tight.** One or two sentences. Define what it IS, not how it is implemented; table and column names are fine as anchors, code paths are not.
- **Only domain terms.** General programming concepts don't belong, even if the project leans on them.
- **Bump `last_reviewed`** in the doc's frontmatter.

### Offer ADRs sparingly

Offer an ADR only when all three are true:

1. **Hard to reverse**: changing your mind later is costly.
2. **Surprising without context**: a future reader would wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons.

If any is missing, skip the ADR. When writing one:

- Copy `docs/adr/0000-template.md`. Number it one above the highest existing file.
- Frontmatter needs `status` (`proposed`, `accepted`, `rejected`, `deprecated`, `superseded`), `last_reviewed`, `owner`, `adr_number`. `bash scripts/docs/check-frontmatter.sh` validates it.
- Drop template sections that add nothing. A short Context plus Decision Outcome is a complete ADR.
- Never edit a past decision. Supersede or amend it, and link both ways in the status block.
- Per `code-review` §K, the ADR lands in the same PR as the code that makes the decision.

Adapted from mattpocock/skills (MIT).
