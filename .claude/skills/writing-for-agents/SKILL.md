---
name: writing-for-agents
description: Style reference for documents agents consume. Use when creating, editing, or pruning a skill, CLAUDE.md, a `.claude/rules/` file, a subagent definition, or a memory entry.
---

Reference for writing any document an agent consumes: a skill, `CLAUDE.md`, a `.claude/rules/*.md` file, an agent definition in `.claude/agents/`, a memory entry, a doc reached by a pointer. The packaging differs; the writing does not: the same levers make each one predictable, since the agent takes the same _process_ every run rather than producing the same output.

When the document is a skill, also read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) for frontmatter, invocation choice, and router skills. `superpowers:writing-skills` covers the complementary part: pressure-testing a skill against a subagent before trusting it.

## prumo specifics

- **CLAUDE.md** loads on every turn of every session. It should hold navigation pointers, hard rules, and gotchas agents actually get wrong, nothing else.
- **Skills trigger on their `description`.** Never route to skills from CLAUDE.md; sharpen the description instead. Keep `paths:` off model-invocable skills: it hides the skill from the listing until a matching file is touched.
- **Path-scoped rules** in `.claude/rules/` load only when matching files are touched. Move a CLAUDE.md line there when it only matters in one layer.
- **Disclosed files are rarely opened.** Across 2,357 transcripts a skill's `references/*.md` was read one to three times in total, while the skills themselves ran hundreds of times, and the unread files rotted into stale tutorials. Inline what the agent must know in `SKILL.md`; disclose only a procedure one branch runs, and cut restated library knowledge instead of disclosing it.
- **Memory** holds facts not derivable from the repo. A lesson that a check could enforce belongs in `scripts/fitness/` or a hook, not in memory; see `retro`.

## Context pointers

A **context pointer** is a reference held in the agent's context that names some out-of-context material and encodes the condition for reaching it. A skill's description is one; a CLAUDE.md line naming a doc is the same object. The pointer's _wording_, not its target, decides when the agent reaches the material, and how reliably. A must-have target behind a weakly worded pointer is a variance bug: sharpen the wording first, and inline the material only if sharpening fails.

A pointer does two jobs: state what the material is, and list the **branches** that should trigger reaching it (a branch is a distinct case the document handles, so different runs take different paths through it). Every word of an always-loaded pointer costs on every turn, so it earns even harder pruning than the body:

- **Front-load the leading word**: the pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written twice; collapse them and keep only genuinely distinct branches.
- **Cut identity the body already carries.**

## The two loads

Every document and pointer you add spends one of two budgets:

- **Context load** is the cost of always-loaded material on the agent's window: a CLAUDE.md line, a skill description, anything sitting in context every turn, spending tokens and attention whether or not it fires.
- **Cognitive load** is the cost on the human: which documents exist and when to reach for each. The human is the index. Not a cost to minimise: it is the price of human agency; spend it where human judgement matters, remove it where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's own line; material with no pointer at all rides entirely on cognitive load.

## Information hierarchy

A document is built from two content types: **steps** (the ordered actions the agent performs) and **reference** (definitions, rules, facts consulted on demand). The core decision is where each piece sits on the **information hierarchy**, a ladder ranked by how immediately the agent needs the material:

1. **In-file step** is the primary tier: what the agent does, in order.
2. **In-file reference** is consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung), which is a fine arrangement, not a smell.
3. **Disclosed reference** is pushed out into a separate file, reached by a context pointer, loaded only when the pointer fires.

Push too little down and the top bloats; push too much and you hide material the agent actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder so the top stays legible. Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach. When a document has steps, in-file reference that should be disclosed buries them and turns attending to them into a coin-flip.

**Co-location** is the within-file companion: keep a concept's definition, rules, and caveats under one heading rather than scattered, so reading one part brings its neighbours with it.

**Sprawl** is the failure mode: a document simply too long, even when every line is live and unique. Attention thins across the excess. The cure is the ladder: disclose reference behind pointers, and split by branch or sequence so each path carries only what it needs.

## Steps and completion criteria

Every step ends on a **completion criterion**, the condition that tells the agent the work is done. Two properties make it a lever:

- **Clarity**: can the agent tell done from not-done? A vague bound ("understanding reached") invites **premature completion**: ending the step before it is genuinely done. Sharpen the bound first; only if it is irreducibly fuzzy _and_ you observe the rush, hide the later steps by splitting the sequence across a real context boundary (a hand-off or a subagent dispatch).
- **Demand**: how much it requires. "Every modified model accounted for" forces thorough work where "produce a change list" does not.

The strongest criteria are both checkable and exhaustive.

## When to split

Splitting one document into two spends one of the two loads, so split only when the cut earns it:

- **By sequence**: split a run of steps where the later steps tempt the agent to rush the one in front of it.
- **By invocation**, skill-specific: see [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## Leading words

A **leading word** is a compact concept already living in the model's pretraining that the agent thinks with while running the document (_tracer bullets_, _red_, _tight_). Repeated as a token, never as a sentence, it anchors a whole region of behaviour in the fewest tokens. Reach for an existing word before coining one.

It anchors twice: in the body (the agent reaches for the same behaviour every time the word appears) and in a pointer (shared language across prompts, docs, and code makes invocation more reliable).

Hunt for passages begging to collapse into one token: "fast, deterministic, low-overhead" → _tight_; "a loop you believe in" → _red_.

**Negation** is the failure mode beside this lever: steering by prohibition makes the forbidden behaviour more available. Prompt the **positive** target. A prohibition earns its place only as a hard guardrail you cannot phrase positively; even then, pair it with the positive target.

## Pruning

- Keep each meaning in a **single source of truth**. **Duplication** costs maintenance and tokens, and inflates a meaning's prominence past its real rank.
- The **environment** is a source of truth too (`Makefile` targets, `package.json` scripts, config files, `--help` output). A document that restates it is a **cache**, earning its load only when the lookup is expensive. Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config confesses.
- Check every line for **relevance**. Without a pruning discipline the default fate is **sediment**: stale layers that settle because adding feels safe and removing feels risky.
- Hunt **no-ops** sentence by sentence: an instruction the model already obeys by default pays load to say nothing. When a sentence fails, delete the whole sentence. A word too weak to beat the default (_be thorough_) is a no-op; the fix is a stronger word (_relentless_).

Adapted from mattpocock/skills (MIT).
