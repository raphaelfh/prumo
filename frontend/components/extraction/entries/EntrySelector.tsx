/**
 * The entries of one repeating section, as tabs.
 *
 * Replaces `ModelSelector`, which rendered a `<Select>` dropdown. Spec §8
 * asks for tabs, and the reason shows up once groups nest: a dropdown hides
 * how many entries there are and costs a click to compare two, while a tab
 * strip makes the set visible at every depth. That is a different a11y
 * contract, not a rename — `tablist`/`tab`/`aria-selected` and a roving
 * tabindex rather than `combobox`/`option`.
 *
 * Copy KEYS are still the `model*` ones. They are renamed to `entry*` in the
 * commit that deletes `ModelSelector`, because both components cannot read
 * the same key through different names, and `t()` returns '' for a missing
 * key — a half-done rename ships blank strings rather than an error. The
 * copy VALUES are an e2e contract (`extraction-entry-identity.ui.e2e.ts`
 * matches them, not the keys) and do not change.
 */
import {ChevronDown, Loader2, ListChecks, Pencil, Plus, Sparkles, Trash2} from 'lucide-react';
import {useState} from 'react';
import type {ReactElement} from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';

import type {Entry} from './types';

export interface EntrySelectorProps {
  entries: Entry[];
  activeEntryId: string | null;
  onSelectEntry: (id: string) => void;
  onAddEntry: () => void;
  /** Absent for anyone but a manager — see `onDeleteEntries`. The RLS policy
   * on extraction_instances is manager-only and this delete goes through
   * PostgREST without a `.select()`, so a reviewer's DELETE would report
   * success while removing nothing. */
  onRemoveEntry?: (id: string) => void;
  onRenameEntry?: (id: string) => void;
  /** Bulk delete. Absent → the Select affordance is not offered at all. */
  onDeleteEntries?: (ids: string[]) => void;
  /** "Identify {noun}s with AI" — absent when the group declares no key. */
  onIdentifyEntries?: () => void;
  onExtractAllSections?: () => void;
  onExtractAllSectionsForAllEntries?: () => void;
  identifying?: boolean;
  extractingAllSections?: boolean;
  extractingAllSectionsForAllEntries?: boolean;
  /** The word for one entry — `entry_label` on the group. */
  entryLabel?: string;
  title?: string;
  readOnly?: boolean;
}

function progressBadge(progress: Entry['progress']): ReactElement | null {
  if (!progress || progress.total === 0) return null;
  const variant = progress.percentage === 100 ? 'default' : 'secondary';
  return (
    <Badge variant={variant} className="ml-1 shrink-0 text-[10px]">
      {progress.percentage}%
    </Badge>
  );
}

