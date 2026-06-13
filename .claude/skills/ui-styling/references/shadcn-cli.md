# shadcn/ui CLI in prumo

`components.json` lives at the **repo root**, not `frontend/`. The CLI reads it
and writes files to paths resolved via aliases.

## Our config

```jsonc
// /Users/raphael/PycharmProjects/prumo/components.json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",        // not "new-york"; soft corners, less contrast
  "rsc": false,              // Vite, no Server Components
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "frontend/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",      // → frontend/components/
    "utils": "@/lib/utils",            // → frontend/lib/utils.ts (the cn helper)
    "ui": "@/components/ui",           // → frontend/components/ui/
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Aliases resolve via Vite's `resolve.alias` in `vite.config.ts`. Verify any
alias change there too, or the build breaks silently.

## Adding components

```bash
# Run from repo root, where components.json lives
npx shadcn@latest add button
npx shadcn@latest add dialog dropdown-menu popover    # multiple
npx shadcn@latest add --overwrite button              # force-replace local edits (dangerous)
```

The CLI:
1. Resolves the component's source from the registry.
2. Drops the `.tsx` at `frontend/components/ui/<name>.tsx`.
3. Installs Radix peer deps (e.g. `@radix-ui/react-dialog`) in `package.json`.
4. Wires CSS variables if the component needs new ones.

**Do not run `add` against a component you have already customized** unless you
are ready to re-apply your edits. The CLI overwrites.

## After `add`: the audit

Open the new file and check:

- [ ] **Imports use `@/lib/utils` for `cn`** — older registry snapshots used `../../lib/utils`.
- [ ] **`cva` base classes match neighboring components** (e.g. ring tokens, radius scale).
- [ ] **No raw color names** (`bg-slate-50`, `text-zinc-500`). Replace with semantic tokens.
- [ ] **Focus styles present**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- [ ] **Display name set**: `Foo.displayName = "Foo"` — React DevTools relies on this.
- [ ] **`forwardRef` shape matches the rest of `ui/*`**. Even though React 19
      makes it optional, our 18.3 codebase still uses it for consistency.

## Customizing without breaking future updates

shadcn re-add is destructive. Two strategies to keep local edits safe:

1. **Edit `ui/*` only for things that should apply everywhere** (e.g. swap
   `rounded-md` → `rounded-lg` globally, add a `xs` size variant). Track these
   as small, intentional diffs against upstream.
2. **For one-off domain needs, wrap, don't fork.** Create
   `frontend/components/extraction/PrimaryActionButton.tsx` that imports
   `Button` and adds extraction-specific behavior. The wrapper survives `shadcn
   add` because the CLI never touches it.

## Adding custom variants

Edit the cva config in `ui/<component>.tsx` directly:

```tsx
// frontend/components/ui/button.tsx — add a "success" variant
const buttonVariants = cva(/* ... */, {
  variants: {
    variant: {
      // ... existing ...
      success: "bg-success text-success-foreground hover:bg-success/90",
    },
    // ... size ...
  },
  // ...
});
```

The semantic tokens already exist in `index.css` + `tailwind.config.ts`, so no
config changes are needed.

## Custom registries

You can pull from URLs (e.g. internal registries):

```bash
npx shadcn@latest add https://example.com/registry/awesome-thing.json
```

We do not maintain one. If a piece of UI recurs across 3+ domains, promote it
to `frontend/components/ui/` manually and commit it like any other source file.

## Component inventory we already have

`frontend/components/ui/` already ships 50+ primitives — check before running
`add`. Notably:

- Layout: `card`, `sheet`, `dialog`, `drawer`, `resizable`, `resizable-panel`,
  `scroll-area`, `separator`, `sidebar`, `tabs`, `accordion`, `collapsible`.
- Forms: `form`, `input`, `textarea`, `select`, `MultiSelectWithOther`,
  `SelectWithOther`, `checkbox`, `radio-group`, `switch`, `slider`, `label`.
- Overlays: `popover`, `tooltip`, `hover-card`, `dropdown-menu`,
  `context-menu`, `command`, `alert-dialog`.
- Feedback: `alert`, `progress`, `skeleton`, `toast`, `toaster`, `sonner`.
- Display: `avatar`, `badge`, `table`, `chart`, `pagination`, `breadcrumb`,
  `kbd-badge`.

If you cannot find what you need here, then run `shadcn add`. Otherwise reuse.

## Path conventions

| File                                   | Where it should live                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| Pure shadcn primitive (Button, Dialog) | `frontend/components/ui/<kebab>.tsx`                         |
| Domain-specific composition            | `frontend/components/<domain>/<PascalCase>.tsx`              |
| Shared utility (cn, formatters)        | `frontend/lib/<camelCase>.ts`                                |
| Custom hook                            | `frontend/hooks/use<PascalCase>.ts`                          |
| Page entry point                       | `frontend/pages/<PascalCase>.tsx`                            |

Stay inside these — they are wired into Vite alias resolution and tsconfig
paths. Adding a top-level folder requires updating `vite.config.ts` and
`tsconfig.json`.
