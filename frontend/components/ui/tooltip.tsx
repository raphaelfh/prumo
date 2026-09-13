import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import {cn} from '@/lib/utils';

// One timing for the whole app (spec 2026-09-12 § 3): the first tooltip waits
// long enough not to flicker under a sweeping mouse; its peers open at once.
const DELAY_MS = 400;
const SKIP_DELAY_MS = 300;

const ProviderMounted = React.createContext(false);

function TooltipProvider({
  delayDuration = DELAY_MS,
  skipDelayDuration = SKIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <ProviderMounted.Provider value>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
    </ProviderMounted.Provider>
  );
}

/**
 * App.tsx mounts the one provider. A component rendered on its own (a unit
 * test, a storybook-style harness) has none, and Radix throws without one —
 * which is why 38 call sites used to mount their own. Falling back here keeps
 * those renders working without a provider per call site.
 */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const mounted = React.useContext(ProviderMounted);
  const root = <TooltipPrimitive.Root {...props} />;
  return mounted ? root : <TooltipProvider>{root}</TooltipProvider>;
}

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({className, sideOffset = 6, ...props}, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-[12px] leading-4 text-background shadow-elev-popover dark:shadow-none',
        'duration-100 animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider};
