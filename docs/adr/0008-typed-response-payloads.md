---
status: accepted
last_reviewed: 2026-06-10
owner: '@raphaelfh'
adr_number: '0008'
---

# Every API response payload is a concrete Pydantic model (no dict[str, Any] envelopes)

> **Status:** Accepted · Date: 2026-06-10 · Deciders: @raphaelfh

## Context and Problem Statement

`ApiResponse[dict[str, Any]]` satisfied the envelope fitness check
structurally while giving consumers no schema: the OpenAPI spec said
"object", the generated TypeScript said `Record<string, never>`, and
the real shape lived only in the endpoint body. Nine endpoints were
grandfathered this way (model extraction, section extraction, the six
user-api-key handlers, the unified Zotero action).

The cost was concrete, not theoretical. The create-API-key flow had a
live drift bug: the frontend read `validationStatus` (camelCase, per
its own interface) while the untyped endpoint forwarded the service's
snake_case dict — so the invalid-key toast never fired. Untyped
boundaries are the documented root cause of the envelope-drift
incident class, and they poison the generated-types chain introduced
with the `api-contract` CI job: codegen is only as good as the
weakest `response_model`.

## Decision

1. **Every endpoint declares `ApiResponse[ConcreteModel]`** — in both
   the route decorator's `response_model` (what OpenAPI sees) and the
   return annotation (what the fitness check sees). `dict`, `Any`,
   and `object` payloads are banned;
   `scripts/fitness/check_api_response_envelope.baseline` is empty as
   of 2026-06-10 and stays empty — new violations get a model, not a
   baseline entry.
2. **Polymorphic payloads use unions.** When the variant is decided by
   the payload itself, use a discriminated union with a `Literal` tag
   (`SectionExtractionResponseData` discriminates on `mode`), so
   generated TypeScript narrows instead of guessing by field presence.
   When the variant is decided by the URL (Zotero's `/{action}`), a
   plain union is acceptable.
3. **Typing never changes the wire format.** Models reproduce the
   pre-typing bytes verbatim (snake_case where the dicts were snake,
   camelCase aliases where the frontend contract was camel), pinned by
   golden wire-shape tests
   (`backend/tests/unit/test_typed_envelope_schemas.py`). The one
   deliberate exception: `create_api_key` now serializes camelCase via
   the (pre-existing, never-wired) `CreateAPIKeyResponse` — matching
   what the frontend already expected, i.e. fixing drift rather than
   introducing it.
4. **Endpoints return model instances**, never `.model_dump()` —
   FastAPI serializes via `response_model` (by-alias), so the schema
   in OpenAPI and the bytes on the wire cannot diverge.

## Consequences

- The enforcement chain is closed end-to-end: fitness check (empty
  baseline) → `response_model` → `openapi.json` → generated
  `frontend/types/api/schema.d.ts` (`api-contract` no-diff job) →
  golden wire tests.
- Services may keep returning plain dicts internally; the boundary
  validates them (`Model.model_validate(result)`), which also catches
  service-shape regressions at request time instead of in the browser.
- New fields on typed payloads are additive and safe; renames/case
  changes now fail loudly in CI (contract diff + golden tests) instead
  of silently in the UI.

## Links

- Supersedes the stopgap recorded in the 2026-05-20 envelope-batch
  baseline tightening.
- Companion: ADR 0007 (single API read path) — together they make the
  typed client + generated types the only data contract.
- Incident class: `code-review` skill `references/api-envelope.md`.
