# Contract: Copy / Translation API (Frontend)

**Feature**: 004-frontend-i18n  
**Consumers**: All React components and pages that display UI text.

## Purpose

Components MUST obtain every user-facing string (labels, buttons, placeholders, messages, aria-labels, titles) from the
centralized copy module. They MUST NOT hardcode Portuguese or any other language string in JSX/TS.

## Contract

### 1. Location

- Copy definitions: `frontend/lib/copy/` (or `frontend/lib/translations/`).
- One file per namespace (e.g. `common.ts`, `extraction.ts`, `pages.ts`) or equivalent structure; see data-model.md.

### 2. Consumption

- **Option A (recommended)**: Typed helper — e.g. `t('common.save')` or `getCopy('common').save` — returning `string`.
  Keys are typed so that invalid keys are compile-time errors.
- **Option B**: Direct import of a namespace object — e.g. `import { common } from '@/lib/copy'; return common.save;` —
  with namespace and keys typed.

Components MUST use one of these; they MUST NOT construct UI strings from literals (e.g. `"Salvar"` or `'Cancelar'`).

### 3. Signature (helper)

If a helper is used, the contract is:

- **Name**: e.g. `t` or `copy` (project chooses).
- **Input**: Namespace + key, or a single namespaced key (e.g. `'common.save'`).
- **Output**: `string` (the English copy for that key).
- **Runtime**: No async; no locale parameter (single language).

Example (advisory):

```ts
// Example: t(namespace, key) or t('namespace.key')
function t(ns: CopyNamespace, key: string): string;
// or
function t(key: keyof FlattenedCopy): string;
```

### 4. Accessibility

Strings used for `aria-label`, `title`, `placeholder`, and visible labels MUST come from the same copy module (same
contract). No exception for “short” strings.

### 5. Dynamic content

User-generated or backend-sourced content (e.g. project name, user name) is NOT passed through the copy API; it is
displayed as-is. Only fixed UI copy goes through the copy module.

### 6. Backend errors

When the UI displays an error message that originates from the backend, the frontend SHOULD map known error codes to
English strings from the copy module. Error copy lives in the common namespace (e.g. `common.errors.unauthorized`)
unless a dedicated errors namespace is used; see data-model.md.

## Verification

- Lint or grep: no Portuguese (or other non-English) string literals in `frontend/components/`, `frontend/pages/`,
  `frontend/contexts/` (excluding comments and non-UI strings).
- Type checker: all `t(...)` or copy imports use keys that exist in the copy module.
