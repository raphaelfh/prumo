import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/lib/copy';

const SHORTCUTS: { combo: string; key: 'shortcutPalette' | 'shortcutNextPrev' | 'shortcutTogglePdf' | 'shortcutSidebar' | 'shortcutEsc' }[] = [
  { combo: '⌘K', key: 'shortcutPalette' },
  { combo: 'J / K', key: 'shortcutNextPrev' },
  { combo: '\\', key: 'shortcutTogglePdf' },
  { combo: '⌘B', key: 'shortcutSidebar' },
  { combo: 'Esc', key: 'shortcutEsc' },
];

const GLOSSARY: ('glossaryExtract' | 'glossaryConsensus' | 'glossaryFinalize' | 'glossaryBlind' | 'glossaryDiffer')[] = [
  'glossaryExtract',
  'glossaryConsensus',
  'glossaryFinalize',
  'glossaryBlind',
  'glossaryDiffer',
];

/**
 * One "?" help panel = keyboard shortcuts + workflow glossary. Replaces the
 * ⌘K discoverability chip (the palette stays reachable by keyboard).
 */
export function Help() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground" aria-label={t('runs', 'helpButton')}>
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[13px]">
        <p className="mb-2 font-medium">{t('runs', 'helpTitle')}</p>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('runs', 'shortcutsHeading')}</p>
        <ul className="mb-3 space-y-1">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('runs', s.key)}</span>
              <KbdBadge keys={[s.combo]} />
            </li>
          ))}
        </ul>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('runs', 'glossaryHeading')}</p>
        <ul className="space-y-1 text-muted-foreground">
          {GLOSSARY.map((g) => (
            <li key={g}>{t('runs', g)}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
