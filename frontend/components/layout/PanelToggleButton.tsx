import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PanelToggleButtonProps {
  side: 'left' | 'right';
  pressed: boolean;
  onToggle: () => void;
  ariaLabel: string;
}

// One component for the three previously-duplicated header toggles (Topbar
// sidebar toggle, RunHeader SidebarToggle, RunHeader PanelToggle). `pressed`
// = panel/sidebar OPEN; the "Close" glyph shows when open.
export function PanelToggleButton({ side, pressed, onToggle, ariaLabel }: PanelToggleButtonProps) {
  const Close = side === 'left' ? PanelLeftClose : PanelRightClose;
  const Open = side === 'left' ? PanelLeftOpen : PanelRightOpen;
  return (
    <Button
      size="header-icon"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts={side === 'left' ? 'Meta+B' : '\\'}
      aria-label={ariaLabel}
      className="relative shrink-0 p-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50"
    >
      <span className="relative block h-4 w-4">
        <Close
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        />
        <Open
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
