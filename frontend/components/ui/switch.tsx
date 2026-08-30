import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import {cn} from "@/lib/utils";

/**
 * Upstream shadcn's geometry, minus its shadow. The 44x24 track / 20px thumb
 * stays (it is the only control on the inspector that already clears the
 * 24x24 target floor, and shrinking it to the 20px chrome tier would drop
 * below it), but `shadow-lg` does not: a 15px-blur drop shadow on a 20px
 * disc paints a grey halo that spills outside the pill, so the thumb reads
 * as a sticker pasted ON the track rather than a thumb sitting IN it. This
 * surface's elevation vocabulary is soft and minimal (frontend-ux §3).
 *
 * `p-0.5` replaces `border-2 border-transparent` — same 2px inset, but it
 * cannot be clobbered by a caller passing a `border-*` utility through
 * `className`.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-background shadow-xs ring-1 ring-foreground/10 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
