import {Info} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useIsCoarsePointer} from '@/hooks/use-mobile';
import {t} from '@/lib/copy';

interface FieldHintProps {
  /** The field or group the hint explains; names the trigger "About {label}". */
  label: string;
  hint: string;
}

/**
 * The ⓘ beside a settings label (spec 2026-09-13-borderless-density-pass §4.1).
 * Fine pointer: the hint is the IconButton's tooltip (its `tooltip`, not its
 * `hint` second line). Coarse pointer: Radix tooltips do not open on tap, so a
 * tap toggles a popover with the same text. SettingsRow also wires the text to
 * the control through aria-describedby; this trigger is the visual path.
 */
export function FieldHint({label, hint}: FieldHintProps) {
  const coarse = useIsCoarsePointer();
  const name = t('common', 'fieldHintAria').replace('{{label}}', label);
  const icon = <Info strokeWidth={1.5} />;

  if (!coarse) return <IconButton label={name} tooltip={hint} size="icon-xs" icon={icon} />;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={name} tooltip={false} size="icon-xs" icon={icon} />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-2 text-[13px]">
        {hint}
      </PopoverContent>
    </Popover>
  );
}
