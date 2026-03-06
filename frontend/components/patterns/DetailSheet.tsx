/**
 * DetailSheet - Sheet for item details with fixed width.
 *
 * Usage:
 * <DetailSheet
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Article details"
 *   footer={<Button>Save</Button>}
 * >
 *   <p>Content...</p>
 * </DetailSheet>
 */

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
}

export function DetailSheet({ 
  open, 
  onOpenChange, 
  title, 
  children, 
  footer,
  side = 'right',
  className 
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side={side}
        className={cn(
          "w-[400px] sm:w-[540px] flex flex-col",
          className
        )}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

          {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto py-6">
          {children}
        </div>

          {/* Fixed footer */}
        {footer && (
          <div className="border-t pt-4 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

