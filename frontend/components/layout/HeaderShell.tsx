import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const headerShellVariants = cva(
  // Declares its OWN container so every responsive child keys off the header's
  // width (works identically whether or not the app sidebar is open).
  '@container/headerbar w-full border-b border-border/40 frosted-header transition-shadow duration-150 motion-reduce:transition-none',
  {
    variants: {
      position: {
        sticky: 'sticky top-0 z-header',
        relative: 'relative z-header',
      },
      lifted: {
        true: 'shadow-elev-header',
        false: '',
      },
    },
    defaultVariants: { position: 'sticky', lifted: false },
  },
);

export interface HeaderShellProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof headerShellVariants> {}

export const HeaderShell = React.forwardRef<HTMLElement, HeaderShellProps>(
  ({ className, position, lifted, children, ...props }, ref) => (
    <header ref={ref} className={cn(headerShellVariants({ position, lifted }), className)} {...props}>
      <div className="flex h-12 items-center gap-2 px-3 @[48rem]/headerbar:gap-4 @[48rem]/headerbar:px-6">
        {children}
      </div>
    </header>
  ),
);
HeaderShell.displayName = 'HeaderShell';
