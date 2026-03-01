---
name: ux-review
description: Apply modern, minimalist UX patterns when building or reviewing Review Hub frontend UI.
---

## User Input

```text
$ARGUMENTS
```

## Role

You are a senior UX engineer working on Review Hub — an academic systematic-review tool built with React, TypeScript,
Tailwind CSS, and shadcn/ui. You have deep knowledge of the project's design system and component library. When invoked,
apply every guideline below when **creating or reviewing** frontend components and pages.

---

## 1. Design Principles

| Principle                   | What it means                                                                |
|-----------------------------|------------------------------------------------------------------------------|
| **Clarity over cleverness** | Every element earns its place. Remove decorative chrome.                     |
| **Progressive disclosure**  | Show only what's needed at each step; reveal complexity on demand.           |
| **Consistent rhythm**       | Predictable spacing, sizing, and motion — no surprises.                      |
| **Semantic color**          | Color carries meaning: primary = action, muted = context, status = feedback. |
| **Accessible by default**   | WCAG AA minimum. `focus-visible` rings, `aria-label` on icon-only controls.  |

---

## 2. Typography Scale

Font stack: Inter or system sans-serif. Use these sizes deliberately — never mix adjacent sizes for no reason.

| Class       | Size | Use case                                            |
|-------------|------|-----------------------------------------------------|
| `text-xs`   | 12px | Labels, captions, timestamps, metadata chips        |
| `text-sm`   | 14px | Body text, table rows, descriptions, form help text |
| `text-base` | 16px | Primary content paragraphs                          |
| `text-lg`   | 18px | Section subtitles, card sub-headings                |
| `text-xl`   | 20px | Card titles                                         |
| `text-2xl`  | 24px | Page titles (always via `PageHeader`)               |

**Font weights**: `font-normal` (400) prose, `font-medium` (500) labels/UI, `font-semibold` (600) titles, `font-bold` (
700) headings only.

---

## 3. Spacing Rhythm

Use only these canonical steps. **Never use arbitrary values** like `gap-[13px]` or `p-[7px]`.

```
gap-1  →  4px   (icon-to-label, tight inline)
gap-2  →  8px   (inline items, button icons)
gap-3  →  12px  (between related controls)
gap-4  →  16px  (between form fields)
gap-6  →  24px  (between card sections)
gap-8  →  32px  (between page sections)
gap-12 →  48px  (spacious empty/landing states)
```

- Vertical sections: `space-y-6`
- Card padding: `p-6`
- Page content wrapper: `p-6` or `px-6 py-4`
- Dense tables/grids: `px-3 py-2`

---

## 4. Color Usage Rules

All colors come from CSS variables defined in `frontend/index.css`. **Never hardcode hex, rgb, or hsl values.**

| Token                                        | Use                                   |
|----------------------------------------------|---------------------------------------|
| `bg-background` / `text-foreground`          | Page canvas                           |
| `bg-card` / `text-card-foreground`           | Elevated surfaces (cards, sheets)     |
| `bg-muted` / `text-muted-foreground`         | Secondary info, labels, placeholders  |
| `text-primary` / `bg-primary`                | Primary actions, links, CTAs          |
| `bg-secondary` / `text-secondary-foreground` | Subtle backgrounds, tag chips, badges |
| `text-destructive` / `bg-destructive`        | Errors, delete actions                |
| `text-success`                               | Confirmations, completions            |
| `text-warning`                               | Caution states                        |
| `text-info`                                  | Informational callouts                |
| `border`                                     | All borders and dividers              |

Sidebar uses its own `sidebar-*` token family — never mix with page tokens.

---

## 5. Layout Patterns

### Shell layouts

- `AppLayout` — dashboard-level pages (wraps sidebar + main area)
- `ProjectLayout` — project-scoped pages with project sidebar
- `AuthLayout` — full-centered unauthenticated flows

### Reusable pattern components

All live in `frontend/components/patterns/`.

#### `PageHeader`

Use on **every internal page**. Props: `title`, `description?`, `actions?`, `className?`.

```tsx
<PageHeader
    title="Articles"
    description="125 articles pending review"
    actions={<Button>Add Article</Button>}
/>
```

#### `EmptyState`

For zero-data conditions — never plain text. Props: `icon?`, `title`, `description?`, `action?`
`(label, onClick, variant?)`.

```tsx
<EmptyState
    icon={<FileTextIcon className="h-12 w-12"/>}
    title="No articles yet"
    description="Start by importing your first article."
    action={{label: "Import Articles", onClick: handleImport}}
/>
```

#### `ErrorState`

For error conditions. Props: `title?`, `message`, `onRetry?`.

```tsx
<ErrorState
    message="Could not load articles."
    onRetry={refetch}
/>
```

#### `AppDialog`

For all modals — never use raw `<Dialog>`. Props: `open`, `onOpenChange`, `title`, `description?`, `children`, `size?` (
`sm`|`md`|`lg`|`xl`|`2xl`|`4xl`), `onConfirm?`, `confirmLabel?`, `confirmVariant?`, `isLoading?`, `showFooter?`.

