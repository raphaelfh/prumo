import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import {cn} from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

// Deliberate divergence from upstream shadcn, the same one `ui/button.tsx`
// documents: upstream's h-10 / text-sm is a full step above this codebase's
// chrome density. The scale below matches the `sm` Button and
// SectionViewSwitcher's segmented control, so a dialog cannot carry two type
// sizes. The list takes no height of its own — it is padding around the
// triggers, so the coarse-pointer bump grows the whole control instead of
// clipping a 44px trigger inside a 40px rail.
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({className, ...props}, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-0.5 rounded-md bg-muted/40 p-0.5 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({className, ...props}, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-7 items-center justify-center whitespace-nowrap rounded px-3 text-[13px] font-medium transition-colors duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:h-11",
      "text-muted-foreground hover:text-foreground",
      "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({className, ...props}, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export {Tabs, TabsList, TabsTrigger, TabsContent};
