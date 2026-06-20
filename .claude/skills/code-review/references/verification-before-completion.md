# Verification before completion (prumo)

**Moved — this is a redirect, not a second copy.**

The canonical verification gate lives in:

`../../debugging/verification-before-completion/SKILL.md`

That file owns the gate procedure, the full claim → command matrix, the
red-flags and rationalisation tables, and the per-area verification
patterns (backend, frontend, migrations, RLS, multi-agent).

`code-review/SKILL.md` ("The verification gate") inlines a short curated
evidence subset for the review flow. Do **not** re-expand the full matrix
here: this file used to carry a full duplicate, and it drifted into broken
`npm … --prefix frontend` commands (there is no `frontend/package.json` —
frontend tooling runs from the repo root: `npm run test:run`, `npm run lint`,
`npm run typecheck`, `npm run build`). One canonical home prevents that.