/** An icon-only control: tooltip on hover, accessible name always. */
function IconAction(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onClick}
            disabled={props.disabled}
            // `title` is kept ALONGSIDE the tooltip: the Spec A e2e locates
            // two of these by title attribute.
            title={props.label}
            aria-label={props.label}
            className={props.className ?? 'shrink-0'}
          >
            {props.children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{props.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function EntrySelector(props: EntrySelectorProps): ReactElement {
  const {
    entries,
    activeEntryId,
    onSelectEntry,
    onAddEntry,
    onRemoveEntry,
    onRenameEntry,
    onDeleteEntries,
    onIdentifyEntries,
    onExtractAllSections,
    onExtractAllSectionsForAllEntries,
    identifying = false,
    extractingAllSections = false,
    extractingAllSectionsForAllEntries = false,
    entryLabel = DEFAULT_ENTRY_NOUN,
    title,
    readOnly = false,
  } = props;

  // Selection mode is local: nothing above needs to know the strip is in it,
  // and leaving it must drop the ticks — a tick that survives out of sight
  // arms the next Select with rows the reviewer no longer means.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const confirmDelete = () => {
    onDeleteEntries?.([...selected]);
    setConfirming(false);
    leaveSelection();
  };

  const nounCap = entryLabel.charAt(0).toUpperCase() + entryLabel.slice(1);
  const activeEntry = entries.find((e) => e.instanceId === activeEntryId) ?? null;
  const bulkAvailable = !readOnly && onDeleteEntries !== undefined && entries.length > 0;
  const busy = identifying || extractingAllSectionsForAllEntries;
  const addLabel = t('extraction', 'modelAddManuallyTitle').replace('{{noun}}', entryLabel);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-4 shadow-elev-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {title ?? t('extraction', 'modelSelectorTitle').replace('{{noun}}', nounCap)}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t('extraction', 'modelSelectorDesc').replace('{{noun}}', entryLabel)}
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          {!readOnly && onIdentifyEntries && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-2"
                        disabled={busy}
                        title={t('extraction', 'modelExtractAITitle').replace('{{noun}}', entryLabel)}
                        aria-label={t('extraction', 'modelExtractAITitle').replace(
                          '{{noun}}',
                          entryLabel,
                        )}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {/* sr-only, never `hidden`: `hidden` drops the word from
                            the accessibility tree, so the control loses the
                            name it was only collapsing visually. */}
                        <span className="sr-only sm:not-sr-only">
                          {t('extraction', 'modelExtractAIShort')}
                        </span>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={onIdentifyEntries} disabled={busy}>
                        {t('extraction', 'modelExtractModelsOnly').replace('{{noun}}', entryLabel)}
                      </DropdownMenuItem>
                      {onExtractAllSectionsForAllEntries && (
                        <DropdownMenuItem
                          onClick={onExtractAllSectionsForAllEntries}
                          disabled={busy || entries.length === 0}
                        >
                          {t('extraction', 'modelExtractAllSections').replace(
                            '{{noun}}',
                            entryLabel,
                          )}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('extraction', 'modelExtractAITitle').replace('{{noun}}', entryLabel)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {bulkAvailable && !selecting && (
            <Button
              onClick={() => setSelecting(true)}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <ListChecks className="h-4 w-4" />
              {t('extraction', 'entrySelectStart')}
            </Button>
          )}

          {!readOnly && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onAddEntry}
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    title={addLabel}
                    aria-label={addLabel}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="sr-only sm:not-sr-only">
                      {t('extraction', 'modelNewShort')}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{addLabel}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('extraction', 'noModelsAdded').replace('{{noun}}', entryLabel)}
        </p>
      ) : selecting ? (
        <div className="space-y-2">
          {/* Checkboxes REPLACE the tabs rather than sitting beside them: a
              row that is both a tab and a checkbox has two meanings for one
              click, and the active entry is not what a bulk delete acts on. */}
          <div className="flex flex-wrap gap-1">
            {entries.map((entry) => (
              <label
                key={entry.instanceId}
                className="flex max-w-full items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.has(entry.instanceId)}
                  onCheckedChange={() => toggleOne(entry.instanceId)}
                  aria-label={t('extraction', 'entrySelectToggleOne').replace(
                    '{{name}}',
                    entry.entryName,
                  )}
                />
                <span className="truncate">{entry.entryName}</span>
                {progressBadge(entry.progress)}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t('extraction', 'entrySelectCount').replace('{{n}}', String(selected.size))}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0}
              onClick={() => setConfirming(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {t('extraction', 'entrySelectDelete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={leaveSelection}>
              {t('extraction', 'entrySelectCancel')}
            </Button>
          </div>

          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('extraction', 'entryBulkDeleteTitle')
                    .replace('{{n}}', String(selected.size))
                    .replace('{{noun}}', selected.size === 1 ? entryLabel : `${entryLabel}s`)}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('extraction', 'entryBulkDeleteBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('extraction', 'entrySelectCancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete}>
                  {t('extraction', 'entrySelectDelete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Tabs
            value={activeEntryId ?? undefined}
            onValueChange={onSelectEntry}
            className="min-w-0 flex-1"
          >
            {/* Content-width, left-aligned: a full-width list stretches a lone
                tab into something that reads as a table row, not a tab. */}
            <TabsList className="inline-flex max-w-full flex-wrap justify-start gap-1 h-auto">
              {entries.map((entry) => (
                <TabsTrigger
                  key={entry.instanceId}
                  value={entry.instanceId}
                  className="max-w-full gap-1 data-[state=active]:font-semibold"
                >
                  <span className="truncate">{entry.entryName}</span>
                  {progressBadge(entry.progress)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {!readOnly && activeEntryId && onRenameEntry && (
            <IconAction
              label={t('extraction', 'modelRenameActiveTitle').replace('{{noun}}', entryLabel)}
              onClick={() => onRenameEntry(activeEntryId)}
            >
              <Pencil className="h-4 w-4" />
            </IconAction>
          )}
          {!readOnly && activeEntryId && onRemoveEntry && (
            <IconAction
              label={t('extraction', 'modelRemoveActiveTitle').replace('{{noun}}', entryLabel)}
              onClick={() => onRemoveEntry(activeEntryId)}
              className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </IconAction>
          )}
        </div>
      )}

      {activeEntry && (
        <div className="rounded-lg border border-border/40 bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {t('extraction', 'modelActiveLabel').replace('{{noun}}', entryLabel)}
              </p>
              <p className="font-medium text-foreground mt-0.5 truncate">{activeEntry.entryName}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeEntry.progress && activeEntry.progress.total > 0 && (
                <span className="text-sm font-medium text-foreground">
                  {activeEntry.progress.completed}/{activeEntry.progress.total}
                </span>
              )}
              {!readOnly && onExtractAllSections && (
                <IconAction
                  label={
                    extractingAllSections
                      ? t('extraction', 'extractingAllSectionsWithAI')
                      : t('extraction', 'extractAllSectionsWithAI')
                  }
                  onClick={onExtractAllSections}
                  disabled={extractingAllSections}
                  className="p-0 shrink-0"
                >
                  {extractingAllSections ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-primary" />
                  )}
                </IconAction>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
