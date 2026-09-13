import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type {VariantProps} from 'class-variance-authority';
import {X} from 'lucide-react';

import {buttonVariants} from '@/components/ui/button';
import {
  dialogFrame,
  overlayBackdrop,
  overlayBody,
  overlayCloseButton,
  overlayDescription,
  overlayFooter,
  overlayHeader,
  overlayTitle,
} from '@/components/ui/overlay-frame';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn(overlayBackdrop, className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogFrame> {
  /** Hide the corner close control (a command palette closes on Escape). */
  showCloseButton?: boolean;
}

/**
 * Sizes (spec 2026-09-12 § 4.5): `sm` confirmations and one-field forms,
 * `md` forms (default), `lg` lists, pickers and imports at a fixed height.
 * Never size the frame with a className — check_ui_primitives.py gates it.
 * Compose `DialogHeader` / `DialogBody` / `DialogFooter`: the content has no
 * padding of its own, so the body can scroll under a fixed header and footer.
 */
const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({className, children, size, showCloseButton = true, ...props}, ref) => (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} className={cn(dialogFrame({size}), className)} {...props}>
        {children}
        {showCloseButton && (
          // No tooltip: autofocus would pop it the moment the dialog opens.
          <DialogPrimitive.Close
            aria-label={t('common', 'close')}
            className={cn(buttonVariants({variant: 'ghost', size: 'icon-xs'}), overlayCloseButton)}
          >
            <X />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayHeader, className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogBody = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayBody, className)} {...props} />
);
DialogBody.displayName = 'DialogBody';

const DialogFooter = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(overlayFooter, className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({className, ...props}, ref) => <DialogPrimitive.Title ref={ref} className={cn(overlayTitle, className)} {...props} />);
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({className, ...props}, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn(overlayDescription, className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription};
