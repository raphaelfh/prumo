import * as SheetPrimitive from '@radix-ui/react-dialog';
import type {VariantProps} from 'class-variance-authority';
import {X} from 'lucide-react';
import * as React from 'react';

import {buttonVariants} from '@/components/ui/button';
import {overlayBackdrop, overlayCloseButton, overlayDescription, overlayHeader, overlayTitle, sheetFrame} from '@/components/ui/overlay-frame';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const Sheet = SheetPrimitive.Root;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({className, ...props}, ref) => <SheetPrimitive.Overlay ref={ref} className={cn(overlayBackdrop, className)} {...props} />);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetFrame> {
  /** When false, hides the built-in corner close control (e.g. when the child provides its own dismiss UI). */
  showCloseButton?: boolean;
}

/** `default` (420px) holds persistent context beside the page; `narrow` (320px) is for navigation rails and inspectors. */
const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({side, size, className, children, showCloseButton = true, ...props}, ref) => (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetFrame({side, size}), className)} {...props}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            aria-label={t('common', 'close')}
            className={cn(buttonVariants({variant: 'ghost', size: 'icon-xs'}), overlayCloseButton)}
          >
            <X />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayHeader, className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({className, ...props}, ref) => <SheetPrimitive.Title ref={ref} className={cn(overlayTitle, className)} {...props} />);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({className, ...props}, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn(overlayDescription, className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle};
