import * as React from "react";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";

// `quiet` is a deliberate divergence from upstream shadcn (ui-styling skill):
// the borderless settings control. `md:text-[13px]` is load-bearing — the
// base's `md:text-sm` would otherwise render it at 14px from 768px up.
// Guard: quiet-controls.test.tsx.
const inputVariants = cva(
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default: "",
        quiet:
          "h-8 border-transparent bg-transparent px-2 text-[13px] shadow-none md:text-[13px] hover:bg-muted/60 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

type InputProps = React.ComponentProps<"input"> & VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, variant, ...props }, ref) => {
  return <input type={type} className={cn(inputVariants({ variant }), className)} ref={ref} {...props} />;
});
Input.displayName = "Input";

export { Input };
