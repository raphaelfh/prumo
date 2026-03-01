# Frontend UX & UI Design System (Plane/Linear/WorkOS Style)

## Role

You are a senior UX Engineer focused on **Productivity Software**. Your goal is to create an interface that feels like a
professional tool: fast, precise, and unobtrusive.

## 1. UX Philosophy: The "Invisible UI"

| Principle               | Description                                    | Implementation                                                             |
|-------------------------|------------------------------------------------|----------------------------------------------------------------------------|
| **Velocity**            | The UI should never lag or feel heavy.         | Use `backdrop-blur`, instant hover states, and optimized SVGs.             |
| **Information Density** | Professionals prefer seeing more data at once. | `text-[13px]` for body, `py-1` or `py-2` for rows.                         |
| **Visual Hierarchy**    | Contrast is used to guide, not to decorate.    | `text-foreground` for titles, `text-muted-foreground` for everything else. |
| **Contextual Actions**  | Actions appear only when needed.               | `group-hover` for row actions, subtle dropdowns.                           |
| **Breadcrumb First**    | Navigation > Page Titles.                      | Use breadcrumbs to show location instead of huge 24px titles.              |

## 2. Header & Menu Architecture

### The "Command" Header

Headers should be thin (h-12 / 48px) and serve as a navigation anchor, not just a title holder.

- **Background:** `bg-background/80` with `backdrop-blur-md`.
- **Border:** `border-b border-border/40`.
- **Typography:** `text-[13px] font-medium`.

### The "Professional" Sidebar

Sidebars should feel integrated into the window, not like a separate drawer.

- **Background:** `bg-[#fafafa]` (Light) or `bg-[#0c0c0c]` (Dark).
- **Active State:** A subtle `bg-muted` or `bg-primary/5`, never a heavy highlight.
- **Icons:** Always `h-4 w-4` with `strokeWidth={1.5}`.

## 3. Component Specifications

### Menus & Dropdowns (The Plane Style)

- **Shadows:** Use very soft, large shadows: `shadow-[0_8px_30px_rgb(0,0,0,0.04)]`.
- **Borders:** `border-border/50`.
- **Padding:** `p-1` for the container, `px-2 py-1.5` for items.
- **Corner Radius:** `rounded-md` (8px).

### Buttons

- **Primary:** High contrast (Black in light mode, White in dark mode).
- **Secondary:** Transparent background, subtle border.
- **Ghost:** Used for all toolbar/menu items until hovered.

## 4. Interaction Patterns

1. **The "Silent" Hover:** List items should change background color instantly (`duration-0` or `duration-75`).
2. **Skeleton Strategy:** Skeletons must match the exact line-height and width of the expected text to prevent layout
   shift.
3. **Status Dots:** Small (6px), glowing for "Active", muted for "Draft".

## 5. Implementation Checklist

- [ ] Header height is exactly `h-12`.
- [ ] Main UI font size is `text-[13px]`.
- [ ] Borders use `border-border/40`.
- [ ] Icons are `h-4 w-4` and consistent.
- [ ] Hover states on lists use `hover:bg-muted/50`.
- [ ] Breadcrumbs are used for navigation context.
- [ ] Shadows are soft and minimal.
