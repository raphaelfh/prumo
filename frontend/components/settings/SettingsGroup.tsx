import type {ReactNode} from 'react';

import {FieldHint} from '@/components/patterns/FieldHint';
import {cn} from '@/lib/utils';

interface SettingsGroupProps {
  title?: string;
  hint?: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/** One group of rows. SettingsPage's body holds only groups, so the `first:`
 *  resets leave exactly one hairline per boundary (frontend-ux §6). */
export function SettingsGroup({title, hint, tone = 'default', children}: SettingsGroupProps) {
  return (
    <div className="border-t border-border/40 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0">
      {title ? (
        <div className="mb-1 flex items-center gap-1">
          <h2 className={cn('text-[13px] font-medium', tone === 'danger' && 'text-destructive')}>{title}</h2>
          {hint ? <FieldHint label={title} hint={hint} /> : null}
        </div>
      ) : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}
