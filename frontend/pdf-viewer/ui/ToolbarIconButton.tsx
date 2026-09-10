import type {ReactNode} from 'react';
import {Button, type ButtonProps} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

type ToolbarIconButtonProps = Omit<ButtonProps, 'size' | 'variant' | 'aria-label'> & {
  /** Accessible name — also the tooltip title unless `tooltip` overrides it. */
  label: string;
  /** Tooltip title when it must differ from the stable accessible name
   *  (a pressed toggle keeps one name while its tooltip names the action). */
  tooltip?: string;
  /** Second, muted tooltip line explaining what the control does. */
  hint?: ReactNode;
  children: ReactNode;
};

/**
 * Icon-only, chrome-density toolbar button that names itself and explains
 * itself on hover. Needs a `TooltipProvider` above it (the Toolbar owns one).
 */
export function ToolbarIconButton({label, tooltip, hint, children, ...props}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 px-2.5 py-1.5 text-[12px]">
        <p className="font-medium">{tooltip ?? label}</p>
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
