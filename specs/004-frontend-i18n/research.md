# Research: Frontend i18n — App in English & Clean Code

**Feature**: 004-frontend-i18n  
**Phase**: 0

## 1. Mechanism for centralized UI copy (translations)

**Decision**: Use a **minimal custom module** — TypeScript files under `frontend/lib/copy/` (or
`frontend/lib/translations/`) that export namespaced objects of English strings. Components import the appropriate
namespace or use a small typed helper (e.g. `t('common.save')` resolving from a single flat or namespaced map). No new
i18n library dependency.

**Rationale**:

- Spec requires **single language (English)** and **no duplication**; no need for runtime locale switching or plural/ICU
  rules in v1.
- Keeps bundle and dependency set unchanged; aligns with constitution preference for standard ecosystem tooling.
- Typed keys (e.g. `Copy.common.save`) give autocomplete and compile-time safety; easy to grep for usage and missing
  keys.
- If a second language is added later, the codebase can migrate to react-i18next (or similar) and replace the custom
  module without changing component API much (still a function/hook that returns a string by key).

**Alternatives considered**:

| Alternative               | Rejected because                                                                                                     |
|---------------------------|----------------------------------------------------------------------------------------------------------------------|
| react-i18next             | Adds dependency and complexity for a single locale; preferred when multiple locales are required from day one.       |
| FormatJS (react-intl)     | Heavier; ICU/plural/date formatting not required for “all strings in English”; can use Intl/date-fns for dates only. |
| Inline constants per file | Encourages duplication and scattered copy; does not satisfy “single repository” (FR-003).                            |

## 2. Namespace structure

**Decision**: Organize copy by **area** matching the spec (common, pages, extraction, assessment, articles, project,
user, navigation, layout, patterns, ui, shared). One file per area (e.g. `copy/common.ts`, `copy/extraction.ts`) or one
file with namespaced exports; implementer chooses. Keys are camelCase or dot-separated (e.g. `save`, `cancel`,
`errors.notFound`).

**Rationale**: Mirrors the “Referência de áreas” in the spec; makes it easy to assign work by area and to find keys when
editing a given feature.

## 3. Date and number formatting

**Decision**: Use **en-US** (or browser default English) for any date/number formatting that is part of the UI (e.g.
“Saved at 3:45 PM”, list dates). Prefer `Intl` or `date-fns` with `en-US` (or `date-fns/locale` for `enUS`) instead of
`pt-BR`. Replace existing `ptBR` usage in date-fns/Intl with English locale.

**Rationale**: Spec requires the app to be displayed only in English; consistent date/number format supports that and
avoids mixed locale.

## 4. Backend / API error messages

**Decision**: Treat as **in scope for this feature** only where the frontend **displays** the message to the user.
Prefer mapping known error codes to English messages in the frontend (copy module); if the backend sends a Portuguese
message, either (a) map by code in the frontend to an English string, or (b) document as “Origens externas” and leave
backend messages for a later phase. Prefer (a) for a small set of known errors so the UI is fully in English.

**Rationale**: FR-006 and edge case “Strings vindas do backend” allow either mapping or documenting; mapping gives a
consistent “app only in English” outcome without blocking on backend changes.

---

**Output**: All NEEDS CLARIFICATION from Technical Context are resolved. Phase 1 can proceed with data-model (structure
of copy module), contracts (how components consume copy), and quickstart (how to add a string and verify no PT in UI).
