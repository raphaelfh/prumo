import * as React from "react";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";

// `quiet`: deliberate divergence from upstream shadcn (ui-styling skill). It
// keeps the base min-h and takes no fixed height. Guard: quiet-controls.test.tsx.
const textareaVariants = cva(
  "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 resize-y",
  {
    variants: {
      variant: {
        default: "",
        quiet:
          "border-transparent bg-transparent px-2 text-[13px] shadow-none md:text-[13px] hover:bg-muted/60 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive aria-[invalid=true]:focus-visible:ring-2",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textareaVariants>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, variant, ...props }, ref) => {
  return <textarea className={cn(textareaVariants({ variant }), className)} ref={ref} {...props} />;
});
Textarea.displayName = "Textarea";

export { Textarea };
