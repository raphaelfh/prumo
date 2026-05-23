/**
 * Keyboard shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §6.
 *
 * - `chord`    → keys joined inside one chip (e.g. `⌘B`, `⌘⇧Q`) — pressed simultaneously.
 * - `sequence` → keys rendered as separate chips with a small gap (e.g. `[G] [S]`) —
 *                pressed one after the other. Mirrors Linear/Plane conventions.
 */
import React from 'react';
import {cn} from '@/lib/utils';
import {modifierLabel} from '@/lib/platform';

export type KbdKey = 'mod' | string;

interface KbdBadgeProps {
  keys: KbdKey[];
  variant?: 'chord' | 'sequence';
  className?: string;
}

const chipClasses =
  'inline-flex items-center justify-center rounded border border-border/40 bg-muted/40 ' +
  'px-1 min-w-[18px] h-[18px] font-mono text-[10px] text-muted-foreground/70 leading-none select-none';

export const KbdBadge: React.FC<KbdBadgeProps> = ({keys, variant = 'chord', className}) => {
  const rendered = keys.map((k) => (k === 'mod' ? modifierLabel() : k));

  if (variant === 'sequence') {
    return (
      <span aria-hidden="true" className={cn('inline-flex items-center gap-0.5', className)}>
        {rendered.map((k, i) => (
          <kbd key={i} className={chipClasses}>
            {k}
          </kbd>
        ))}
      </span>
    );
  }

  return (
    <kbd aria-hidden="true" className={cn(chipClasses, className)}>
      {rendered.join('')}
    </kbd>
  );
};

export default KbdBadge;
