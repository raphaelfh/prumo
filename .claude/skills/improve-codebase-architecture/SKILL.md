---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then walk through whichever one you pick.
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This is not `architectural-quality-loop`. The loop finds and fixes *violations* of rules prumo already has (drift, layering, legacy, security) and converges through gates. This command proposes *new shape* (deeper modules) and ends in a conversation, not a commit.

## Vocabulary

Two vocabularies, never mixed. **Domain words** come from the canonical glossary, `docs/reference/extraction-hitl-architecture.md` §6 (Run, TemplateVersion, ProposalRecord, ReviewerDecision...): say "the ReviewerDecision write module", not "the DecisionHandler". **Architecture words** come from this list; use them exactly, never "component", "service", "API" or "boundary".

- **Module**: anything with an interface and an implementation, at any scale: a function, a class, a Python package, a React hook, a tier-spanning slice.
- **Interface**: everything a caller must know to use the module correctly: the signature, plus invariants, ordering, error modes, required configuration and performance.
- **Depth**: leverage at the interface. A **deep** module hides a lot of behavior behind a small interface; a **shallow** one has an interface nearly as complex as its implementation.
- **Seam** (Feathers): the place where a module's interface lives, where behavior can change without editing in place. Where it goes is its own decision.
- **Adapter**: a concrete thing that satisfies an interface at a seam. It names a role, not what is inside.
- **Leverage**: what callers get from depth. **Locality**: what maintainers get: change, bugs and verification concentrate in one place. prumo's BOLA rule ("one ownership predicate, one implementation") is a locality rule.

Principles:

- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through; if it reappears across N callers, it earns its keep.
- **The interface is the test surface.** Callers and tests cross the same seam; wanting to test past it means the module is the wrong shape.
- **One adapter means a hypothetical seam, two adapters a real one.** Don't add a port until something varies across it.
- **Depth is a property of the interface.** A deep module may hold internal seams for its own tests; they stay out of its interface.
- Depth is leverage, not Ousterhout's ratio of implementation lines to interface lines, which rewards padding.

Layering rules (endpoint → service → repository, typed payloads) live in `docs/reference/constitution.md` and are enforced by `scripts/fitness/`. This command decides *shape inside* those rules and never overrides them. ADRs in `docs/adr/` record decisions it should not re-litigate.

## Process

### 1. Explore

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If the user named a direction (a module, a subsystem, a pain point), take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots, the files and areas that keep coming up, and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read the glossary (§6 above) and any ADRs in the area you're touching first. When `graphify-out/graph.json` exists, `graphify query` and `graphify explain` are a cheap first map of coupling. Recent quality-loop runs under `docs/superpowers/quality-runs/` show friction already found.

Then spawn a sub-agent to walk the codebase. It starts in the main checkout, so give it the absolute path of the tree you mean. Don't follow rigid heuristics; explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow. Classify each candidate's dependencies with [DEEPENING.md](DEEPENING.md): the category decides how the deepened module is tested.

### 2. Present candidates as an HTML report

Write a self-contained HTML file outside the repo: the session scratchpad directory when one exists, otherwise `$TMPDIR`. Name it `architecture-review-<timestamp>.html` so each run gets a fresh file. Open it with `open <path>` and tell the user the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals: use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualization**. Be visual.

For each candidate, render a card with:

- **Files**: which files/modules are involved
- **Problem**: why the current architecture is causing friction
- **Solution**: plain English description of what would change
- **Benefits**: explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram**: side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength**: one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007, but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Decision loop

Once the user picks a candidate, walk the decision tree with them one question at a time: constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Recommend an answer for each question and look the facts up yourself rather than asking the user to.

Keep the domain model current as decisions crystallize:

- **Naming a deepened module after a domain concept not in the glossary, or sharpening a fuzzy term?** Edit §6 right there, mirror it in `.claude/skills/architectural-quality-loop/references/concept-glossary.md` in the same commit, bump the doc's `last_reviewed`, and run `python3 scripts/fitness/check_glossary_sync.py`.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Offer it only when a future explorer would need the reason; skip ephemeral ones ("not worth it right now"). Copy `docs/adr/0000-template.md`, number it one above the highest existing file, and validate with `bash scripts/docs/check-frontmatter.sh`.
- **Want to explore alternative interfaces for the deepened module?** Run [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).

### 4. Hand off

When no open question would still change the design and the user confirms, the chosen deepening is a spec. Hand it to `/ship-spec` or `superpowers:writing-plans`. Don't start refactoring from this session.

Adapted from mattpocock/skills (MIT).