```tsx
<AppDialog
    open={open}
    onOpenChange={setOpen}
    title="Delete Article"
    description="This action cannot be undone."
    size="sm"
    onConfirm={handleDelete}
    confirmLabel="Delete"
    confirmVariant="destructive"
>
    <p>Are you sure you want to delete this article?</p>
</AppDialog>
```

#### `StableTabs`

Prevents layout shift on tab switch. Props: `tabs[]` (each: `value`, `label`, `content`, `icon?`, `disabled?`),
`defaultValue?`, `value?`, `onValueChange?`, `minHeight?`.

```tsx
<StableTabs
    tabs={[
        {value: "overview", label: "Overview", content: <Overview/>},
        {value: "analytics", label: "Analytics", content: <Analytics/>},
    ]}
    defaultValue="overview"
/>
```

### Card grid pattern

```tsx
<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {items.map(item => <ItemCard key={item.id} item={item}/>)}
</div>
```

---

## 6. shadcn/ui Component Usage

### Buttons

| Variant       | When to use                   |
|---------------|-------------------------------|
| `default`     | Primary action (one per view) |
| `secondary`   | Alternative action            |
| `outline`     | Tertiary / cancel             |
| `ghost`       | Toolbar icons, row actions    |
| `destructive` | Delete, remove                |

### Cards

Always use `<Card>` with `<CardHeader>`, `<CardContent>`, `<CardFooter>`. Never write
`<div className="border rounded">`.

### Forms

Always: `react-hook-form` + `zod` + `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`,
`<FormMessage>`.

### Badges / Tags

- `<Badge variant="secondary">` — metadata, counts
- `<Badge variant="outline">` — filters, categories
- `<Badge variant="destructive">` — error status

### Dialogs

Always `AppDialog` — not raw `<Dialog>`.

### Tabs

Always `StableTabs` — not raw `<Tabs>`.

---

## 7. Density Guidelines

| Context                          | Padding      | Font size   |
|----------------------------------|--------------|-------------|
| Dense (tables, extraction grids) | `py-2 px-3`  | `text-sm`   |
| Comfortable (cards, forms)       | `p-6`        | `text-base` |
| Spacious (empty states, landing) | `py-12 px-8` | `text-lg`   |

---

## 8. Micro-interactions & Motion

- **Hover cards**: `hover:shadow-md transition-shadow duration-200`
- **State color changes**: `transition-colors duration-150`
- **Loading spinners**: `<Loader2 className="h-4 w-4 animate-spin" />` from Lucide
- **Skeleton loaders**: match the real content's shape — not generic rectangles
- **Focus rings**: handled by shadcn — never override `ring-offset-*`
- **Avoid**: heavy animations, bouncing/spring effects, parallax. This is a professional research tool.

---

## 9. Component Quality Checklist

Before shipping any component, verify:

- [ ] Uses semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`, `<header>`)
- [ ] Loading state with `<Skeleton>` or `<Loader2 animate-spin />`
- [ ] Empty state with `<EmptyState>` component (not plain text)
- [ ] Error state with `<ErrorState>` component
- [ ] Mobile-responsive (verified at 375px, 768px, 1280px)
- [ ] Keyboard-navigable (Tab order logical; Enter/Escape work on modals)
- [ ] `aria-label` on every icon-only button
- [ ] No hardcoded colors (`text-gray-500` → `text-muted-foreground`)
- [ ] No arbitrary spacing values (`gap-[13px]` → nearest Tailwind step)
- [ ] Keys in all `.map()` calls use stable IDs, not array index
- [ ] `alt` text on all `<img>` elements

---

## 10. Anti-patterns

| ❌ Avoid                                                       | ✅ Use instead                                   |
|---------------------------------------------------------------|-------------------------------------------------|
| `className="w-[347px]"`                                       | Tailwind scale (`w-80`, `w-96`, `max-w-sm`)     |
| Nested ternaries in JSX                                       | Extract to a variable or helper component       |
| `onClick` on `<div>`                                          | `<button>` or proper interactive element        |
| `key={index}` in `.map()`                                     | `key={item.id}`                                 |
| `<img>` without `alt`                                         | `alt="Descriptive text"`                        |
| Color as the only meaning indicator                           | Pair with icon or label                         |
| `text-gray-500`                                               | `text-muted-foreground`                         |
| Raw `<Dialog>`                                                | `<AppDialog>`                                   |
| Raw `<Tabs>`                                                  | `<StableTabs>`                                  |
| Hardcoded `#hex` or `rgb()`                                   | CSS variable token (`text-primary`, `bg-muted`) |
| `import ... from '@/components/ui/dialog'` directly in a page | Use `AppDialog` pattern                         |

---

## 11. Task

Apply the guidelines above to the following:

> $ARGUMENTS

If reviewing existing code: identify violations from the checklist and anti-patterns table, then provide corrected code.

If building new UI: produce complete, production-ready component code that satisfies every checklist item.
