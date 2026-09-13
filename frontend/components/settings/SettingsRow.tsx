import {useId, type ReactNode} from 'react';

import {FieldHint} from '@/components/patterns/FieldHint';
import {cn} from '@/lib/utils';

/** A container query on SettingsPage's body, not a viewport breakpoint: the
 *  body sits beside a 224px rail. Shared with SettingsActions. */
export const SETTINGS_ROW_GRID = 'grid gap-x-3 gap-y-1 py-1 @[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]';

export interface SettingsRowA11y {
  describedBy: string | undefined;
}

interface SettingsRowProps {
  label: string;
  /** The control's id. Omit for a row with no control (read-only text). */
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  /** Plain validation text. react-hook-form rows put FormMessage in the value cell instead. */
  error?: string;
  /** `start` for textareas, tag lists and multi-line value cells. */
  align?: 'center' | 'start';
  /** A hinted or errored row uses the render-prop and puts `describedBy` on
   *  the control (or on FormControl). Never cloneElement: the child is often
   *  not the control. */
  children: ReactNode | ((a11y: SettingsRowA11y) => ReactNode);
}

export function SettingsRow({label, htmlFor, hint, required, error, align = 'center', children}: SettingsRowProps) {
  const generatedId = useId();
  const baseId = htmlFor ?? generatedId;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={cn(
        SETTINGS_ROW_GRID,
        align === 'center' ? '@[36rem]/settings:items-center' : '@[36rem]/settings:items-start',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-1 @[36rem]/settings:justify-end',
          align === 'start' && '@[36rem]/settings:pt-1',
        )}
      >
        <label htmlFor={htmlFor} className="text-[13px] text-muted-foreground @[36rem]/settings:text-right">
          {label}
        </label>
        {/* Siblings of the label, never inside it: they must not join the control's name. */}
        {required ? <span aria-hidden="true" className="text-[13px] text-destructive">*</span> : null}
        {hint ? <FieldHint label={label} hint={hint} /> : null}
      </div>
      <div className="min-w-0">
        {typeof children === 'function' ? children({describedBy}) : children}
        {hint ? <span id={hintId} className="sr-only">{hint}</span> : null}
        {error ? <p id={errorId} className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
