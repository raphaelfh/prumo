import * as React from 'react';

import {Button, type ButtonProps} from '@/components/ui/button';
import {KbdBadge, type KbdKey} from '@/components/ui/kbd-badge';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {ariaKeyShortcuts} from '@/lib/platform';
import {cn} from '@/lib/utils';

interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'aria-label' | 'asChild'> {
  /** What the button does: its accessible name and, unless `tooltip` overrides it, its tooltip. Copy via lib/copy. */
  label: string;
  icon: React.ReactNode;
  /** KbdBadge keys of a shortcut this screen really binds. Shown as a chip and announced. Never infer one. */
  shortcut?: readonly KbdKey[];
  shortcutVariant?: 'chord' | 'sequence';
  size?: 'icon' | 'icon-xs';
  /** Tooltip text when it must differ from the stable name (a toggle naming its next action), or `false` when the name is already visible. */
  tooltip?: React.ReactNode | false;
  /** A muted second tooltip line. */
  hint?: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * The one icon-only control (spec 2026-09-12 § 4.3). The label is required,
 * so an icon button cannot ship without a name or a tooltip;
 * scripts/fitness/check_ui_primitives.py bans icon-sized Buttons elsewhere.
 *
 * Forwards ref and props to the Button, so it works as the `asChild` child of
 * any Radix trigger. A disabled button receives no pointer events, so its
 * tooltip is hung on a wrapping span instead.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {label, icon, shortcut, shortcutVariant = 'chord', size = 'icon', tooltip, hint, side, variant = 'ghost', className, disabled, ...props},
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        aria-label={label}
        aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
        className={cn('shrink-0 text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted', className)}
        {...props}
      >
        {icon}
      </Button>
    );
    if (tooltip === false) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
        <TooltipContent side={side}>
          <span className="flex items-center gap-1.5">
            <span>{tooltip ?? label}</span>
            {shortcut ? (
              <KbdBadge
                keys={[...shortcut]}
                variant={shortcutVariant}
                className="border-background/20 bg-background/10 text-background/80"
              />
            ) : null}
          </span>
          {hint ? <span className="block text-background/70">{hint}</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  },
);
IconButton.displayName = 'IconButton';
