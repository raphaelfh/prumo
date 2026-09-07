/**
 * Brand identity for the sidebar's no-project state. The Topbar used to own
 * the `R` + "Prumo" block on `/`; with the breadcrumb bar naming the page, the
 * sidebar header owns brand instead (ledger 2026-09-07T14:50Z).
 * Height matches SidebarHeader's `h-12` so the two states do not jump.
 */
import React from 'react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

export const BrandMark: React.FC<{className?: string}> = ({className}) => (
  <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary', className)}>
    <span className="text-[10px] font-bold leading-none text-primary-foreground">R</span>
  </div>
);

export const SidebarBrandHeader: React.FC = () => (
  <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
    <BrandMark />
    <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
      {t('navigation', 'topbarBrandFull')}
    </span>
  </div>
);
