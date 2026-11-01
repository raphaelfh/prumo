/**
 * The `?` popover (spec §4.5, ruling 7): every screening key, one row per
 * `SHORTCUT_ROWS` entry. Display only — the bindings live in
 * `TitleAbstractWorkspace`, `ListDetailSplitShell`, `useListKeyboardShortcuts`
 * and `DecisionButtons`; a row here must name a key one of them binds.
 *
 * `?` opens it through `useKeyboardShortcuts`, so it stays inert while typing
 * and under another overlay; Radix closes it on Escape (its `role="dialog"`
 * makes the shell's Escape chain yield). A maximized panel hides the toolbar,
 * so with no trigger box to anchor to, `?` shows the list in a centered dialog.
 * At full text the decide row drops Maybe (`3` is unbound there).
 */
import {HelpCircle} from 'lucide-react';
import {useRef, useState} from 'react';

import {IconButton} from '@/components/patterns/IconButton';
import {Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {KbdBadge, type KbdKey} from '@/components/ui/kbd-badge';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {t} from '@/lib/copy';
import type {screening} from '@/lib/copy/screening';
import type {ScreeningPhase} from '@/services/screeningService';

/** Each inner array is one chord chip; a row's chips are alternatives. */
type ShortcutRow = {chips: readonly KbdKey[][]; copyKey: keyof typeof screening};

const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  {chips: [['J'], ['K'], ['↓'], ['↑']], copyKey: 'shortcutMove'},
  {chips: [['Enter']], copyKey: 'shortcutOpen'},
  {chips: [['Esc']], copyKey: 'shortcutEsc'},
  {chips: [['X'], ['⇧-click'], ['mod', 'A']], copyKey: 'shortcutSelect'},
  {chips: [['⇧', 'mod', '\\']], copyKey: 'shortcutMaximize'},
  {chips: [['mod', '⇧', 'B']], copyKey: 'shortcutPanel'},
  {chips: [['1'], ['2'], ['3']], copyKey: 'shortcutDecide'},
  {chips: [['E'], ['1–9']], copyKey: 'shortcutReason'},
  {chips: [['mod', 'F']], copyKey: 'shortcutSearch'},
  {chips: [['F']], copyKey: 'shortcutFilter'},
  {chips: [['?']], copyKey: 'shortcutHelp'},
];

const FULL_TEXT_DECIDE: ShortcutRow = {chips: [['1'], ['2']], copyKey: 'shortcutDecideFullText'};

function ShortcutList({phase}: {phase: ScreeningPhase}) {
  const rows =
    phase === 'full_text'
      ? SHORTCUT_ROWS.map((row) => (row.copyKey === 'shortcutDecide' ? FULL_TEXT_DECIDE : row))
      : SHORTCUT_ROWS;
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {rows.map(({chips, copyKey}) => (
        <li key={copyKey} className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-muted-foreground">{t('screening', copyKey)}</span>
          <span className="flex shrink-0 items-center gap-1">
            {chips.map((keys) => (
              <KbdBadge key={keys.join('')} keys={keys} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ShortcutsHelp({phase = 'title_abstract'}: {phase?: ScreeningPhase}) {
  const [open, setOpen] = useState<'popover' | 'dialog' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useKeyboardShortcuts({
    enabled: true,
    bindings: [
      {
        type: 'chord',
        key: '?',
        shift: true,
        handler: () => setOpen((triggerRef.current?.getClientRects().length ?? 0) > 0 ? 'popover' : 'dialog'),
      },
    ],
  });

  const title = t('screening', 'shortcutsTitle');
  return (
    <>
      <Popover open={open === 'popover'} onOpenChange={(next) => setOpen(next ? 'popover' : null)}>
        <PopoverTrigger asChild>
          <IconButton
            ref={triggerRef}
            label={t('screening', 'shortcutsButton')}
            icon={<HelpCircle className="h-4 w-4" />}
            shortcut={['?']}
          />
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={title} className="w-72 text-[13px]">
          <p className="mb-2 font-medium">{title}</p>
          <ShortcutList phase={phase} />
        </PopoverContent>
      </Popover>
      <Dialog open={open === 'dialog'} onOpenChange={(next) => setOpen(next ? 'dialog' : null)}>
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <ShortcutList phase={phase} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
