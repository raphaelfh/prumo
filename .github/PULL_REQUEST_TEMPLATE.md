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

## Screenshots (UI changes only)

| Before | After |
|---|---|
|        |       |
