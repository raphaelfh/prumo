/**
 * The "Move to section…" command dialog (B-6 T7, panel decisions 5+9).
 *
 * ONE instance for the whole grid, hosted by the panel — a per-row
 * dialog would mount a Radix tree under every ⋯ menu. Rows request it
 * through the grid's `onOpenMoveDialog` (open-for-field); the panel's
 * ⌘⇧M binding is the other entry. Destinations are `deriveMoveTargets`
 * — the CURRENT template only, which is the client-side guard against
 * the RLS hole (cross-template moves are server-writable today; B-7
 * owns the server fix) — minus the field's OWN section (a pick there
 * would silently reorder-to-end and arm an Undo toast for a "move" the
 * user didn't make). A pick moves the field to that section's END
 * via the panel's `moveFieldToSectionEnd`, which dispatches through
 * `moveFieldWithUndo` — the live-region announcement and the
 * single-slot Undo toast ride along automatically.
 *
 * Composed from Dialog + Command directly (not the CommandDialog
 * wrapper) because focus return is the PANEL's: Radix would restore
 * focus to whatever was active at open time — often `body`, since the
 * row menu's hand-off prevented its own trigger refocus — so
 * onCloseAutoFocus is prevented here and the panel's `onClose` puts
 * focus back on the field's cell (focusGridCellSoon).
 */
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import type {GridField, MoveTargetSection} from './templateTree';

export function MoveToSectionDialog({
  field,
  targets,
  onMove,
  onClose,
}: {
  /** Non-null = open for this field (the panel's single dialog slot). */
  field: GridField | null;
  targets: MoveTargetSection[];
  /** A pick moves to the destination's END. */
  onMove: (field: GridField, toSectionId: string) => void;
  /** Clears the slot; the panel returns focus to the field's cell. */
  onClose: () => void;
}) {
  return (
    <Dialog
      open={field !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0 shadow-lg"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {t('templateConfig', 'moveDialogTitle')}
        </DialogTitle>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
          <CommandInput
            placeholder={t('templateConfig', 'moveDialogPlaceholder').replace(
              '{{field}}',
              field?.label ?? '',
            )}
          />
          <CommandList>
            <CommandEmpty>{t('templateConfig', 'moveDialogEmpty')}</CommandEmpty>
            <CommandGroup heading={t('templateConfig', 'moveDialogHeading')}>
              {targets
                .filter((target) => target.id !== field?.entityTypeId)
                .map((target) => (
                  <CommandItem
                    key={target.id}
                    // The label is also the cmdk match value — ids would
                    // pollute typed filtering with uuid hex hits.
                    value={target.label}
                    onSelect={() => {
                      if (field) onMove(field, target.id);
                      onClose();
                    }}
                    className={cn('text-xs', target.kind === 'groupChild' && 'pl-6')}
                  >
                    {target.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
