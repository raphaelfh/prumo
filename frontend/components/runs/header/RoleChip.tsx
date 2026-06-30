import { Eye } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';
import type { UserRole } from '@/lib/comparison/permissions';
import { useRunHeader } from './RunHeaderContext';

const roleKeys: Record<UserRole, 'roleManager' | 'roleReviewer' | 'roleConsensus' | 'roleViewer'> = {
  manager: 'roleManager',
  reviewer: 'roleReviewer',
  consensus: 'roleConsensus',
  viewer: 'roleViewer',
};

export function RoleChip() {
  const { role, isBlind, canReveal, onReveal } = useRunHeader();
  if (!role) return null;
  const suffixKey = isBlind
    ? 'blindSuffix' as const
    : canReveal
      ? 'revealedSuffix' as const
      : null;
  const text = (
    <>
      {t('common', roleKeys[role])}
      {suffixKey && (
        // Collapse the role qualifier on narrow headers so the chip shrinks to
        // just the role word before it folds entirely.
        <span className="hidden @[62rem]/headerbar:inline">
          <span className="text-muted-foreground" aria-hidden="true">{' · '}</span>
          <span className="text-muted-foreground">{t('runs', suffixKey)}</span>
        </span>
      )}
    </>
  );
  // The role qualifier is the lowest-priority Center affordance — fold the whole
  // chip (still in the DOM, just `hidden`) below 40rem so the row keeps the
  // StageRail + PrimaryAction. Above 40rem it shows as before.
  if (!canReveal) {
    return <span className="hidden @[40rem]/headerbar:inline-flex whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{text}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Always a visible, shrink-0 touch target so the blind-reveal action
            stays reachable on touch when the chip text folds at narrow widths:
            the Eye icon persists; the role text collapses below 40rem. The
            aria-label carries the role + reveal intent as the announced name. */}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${t('common', roleKeys[role])} — ${t('runs', 'reveal')}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-[11px] text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-9"
        >
          <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden items-center @[40rem]/headerbar:inline-flex">{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-[13px]">
        <p className="mb-2 text-muted-foreground">{t('runs', 'blindExplainer')}</p>
        <Button size="sm" className="w-full" onClick={() => onReveal?.()}>{t('runs', 'reveal')}</Button>
      </PopoverContent>
    </Popover>
  );
}
