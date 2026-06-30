import { HelpCircle } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
 * The help body = keyboard shortcuts + workflow glossary. Extracted so the same
 * content renders inside the inline Popover (wide header) AND the kebab-triggered
 * Dialog (narrow header, where Help has folded into the "three dots").
 */
export function HelpContent() {
  return (
    <>
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
    </>
  );
}

/**
 * One "?" help panel = keyboard shortcuts + workflow glossary. Replaces the
 * ⌘K discoverability chip (the palette stays reachable by keyboard).
 */
export function Help() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <HeaderIconButton aria-label={t('runs', 'helpButton')}>
          <HelpCircle strokeWidth={1.5} aria-hidden="true" />
        </HeaderIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[13px]">
        <p className="mb-2 font-medium">{t('runs', 'helpTitle')}</p>
        <HelpContent />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same help body in a Dialog. Used when the header narrows and Help folds
 * into the kebab: a Popover anchored to a portaled DropdownMenuItem is not
 * viable, so the menu item opens this controlled Dialog instead.
 */
export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-[13px]">
        <DialogHeader>
          <DialogTitle>{t('runs', 'helpTitle')}</DialogTitle>
        </DialogHeader>
        <HelpContent />
      </DialogContent>
    </Dialog>
  );
}
