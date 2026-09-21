---
name: prototype
description: Build a throwaway prototype to answer one design question. Use when checking whether a state model or workflow logic feels right before building it, or when comparing structurally different UI layouts for a screen.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered from the user's prompt and the surrounding code, or ask:

- **"Does this logic or state model feel right?"** → [LOGIC.md](LOGIC.md). One shareable HTML file with free-play buttons and guided walkthroughs that pushes the state machine through cases hard to reason about on paper. Good for Run stage transitions, consensus rules, and reviewer permissions, and a domain expert can drive it.
- **"What should this look like?"** → [UI.md](UI.md). Several radically different UI variations on one route, switched by a `?variant=` search param and a floating bar.

The two branches produce very different artifacts, so getting this wrong wastes the prototype. If the question is ambiguous and the user isn't reachable, pick the branch matching the surrounding code (backend service → logic; page or component → UI) and state the assumption at the top of the prototype.

## Rules for both

1. **Throwaway from day one, and clearly marked.** Put the code next to what it prototypes, and name it so a reader sees it is a prototype (`*Prototype*`, `prototype-*.html`).
2. **Trivial to run.** A UI prototype runs on the normal dev server (`npm run dev`, from the repo root). A logic prototype is one HTML file opened by double-click.
3. **No persistence.** State lives in memory. UI variants read real data and never mutate it.
4. **Skip the polish.** No tests, no error handling beyond what makes it run, no abstractions.
5. **Surface the state.** After every action or variant switch, render the full relevant state.
6. **Never merge it into `dev`.** Prototype code is dead code the moment a decision is made, and the knip, vulture, and copy-key gates will flag it. Commit the prototype to a throwaway branch named `prototype/<topic>`, and record the verdict and the question it settled in the implementing PR or spec.
7. **Fold the decision in properly.** Rewrite the winning logic or layout in production code with tests. For UI, finish with `design-review` on the real screen.

Adapted from mattpocock/skills (MIT).
