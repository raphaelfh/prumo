## Summary

<!-- 1–3 bullet points explaining what changed and why. -->

## Linked issues / specs

<!-- Close with "Closes #N" or link the spec under docs/superpowers/specs/. -->

## How to verify

<!-- Step-by-step commands or UI flow. Include the test account when relevant
     (teste@prumo.local). -->

## Test plan

- [ ] Backend: `make test-backend` passes
- [ ] Frontend: `npm test -- --run` passes
- [ ] E2E (if UI changed): `npx playwright test` passes for the touched flow
- [ ] Lints: `make lint-backend` and `npm run lint` pass

## Migration safety (if applicable)

- [ ] Alembic migration is one logical change per file
- [ ] RLS enabled on new tables and policies created in the same migration
- [ ] `NOT NULL` columns have a defaulted backfill on populated tables
- [ ] Downgrade path tested locally

## Docs

- [ ] Updated relevant doc(s) under `docs/` (reference, how-to, ADR)
- [ ] Touched docs carry up-to-date `last_reviewed` frontmatter
- [ ] No broken cross-references (`docs-ci` link check will catch the rest)

## Definition of Done (judgment gate)

<!-- CI already blocks the mechanical gates (fitness, coverage, lint, tests,
     API-contract) — no merge if they fail. This section is only the judgment
     calls CI can't make. Drop a row that genuinely doesn't apply (and say so). -->

- [ ] **Authorization** — new/changed project-scoped endpoints check project membership *before* data access; no new BOLA surface (the #1 incident class here)
- [ ] **Decision captured here** — if this PR makes an architectural decision, the ADR is in THIS PR (supersede, don't edit), not a follow-up
- [ ] **Code ↔ doc parity** — a new/changed endpoint or `extraction_*` table updates the matching `docs/reference/` doc here, or "no doc change needed"

## Screenshots (UI changes only)

| Before | After |
|---|---|
|        |       |
