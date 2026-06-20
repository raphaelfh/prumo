import { ChevronDown } from 'lucide-react';
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
    ? 'runHeaderBlindSuffix' as const
    : canReveal
      ? 'runHeaderRevealedSuffix' as const
      : null;
  const text = (
    <>
      {t('common', roleKeys[role])}
      {suffixKey && (
        <>
          <span className="text-muted-foreground" aria-hidden="true">{' · '}</span>
          <span className="text-muted-foreground">{t('extraction', suffixKey)}</span>
        </>
      )}
    </>
  );
  if (!canReveal) {
    return <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{text}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground">
          {text}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-[13px]">
        <p className="mb-2 text-muted-foreground">{t('extraction', 'runHeaderBlindExplainer')}</p>
        <Button size="sm" className="w-full" onClick={() => onReveal?.()}>{t('extraction', 'runHeaderReveal')}</Button>
      </PopoverContent>
    </Popover>
  );
}
