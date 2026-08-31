import * as React from "react";
import {Slot} from "@radix-ui/react-slot";
import {cva, type VariantProps} from "class-variance-authority";

import {cn} from "@/lib/utils";

const buttonVariants = cva(
  // No `text-sm` here: font size is per-size (below), so a dense call site
  // does not have to override a base it cannot win against cleanly.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Named by ROLE, not by location. `sm` is the chrome tier at the h-7
      // density `frontend-ux` specifies, and it is what a Button renders
      // WITHOUT a size prop (see defaultVariants) — the compact tier is the
      // system standard, not a per-call-site opt-in. `default` (h-10) is the
      // deliberate CTA exception: empty states, auth, marketing.
      // Never override a height in a call site's className —
      // scripts/fitness/check_button_scale.py fails the build on a new one.
      //
      // Every dense size carries the coarse-pointer bump to 44px, and the
      // square sizes bump width too: `twMerge` keeps the bump alongside a
      // plain `h-*` (different modifier group), so a height-only bump would
      // render a tall thin sliver on touch.
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-7 rounded-md px-2.5 text-[13px] [@media(pointer:coarse)]:h-11",
        xs: "h-6 rounded-md px-2 text-xs [&_svg]:size-3.5 [@media(pointer:coarse)]:h-11",
        lg: "h-11 rounded-md px-8 text-sm",
        icon: "h-7 w-7 text-[13px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "icon-xs":
          "h-6 w-6 text-xs [&_svg]:size-3.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      // The compact tier is the DEFAULT, so the ~68 buttons that never named
      // a size stop rendering a 40px CTA in dense chrome (dialog footers were
      // the visible case: 40px controls beside 28px content). A CTA now opts
      // IN with size="default" rather than inheriting one by omission.
      size: "sm",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
