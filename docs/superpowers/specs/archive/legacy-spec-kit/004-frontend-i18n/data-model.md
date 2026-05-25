# Data Model: Copy / Translations (Frontend i18n)

**Feature**: 004-frontend-i18n  
**Phase**: 1

This feature does not introduce database entities. The “data model” describes the **structure of the centralized UI copy
** consumed by the frontend.

## 1. Copy namespace

Logical grouping of strings by area. No persistence; defined in source (TS files).

| Attribute | Type                   | Rules                                                                                                                                                                                                                                                                              |
|-----------|------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| name      | string                 | One of: common, pages, extraction, assessment, articles, project, user, navigation, layout, patterns, ui, shared, contexts (aligned to spec areas). Error messages: prefer common (e.g. common.errors.unauthorized); use a dedicated errors namespace only if the set grows large. |
| keys      | record<string, string> | Map of key → English string. Key format: camelCase or dot-separated (e.g. `save`, `errors.notFound`). No empty values.                                                                                                                                                             |

**Validation**: Keys must be non-empty; values must be non-empty strings (English). Duplicate keys across namespaces are
allowed only if intentionally aliased; prefer unique key names per namespace to avoid confusion.

## 2. Copy entry (key-value)

Single UI string in the repository.

| Attribute | Type   | Rules                                                                                 |
|-----------|--------|---------------------------------------------------------------------------------------|
| key       | string | Identifier used in code (e.g. `common.save`, `extraction.header.title`)               |
| value     | string | English text shown to the user (labels, buttons, placeholders, messages, aria-labels) |

**Lifecycle**: Static at build time; no state transitions. Added/edited when copy is updated; removed when the UI
element is removed.

## 3. Relationships

- One **namespace** contains many **entries** (key-value pairs).
- **Components** reference entries by key (via helper or direct import); they do not store copy.
- **No duplication**: The same visible string must not be defined in two different keys (unless it is intentionally the
  same text in two contexts); reuse one key.

## 4. State / persistence

- No database. Copy lives in TypeScript (or JSON) files under `frontend/lib/copy/` (or equivalent).
- Build: strings are bundled with the app; no runtime fetch of copy.

## 5. Naming conventions (recommended)

- **Namespaces**: Lowercase, matching area (common, extraction, assessment, …).
- **Keys**: camelCase for simple labels (`save`, `cancel`); nested for structure (`errors.notFound`, `form.title`).
- **Values**: Full English sentences or fragments as shown in the UI; no trailing spaces; escape only when required by
  TS/JSON.
