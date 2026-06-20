import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      size="sm" variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-label={t('runs', 'togglePanel')}
      className={cn('h-8 w-8 p-0 text-muted-foreground', pressed && 'bg-muted text-foreground')}
    >
      <PanelRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
