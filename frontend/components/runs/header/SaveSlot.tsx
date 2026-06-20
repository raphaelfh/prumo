import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  if (hidden) return null;
  const failed = state === 'error';
  const label = state === 'saving' ? t('extraction', 'runHeaderSaving') : failed ? t('extraction', 'runHeaderSaveFailed') : t('extraction', 'runHeaderSaved');
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')} title={lastSavedAt ? lastSavedAt.toLocaleTimeString() : undefined}>
      <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-destructive' : 'bg-success')} aria-hidden="true" />
      {label}
    </span>
  );
}
