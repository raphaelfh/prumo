---
name: frontend-development
description: Use when writing or modifying the STRUCTURE of anything under `frontend/` — where code lives, data flow, and state. Covers components/{domain} organization, TanStack Query hooks + key factories, `services/*Service.ts` via the typed apiClient, Zustand stores vs React Context, react-hook-form + Zod forms, generated `types/api/schema.d.ts`, ErrorResult boundaries, and the React Compiler constraints. Trigger on "add a page", "add a data hook", "add a mutation", "wire a form", "new store", "fetch data", or anything about how the frontend is organized. NOT for visual language (use `frontend-ux`) or Tailwind/shadcn class mechanics (use `ui-styling`).
---

# Frontend Development (prumo)

Structural manual for prumo's React 19 + TS + Vite frontend. This is the *how
the code is organized / how data flows* layer. Visual language is `frontend-ux`;
Tailwind/shadcn class mechanics are `ui-styling`. SKILL.md is the index — pull a
reference for depth.

## Repository layout you must respect

```
frontend/
  pages/{PageName}.tsx          # route-level screens
  components/{domain}/*.tsx      # domain components, functional + hooks only
  hooks/{domain}/use{Name}.ts    # TanStack Query/mutation hooks
  services/{domain}Service.ts    # apiClient calls; return ErrorResult, never throw/toast
  stores/                        # Zustand stores (cross-component UI state)
  contexts/                      # React Context (app-wide singletons: Auth/Project/Sidebar)
  integrations/api/client.ts     # the ONE typed HTTP client (apiClient)
  integrations/supabase/         # auth + storage ONLY (never table reads)
  lib/copy/                      # in-house i18n; all user-facing text
  lib/query-keys/                # TanStack key factories
  types/api/schema.d.ts          # generated from FastAPI openapi — never hand-edit
```

## Hard rules (with reasoning)

1. **One read path.** All backend data goes through `apiClient`
   (`integrations/api/client.ts`). Never `fetch()` or `supabase.from(...)` in a
   component/hook/service — the dual read path is the documented slow-load /
   status-drift / blind-leak incident class (constitution §VI). `supabase.from(`
   and `import.meta.env.VITE_API_URL` are CI-enforced by
   `check_frontend_data_path.py`; `fetch()` is a convention enforced at review.
2. **Services don't throw across the boundary.** `services/*Service.ts` return
   `ErrorResult<T>` via `lib/error-utils.ts:toResult`; the hook maps the result,
   the component renders it. Services never toast.
3. **Keys come from factories.** TanStack `queryKey` comes from
   `lib/query-keys/` (CI-enforced by `check_react_query_keys.py`). Mutations
   invalidate the owning key family.
4. **Types are generated.** Import request/response shapes from
   `types/api/schema.d.ts` (`npm run generate:api-types` after a backend change).
   Never hand-mirror backend enums/models.
5. **Copy through `lib/copy/`.** Never hardcode user-facing strings.
6. **React Compiler.** No `try/finally` (or `throw` inside `try`) in
   component/hook bodies — move IO into a service returning `ErrorResult`. Last
   resort: `'use no memo'` + a `// kept:` comment.

## Data flow

`component → hook (TanStack Query) → service (apiClient) → backend`. See
[`references/data-and-state.md`](references/data-and-state.md) for the hook /
service / store / context shapes with code.

## Common workflows

| Task | Steps |
|---|---|
| Add a page | `pages/{Name}.tsx` → route in the router → data via a hook (never inline fetch) |
| Add a data hook | `hooks/{domain}/use{Name}.ts` → `useQuery` with a key-factory key → call the service |
| Add a mutation | `useMutation` in the hook → on success `invalidateQueries` the owning key family |
| Add a service call | `services/{domain}Service.ts` → `apiClient` → return `ErrorResult<T>` |
| Add a form | `react-hook-form` + `Zod` resolver; submit calls the service hook |
| Add cross-component UI state | Zustand store in `stores/`; app-wide singleton → Context |

## References index

| File | Use when |
|---|---|
| [`references/data-and-state.md`](references/data-and-state.md) | hook/service/store/context shapes, query-key factories, invalidation |
| [`references/components-and-forms.md`](references/components-and-forms.md) | component shape, react-hook-form + Zod, copy, generated types |
