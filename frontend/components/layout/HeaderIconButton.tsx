import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The one header action button: a 32px ghost icon button with a 44px touch
 * target (the `header-icon` size), muted-foreground default, and the shared
 * header hover/focus treatment. Every header affordance — notifications,
 * feedback, help, the kebab, the panel toggles — composes this so they stay
 * identical in size, hover, and focus across the run header and the Topbar.
 *
 * Icons auto-size to 16px (Button base `[&_svg]:size-4`); pass lucide icons with
 * `strokeWidth={1.5}` for the frontend-ux icon weight. Usable as a Radix trigger
 * via `asChild` since it forwards both ref and props down to Button.
 */
export const HeaderIconButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      size="header-icon"
      variant="ghost"
      className={cn(
        'shrink-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50 hover:text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
HeaderIconButton.displayName = 'HeaderIconButton';
