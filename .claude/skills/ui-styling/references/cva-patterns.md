# cva patterns

`class-variance-authority` is how we declare component variants. The pattern is
the same across every `frontend/components/ui/*.tsx`.

## The shape

```tsx
import {cva, type VariantProps} from "class-variance-authority";
import {cn} from "@/lib/utils";

const fooVariants = cva(
  // 1. Base classes — applied to every instance regardless of variant
  "inline-flex items-center justify-center rounded-md transition-colors",
  {
    // 2. Discrete variant axes — each key creates a prop
    variants: {
      tone: {
        neutral:  "bg-muted text-muted-foreground",
        accent:   "bg-primary text-primary-foreground",
        danger:   "bg-destructive text-destructive-foreground",
      },
      size: {
        sm: "h-8 px-2 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
      block: {
        true: "w-full",   // boolean variant — produces `block?: boolean`
        false: "",
      },
    },
    // 3. Variant combinations that need extra rules
    compoundVariants: [
      { tone: "danger", size: "lg", className: "shadow-md shadow-destructive/20" },
    ],
    // 4. Defaults if the consumer omits the prop
    defaultVariants: {
      tone: "neutral",
      size: "md",
      block: false,
    },
  },
);

// 5. Public type derives variant props automatically
export interface FooProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof fooVariants> {}

// 6. cn() puts className last so caller overrides win
export function Foo({ className, tone, size, block, ...rest }: FooProps) {
  return <div className={cn(fooVariants({ tone, size, block }), className)} {...rest} />;
}
```

## Why this shape

- **Base + variants split** lets `tailwind-merge` resolve correctly: the base
  declares the structural utilities (`rounded-md`, `inline-flex`), variants
  override colors/sizes. Same utility appearing in both means the variant wins.
- **`VariantProps<typeof fooVariants>`** gives the consumer literal-union
  autocomplete (`tone: "neutral" | "accent" | "danger"`) — never `tone: string`.
- **`className` last in `cn()`** is the social contract. The consumer can always
  refine a single instance without forking the variant.

## Boolean variants

Boolean variants need both `true` and `false` keys (or `false: ""`). If you
only declare `true`, the type is `block: true | undefined`, never `false`.

## Compound variants

Use them sparingly — they fire when **all** listed conditions match. Good for
"danger + large needs a glow", bad for "10 special cases". If you have more
than 3, the variant axes are probably wrong.

## Asymmetric variants (size differs from upstream shadcn)

Our `Button` has `default | sm | lg | icon`. If a domain needs `xs`, do not add
it to `ui/button.tsx` unless we want it everywhere. Instead, wrap:

```tsx
// frontend/components/runs/CompactRunButton.tsx
import {Button, type ButtonProps} from "@/components/ui/button";
import {cn} from "@/lib/utils";

export function CompactRunButton({ className, ...rest }: ButtonProps) {
  return (
    <Button
      size="sm"
      className={cn("h-7 px-2 text-[11px]", className)}
      {...rest}
    />
  );
}
```

## `asChild` + Radix `Slot`

`asChild` lets a button render as something else (a `<Link>`, an `<a>`) while
keeping the styles. Pattern from `ui/button.tsx`:

```tsx
import {Slot} from "@radix-ui/react-slot";

const Comp = asChild ? Slot : "button";
return <Comp className={cn(fooVariants({ variant, size, className }))} ref={ref} {...props} />;
```

The `Slot` merges `className` and event handlers into the **single child** —
so consumers must not pass multiple children when `asChild` is true.

## Escape hatch: arbitrary class slots

When a variant needs a value the consumer must supply (e.g. a row count),
expose a separate prop instead of stuffing it into the variant. cva does not
take parameters.

```tsx
interface FooProps extends VariantProps<typeof fooVariants> {
  rows?: number;
}

<div
  className={cn(fooVariants({ tone }), rows && `grid-rows-${rows}`)}
  style={{ "--rows": rows } as React.CSSProperties}
/>
```

But: `grid-rows-${rows}` is **dynamic** and Tailwind cannot scan it. Either
add a safelist entry in `tailwind.config.ts` or — better — use
`gridTemplateRows` via inline style or a CSS variable.

## Naming

- Variant axes are nouns: `tone`, `size`, `intent`, `density`. Not `red`, `big`.
- Variant values are semantic: `danger`, not `red`. `compact`, not `small`.
- Variant function is `<componentName>Variants` and is **named-exported** so
  downstream code can compose: `cn(buttonVariants({ variant: "ghost" }), "...")`.

## Typing tricks

If you need the props **without** the cva-generated keys (e.g. for a hook):

```tsx
type FooOwnProps = Omit<FooProps, keyof VariantProps<typeof fooVariants>>;
```

Conversely, to enforce that a downstream wrapper passes through variant props
explicitly:

```tsx
type Required = VariantProps<typeof fooVariants>;
function Wrapper(props: Required) {
  return <Foo {...props} />;
}
```

## When not to use cva

- **One-instance components.** A page-specific banner does not need variants;
  inline `className` is fine.
- **Layout primitives.** A grid wrapper rarely has tone/size axes; plain
  Tailwind utilities are clearer.
- **Slots that already discriminate by Radix state.** `data-[state=open]:bg-…`
  is the variant; do not duplicate it in cva.
