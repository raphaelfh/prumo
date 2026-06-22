# Components and forms patterns

## Component shape

Components are functional, typed, and never fetch directly. Domain components live in `components/{domain}/`. The domain mirrors `hooks/{domain}/` and `services/{domain}Service.ts`.

```typescript
// components/articles/ArticleCitationList.tsx
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { useArticleCitations } from '@/hooks/articles/useArticleCitations';

interface ArticleCitationListProps {
  articleId: string;
  className?: string;
}

export function ArticleCitationList({ articleId, className }: ArticleCitationListProps) {
  const { data: citations, isLoading, error } = useArticleCitations(articleId);

  if (isLoading) return <div>{t('common', 'loading')}</div>;
  if (error) return <div>{t('common', 'errors_unknownError')}</div>;

  return (
    <ul className={cn('space-y-2', className)}>
      {citations?.map((c) => (
        <li key={c.id}>{c.text}</li>
      ))}
    </ul>
  );
}
```

Rules:
- Props are typed with an explicit `interface`, never `React.FC<Props>`.
- `cn()` from `@/lib/utils` merges class names. Accept a `className` prop on leaf components so the caller can tweak spacing without forking the component.
- Every interactive element (`Button`, `Input`, `Select`) must retain a visible focus ring — shadcn/Radix primitives ship one by default; don't remove `focus-visible:ring-*` classes.
- No `React.memo()` without a `// kept:` comment explaining why. The React Compiler memoizes automatically; explicit memo without that comment is dead weight.

## shadcn/Radix primitives

Import from `@/components/ui/`:

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
```

Use `AppDialog` from `@/components/patterns/AppDialog` for confirm/cancel dialogs — it wraps Dialog with consistent header, footer, loading state, and keyboard handling.

## react-hook-form + Zod forms

All forms use `react-hook-form` with a `zodResolver`. The submit handler calls the mutation hook (or the service directly for non-TanStack mutations). No `try/finally` in the submit handler — the service returns `ErrorResult`, the component branches on `ok`.

```typescript
// components/project/AddProjectDialog.tsx
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/copy';

const schema = z.object({
  name: z
    .string()
    .min(1, t('project', 'addDialogNameRequired'))
    .max(100, t('project', 'addDialogNameMaxLength')),
  description: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddProjectDialog({ onProjectCreate }: { onProjectCreate: (data: FormValues) => Promise<void> }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  // useWatch — not form.watch() — React Compiler compatibility
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';

  const onSubmit = async (values: FormValues) => {
    await onProjectCreate(values);
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('project', 'addDialogNameLabel')}</FormLabel>
              <FormControl>
                <Input {...field} autoFocus />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
```

Key rules:
- Always use `useWatch` instead of `form.watch()` — `form.watch()` is incompatible with the React Compiler (`react-hooks/incompatible-library`).
- Zod messages should use `t()` so they go through the copy system.
- `Form {...form}` spreads the RHF context; shadcn's `FormField` / `FormItem` / `FormMessage` consume it automatically.
- Reset `form.reset()` on successful submit and on dialog close, not just on submit.
- The submit handler is `async`; move any throwing IO into the service layer (returns `ErrorResult`) and branch on `ok` — never let a raw `throw` escape the handler.

## Copy — `lib/copy/`

All user-facing text goes through `t(namespace, key)`:

```typescript
import { t } from '@/lib/copy';

// render
<Button>{t('common', 'save')}</Button>
<p>{t('project', 'addDialogNameRequired')}</p>
```

Never hardcode English strings in JSX or Zod messages. The CI `cspell` run will flag unknown words; `prumoai` is in the allowlist.

Copy files live under `frontend/lib/copy/` organised by namespace (e.g. `common.ts`, `project.ts`, `extraction.ts`). Add a new key to the matching namespace file — don't create a new namespace for a single string.

## Generated types from `types/api/schema.d.ts`

The schema file is generated from the FastAPI app with `npm run generate:api-types`. Never hand-edit it or hand-mirror its types in a separate interface.

```typescript
import type { components } from '@/types/api/schema';

// Use the generated schema shape directly
type ArticleCitationItem = components['schemas']['ArticleCitationItem'];
type RunSummaryResponse = components['schemas']['RunSummaryResponse'];

// For operation-level request/response types
import type { operations } from '@/types/api/schema';
type CreateRunBody = operations['create_run_api_v1_runs_post']['requestBody']['content']['application/json'];
```

After changing a backend Pydantic schema or adding an endpoint:
1. Run `npm run generate:api-types` from the repo root.
2. Commit the updated `frontend/types/api/{openapi.json,schema.d.ts}`.
3. Update any component/service/hook that consumed the old shape.

The CI `api-contract` job fails any PR where the committed output doesn't match the running backend — so the diff must be committed, not just regenerated locally and left out.

## ErrorResult in the component

Services return `ErrorResult<T>` — components that call a service directly (outside a query hook) must branch on `ok`:

```typescript
// inside an event handler or useEffect-like imperative flow
const result = await someService.doSomething(params);
if (!result.ok) {
  // show error state; result.error is an Error instance
  setError(result.error.message);
  return;
}
// use result.data
```

Inside a `queryFn`, throw the error so TanStack owns the error state:

```typescript
queryFn: async () => {
  const result = await fetchSomething(id);
  if (!result.ok) throw result.error;
  return result.data;
},
```

Do not call `toast.error()` in a component in response to a service error — the service already logged it. Use `toast` only for user-initiated feedback (success confirmation, undo actions).
