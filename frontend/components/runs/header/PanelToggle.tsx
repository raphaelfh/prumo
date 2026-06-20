import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

/**
 * Right-hand source-panel (PDF) toggle. Mirror image of the left SidebarToggle:
 * PanelRight crossfade, ghost h-8 w-8, "\" keyshortcut. Together they bracket
 * the bar. `pressed` = panel OPEN.
 */
export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts="\"
      aria-label={t('runs', 'togglePanel')}
      className="relative h-8 w-8 shrink-0 p-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50"
    >
      <span className="relative block h-4 w-4">
        <PanelRightClose
          className={cn(
            'absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0',
            pressed ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        />
        <PanelRightOpen
          className={cn(
            'absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0',
            pressed ? 'opacity-0' : 'opacity-100',
          )}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
