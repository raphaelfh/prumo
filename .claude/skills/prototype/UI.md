# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

If the question is about logic or state rather than looks, this is the wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this page look like?"
- "Show me a few options for this panel before committing."
- "Try a different layout for the settings screen."
- A density pass where the direction itself is still open.

## Host the variants on a real page

A UI prototype is much easier to judge against the rest of the app: real header, real sidebar, real project data, real density. A throwaway route on its own is a vacuum where every variant looks fine.

- **Existing page (default).** Render the variants on the same route, gated by `?variant=`. Data fetching, route params, `ProtectedRoute` and TanStack queries all stay; only the rendered subtree swaps. Something that would live inside an existing page (a new panel, a new step) still goes here.
- **New page (last resort).** Only when nothing could host it. Add a dev-only route following the existing React Router setup, with `prototype` in the path, and the same `?variant=` pattern.

## Process

### 1. State the question and pick N

Default to **3 variants**, cap at 5. Write the plan in one line at the top of the switcher file:

> "Three variants of the project settings page, switchable via `?variant=`, on the existing settings route."

### 2. Generate radically different variants

Each variant:

- Serves the page's purpose with the data it already has.
- Uses prumo's primitives (`frontend/components/ui/`, shadcn, Tailwind tokens) and the `frontend-ux` density rules, so the comparison is about structure, not styling drift.
- Is a named component, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different**: different layout, information hierarchy, or primary affordance. Three tweaked card grids is not a prototype. If two drafts come out similar, redo one with an explicit constraint ("no card grid").

### 3. Wire them together

```tsx
const [searchParams] = useSearchParams();
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    {import.meta.env.DEV && <PrototypeSwitcher variants={['A', 'B', 'C']} current={variant} />}
  </>
);
```

Keep existing data fetching above the switcher.

### 4. Build the floating switcher

A small fixed bar at bottom centre:

- **Left and right arrows** cycle variants, wrapping around.
- **Label** shows the key and the variant's name, e.g. `B (Sidebar layout)`.
- Arrows update the search param through React Router, so a variant is shareable and survives reload.
- `←` and `→` also cycle, except when an input, textarea, or `[contenteditable]` has focus. Register them through `useKeyboardShortcuts` so they respect open dialogs.
- High contrast, so it is obviously not part of the design.
- Rendered only under `import.meta.env.DEV`.

### 5. Hand it over

Open the page in the Browser pane, screenshot each variant, and give the user the URL with the `?variant=` keys. The useful feedback is usually "the header from B with the sidebar from C", which is the real design.

### 6. Capture the answer and clean up

Once a variant wins, record which one and why, then follow rule 6 of [SKILL.md](SKILL.md): all variants go to the `prototype/<topic>` branch, and only the winner, rewritten properly, goes to `dev`.

## Anti-patterns

- **Variants that differ only in colour or copy.** Real variants disagree about structure.
- **Sharing a layout between variants.** A shared header is fine; a shared layout defeats the point.
- **Wiring variants to mutations.** Point any needed action at a stub.
- **Promoting variant code directly.** It was written without tests; rewrite it when folding in.
