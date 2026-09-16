# Triaging a knip finding

The gate facts (two knip modes, `knip.jsonc`, the copy-key ratchet) live in `.claude/rules/frontend.md` § Dead code. This file is the procedure for a `npx knip --production` finding.

A production-mode finding means no production file imports the export. The code behind it may still be live. Check, in order:

1. **Is the symbol called inside its own module?** Then it is live, and only the `export` faces the test. `knip.jsonc` sets `ignoreExportsUsedInFile`, so this case should not reach you.
2. **Is it a duplicate** of a type or function that lives closer to its real caller? Delete this copy and point the tests at the canonical one. That is how the stale `FieldValidationResult` and `ArticleListItem` copies were found.
3. **Is it genuinely orphaned**, with no caller anywhere but its own test? Delete the code *and* the test.
4. **Is it a seam a test must reach and production deliberately cannot?** Mark it `@internal` at the declaration, with a reason.

Never silence a finding by widening `ignore`. The exceptions that belong in `knip.jsonc` (generated files, shell-invoked scripts, browser-runtime imports) each carry a comment explaining why.
