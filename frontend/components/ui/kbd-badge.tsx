/**
 * Keyboard shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §6.
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

export const KbdBadge: React.FC<KbdBadgeProps> = ({keys, variant = 'chord', className}) => {
  const rendered = keys.map((k) => (k === 'mod' ? modifierLabel() : k));
  const text = variant === 'sequence' ? rendered.join('·') : rendered.join('');

  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded border border-border/40 bg-muted/40',
        'px-1 min-w-[18px] h-[18px] font-mono text-[10px] text-muted-foreground/70 leading-none',
        'select-none',
        className,
      )}
    >
      {text}
    </kbd>
  );
};

export default KbdBadge;
