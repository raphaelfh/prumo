# Quickstart: Adding UI Strings (Frontend i18n)

**Feature**: 004-frontend-i18n

## 1. Where copy lives

- **Path**: `frontend/lib/copy/` (or the path chosen in implementation).
- **Files**: One file per namespace (e.g. `common.ts`, `extraction.ts`, `assessment.ts`, `pages.ts`).
  See [data-model.md](./data-model.md) and [contracts/copy-api.md](./contracts/copy-api.md).

## 2. Adding a new string

1. Choose the **namespace** that matches the area (e.g. extraction, assessment, common).
2. Open the corresponding file (e.g. `frontend/lib/copy/extraction.ts`).
3. Add a new key and English value (camelCase key, no empty value). Example:
    - Key: `saveDraft`
    - Value: `"Save draft"`
4. In the component, use the copy API (e.g. `t('extraction.saveDraft')` or `copy.extraction.saveDraft`) instead of any
   literal string.
5. Do not duplicate the same text under two keys unless the UI context genuinely requires it; reuse one key.

## 3. Using copy in a component

- Import the helper or namespace (e.g. `import { t } from '@/lib/copy'` or
  `import { extraction } from '@/lib/copy/extraction'`).
- Replace every user-visible string (labels, buttons, placeholders, messages, aria-label, title) with a call or
  reference to the copy module.
- For dates/numbers, use English locale (e.g. `en-US`, or `date-fns` with `enUS`) so the app stays consistently in
  English.

## 4. Verifying “no Portuguese in UI”

- **Manual**: Search under `frontend/` for common Portuguese words or phrases that might be UI strings (e.g. "Salvar", "
  Cancelar", "Erro", "Carregando"). Ensure they appear only in comments or in the copy module as legacy keys being
  removed, not as active UI.
- **Automation** (if implemented): Lint rule or script that fails on string literals in JSX/TS in components and pages (
  with allowlist for copy module and tests).
- **Checklist**: Before merge, run a quick pass over changed files to confirm no new hardcoded UI strings in Portuguese.
  Optionally, use a verification runbook (e.g. 2h, 20% sample of screens) to validate SC-004; see
  specs/004-frontend-i18n/quickstart.md or tasks T025.

## 5. Areas to cover (reminder)

Ensure every area has its strings in the copy module and components use it: pages, extraction, assessment, articles,
project, user, navigation, layout, patterns, ui (only components with fixed text), shared, contexts. See
spec [Referência de áreas](./spec.md#referência-de-áreas-a-cobrir-frontend).

## 6. Running the app

- No new scripts. Use existing `npm run dev` (or project equivalent). The app should display only in English; changing
  copy files updates strings after rebuild/refresh.
