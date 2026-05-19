# `frontend/lib/query-keys/` — TanStack Query key factories

Single source of truth for every `queryKey` used in TanStack Query hooks. Every `useQuery({ queryKey: [...] })` call site must source its key from one of the namespace files here — never from a literal array embedded inline at the call site.

## Why

`queryKey` is the cache identity. Two call sites that drift in their keys silently double-cache the same data; an invalidation that targets one misses the other. The bug manifests as "stale UI after action X" — exactly the kind of subtle cache drift the code-review skill calls out as a recurring incident class on prumo.

Centralising keys in factory functions:
- Makes `invalidateQueries({ queryKey: projectKeys.detail(id) })` and the matching `useQuery({ queryKey: projectKeys.detail(id) })` provably identical.
- Surfaces accidental key shape changes in code review (a PR touches the factory; reviewers see every consumer affected).
- Lets `scripts/fitness/check_react_query_keys.py` enforce the rule deterministically.

## Convention

- One file per **domain namespace**: `project.ts`, `articles.ts`, `extraction.ts`, …
- Each namespace exports a `<domain>Keys` object with two-layer factory functions:
  ```ts
  export const projectKeys = {
    all: ['projects'] as const,
    list: (filters?: Filters) => [...projectKeys.all, 'list', filters] as const,
    detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
    members: (id: string) => [...projectKeys.all, 'members', id] as const,
  }
  ```
- Keys are `as const` so TanStack Query's type-inference gets a tuple, not a generic `string[]`.
- The first element is always the domain name (lowercase plural where natural).
- Sub-keys are flat strings: `'list'`, `'detail'`, `'members'`. Don't nest deep.
- Parameters that change identity (id, filters) come AFTER the sub-key.
- Re-export everything via `index.ts` so consumers can `import { projectKeys, articleKeys } from '@/lib/query-keys'`.

## Forbidden

```ts
// ❌ Inline literal — invisible to invalidation, not caught by TS:
useQuery({ queryKey: ['projects', id], queryFn: ... })

// ❌ String concatenation — defeats the tuple type:
useQuery({ queryKey: [`projects:${id}`], queryFn: ... })

// ❌ Reaching outside the namespace:
useQuery({ queryKey: ['some-random-thing', id], queryFn: ... })
```

```ts
// ✅ Always source from the factory:
useQuery({ queryKey: projectKeys.detail(id), queryFn: ... })
```

## Enforcement

`scripts/fitness/check_react_query_keys.py` (Phase 5b) scans every `.ts(x)` file for `useQuery({ queryKey: [...] })` where the `queryKey` is a literal array (not a factory call). A `.baseline` file grandfathers existing call sites; new call sites must route through a factory.

## Adding a new namespace

1. Create `frontend/lib/query-keys/<domain>.ts` with the `<domain>Keys` export.
2. Re-export from `index.ts`.
3. Use it in any new `useQuery` call site.
4. (Optional) Refactor 1–2 existing hot consumers as exemplars; do not blanket-refactor — that is a separate task tracked by the quality loop.
