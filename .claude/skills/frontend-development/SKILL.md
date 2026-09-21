---
name: frontend-development
description: "Use when adding or changing the structure of prumo's frontend: a page, a data hook or mutation, a service call, a store or context, a form, or generated API types. Covers where code lives, the component → hook → service → apiClient data path, query-key factories, react-hook-form + Zod, and the React Compiler constraints. Visual work: `frontend-ux` and `ui-styling`."
---

# Frontend Development (prumo)

How prumo's React 19 + TypeScript + Vite frontend is organized and how data flows through it. Visual language is `frontend-ux`; class mechanics are `ui-styling`. `.claude/rules/frontend.md` holds the always-true core; this skill adds the shapes.

## Layout

```
frontend/
  pages/{PageName}.tsx          # route-level screens
  components/{domain}/          # domain components; components/patterns/ holds IconButton, AppDialog, PageHeader, ErrorState
  hooks/{domain}/use{Name}.ts   # TanStack Query hooks and mutations
  services/{domain}Service.ts   # apiClient calls, returning ErrorResult<T>
  stores/                       # Zustand: useBackgroundJobs.ts (persisted), sectionExtractionJobs.ts
  contexts/                     # app-wide singletons: Auth, Project, Sidebar, Theme, HeaderActions
  integrations/api/client.ts    # apiClient, apiBlobClient, ApiError: the one HTTP client
  integrations/supabase/        # auth and storage only, never table reads
  lib/copy/                     # in-house i18n, t(namespace, key)
  lib/query-keys/               # key factories (README.md there is the convention)
  types/api/schema.d.ts         # generated from the FastAPI OpenAPI; never hand-edited
```

## Hard rules

1. **One read path.** Backend data goes through `apiClient`; no `fetch()`, no `supabase.from(...)`, no `import.meta.env.VITE_API_URL` in a component, hook or service (`check_frontend_data_path.py` gates the last two, review gates `fetch`). A few legacy sites are baselined; new code has no exceptions.
2. **Services return `ErrorResult<T>`** (`lib/error-utils.ts:toResult`): they never throw across the boundary and never toast. Some `hooks/runs/*` call `apiClient` directly; new code goes through a service.
3. **Keys come from factories**: a literal `queryKey: [...]` fails `check_react_query_keys.py`. A mutation invalidates every key family whose data it changed; no gate checks that.
4. **Types are generated**: import request and response shapes from `types/api/schema.d.ts` and rerun `npm run generate:api-types` after a backend change; CI's `api-contract` job fails on a stale file.
5. **Copy goes through `t(namespace, key)`** from `lib/copy/`, Zod messages included. Nothing gates a hardcoded string, and a missing key renders `''`.
6. **React Compiler** (`panicThreshold: 'all_errors'`): no `try/finally`, and no `throw` inside `try`, in a component or hook body; move the IO into a service. Read a subscription where you consume it: `useWatch`, never `form.watch()`; `useFormState({ name })`, never `useFormContext().formState`. Last resort: `'use no memo'` plus a `// kept:` comment.

## Data path

`component → hook (TanStack Query) → service → apiClient → backend`.

- `apiClient<T>(endpoint, { method, body, timeout, skipAuth })` attaches the Supabase JWT, unwraps the `ApiResponse` envelope and returns `data`; a non-2xx or `ok: false` throws `ApiError` (`code`, `message`, `status`, `traceId`). Default timeout 60 s. Downloads use `apiBlobClient`, which returns `{ kind: 'sync', blob, filename }` or `{ kind: 'async', job_id }`.
- A service wraps the call in `toResult`, so a hook sees `{ ok, data }` or `{ ok: false, error }`; the `queryFn` rethrows on `!ok` so TanStack sees the failure.
- A long backend job answers 202 with a job id; poll with `hooks/useBackgroundJobPolling.ts` and track it in `stores/useBackgroundJobs.ts`.
- Reference pair: `services/projectsService.ts` (`listProjectsForDashboard`) with `hooks/useProjectsQuery.ts`; mutation: `hooks/runs/useAdvanceRun.ts`, which invalidates `runsKeys.detail(runId)`.

## Query keys

Factories live in `lib/query-keys/{domain}.ts` (the barrel re-exports `projectKeys`, `articleKeys`, `extractionKeys`, `meKeys`; import the rest by module path) or beside their hooks (`runsKeys` in `hooks/runs/types.ts`). A key carries every id its query reads by. Add a new domain as its own factory file, following `lib/query-keys/README.md`.

## State: store or context

- **Server data** lives only in the TanStack cache.
- **Zustand** (`stores/`) for cross-component UI state scoped to a feature, where fine-grained subscriptions matter; `persist` only when the state must survive a reload.
- **Context** (`contexts/`) for app-wide singletons provided once by the shell. Feature state never gets a new context.

## Forms

`react-hook-form` + `zodResolver`, with the shadcn `Form`, `FormField`, `FormItem`, `FormControl` and `FormMessage` wrappers (they thread `aria-invalid` and `aria-describedby`). The submit handler calls the mutation hook or the service and branches on `ok`; nothing throws out of it. Reset the form after a successful submit and on close. A schema using `.default()` has different input and output types: type the form `useForm<z.input<typeof s>, unknown, z.output<typeof s>>`. Confirm and cancel dialogs use `components/patterns/AppDialog`.

## Common workflows

| Task | Steps |
|---|---|
| Add a page | `pages/{Name}.tsx` → route in the router → data through a hook |
| Add a data hook | `hooks/{domain}/use{Name}.ts` → `useQuery` with a factory key → the service |
| Add a mutation | `useMutation` in the hook → on success, invalidate the owning key families |
| Add a service call | `services/{domain}Service.ts` → `apiClient` → `toResult` |
| Add a form | RHF + Zod resolver → submit through the hook or service |
| Add shared UI state | a Zustand store; an app-wide singleton → a context |

A `npx knip --production` finding: triage it with [`references/dead-code.md`](references/dead-code.md).
