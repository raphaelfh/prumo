import {
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

import type {StructuralHistory} from './useStructuralHistory';

/**
 * The grid panel's toolbar row: search (with its own Esc rung), match
 * count, the Display column menu and the inspector toggle. Extracted
 * from TemplateConfigGridPanel in B-8 T5 (the panel sat at the
 * file-size ratchet ceiling); purely presentational — the panel owns
 * every piece of state behind these props.
 */
export function TemplateConfigToolbar({
  query,
  onQueryChange,
  history,
  matchCount,
  totalCount,
  showKeyColumn,
  onShowKeyColumn,
  showOptionsColumn,
  onShowOptionsColumn,
  railPressed,
  onToggleRail,
  inspectorPressed,
  onToggleInspector,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  /** The surface's one-level Undo/Redo slot (useStructuralHistory). */
  history: StructuralHistory;
  /** Filtered-match count while a search is active; null otherwise. */
  matchCount: number | null;
  totalCount: number;
  showKeyColumn: boolean;
  onShowKeyColumn: (show: boolean) => void;
  showOptionsColumn: boolean;
  onShowOptionsColumn: (show: boolean) => void;
  /** Outline-rail visibility — the left twin of `inspectorPressed`. */
  railPressed: boolean;
  onToggleRail: () => void;
  inspectorPressed: boolean;
  onToggleInspector: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      {/* The rail toggle sits LEFT of the search box, on the side of the
          pane it controls — the mirror of the inspector toggle on the far
          right. Hidden below the width where the rail itself can render
          (@[52rem]/grid), so it never toggles something invisible. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden @[52rem]/grid:inline-flex"
            aria-label={t('extraction', 'gridOutlineToggle')}
            aria-pressed={railPressed}
            onClick={onToggleRail}
          >
            <PanelLeft className="size-3.5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('extraction', 'gridOutlineToggle')}</TooltipContent>
      </Tooltip>

      <div className="relative w-[240px]">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            // Esc in the search box is the box's OWN rung 3: clear the
            // query and stop there — the ladder dispatcher must not
            // close the inspector or steal focus from typing.
            if (event.key === 'Escape') {
              event.stopPropagation();
              if (query) onQueryChange('');
            }
          }}
          placeholder={t('extraction', 'gridSearchPlaceholder')}
          aria-label={t('extraction', 'gridSearchPlaceholder')}
          className="h-8 pl-7 text-[13px]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('extraction', 'gridSearchClear')}
            className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* Undo/Redo sit immediately right of the search box and keep that
          slot whether or not a filter is active — the match count comes
          and goes, and a pair of buttons that slid sideways with it would
          be a moving target for the one gesture that follows a misclick.
          Icon-only, so each carries a stable aria-label; the tooltip adds
          WHICH edit is on the slot, which the label cannot (it changes). */}
      <div className="flex items-center">
        <HistoryButton
          icon={<Undo2 className="size-3.5" aria-hidden />}
          label={t('templateConfig', 'undoAction')}
          emptyLabel={t('templateConfig', 'historyUndoEmpty')}
          step={history.undoStep}
          disabled={history.busy}
          onClick={history.undo}
        />
        <HistoryButton
          icon={<Redo2 className="size-3.5" aria-hidden />}
          label={t('templateConfig', 'historyRedo')}
          emptyLabel={t('templateConfig', 'historyRedoEmpty')}
          step={history.redoStep}
          disabled={history.busy}
          onClick={history.redo}
        />
      </div>

      {matchCount !== null && (
        <span className="tabular-nums text-[11px] text-muted-foreground">
          {t('extraction', 'gridSearchCount')
            .replace('{{n}}', String(matchCount))
            .replace('{{total}}', String(totalCount))}
        </span>
      )}

      <span className="flex-1" />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('extraction', 'gridDisplayMenu')}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('extraction', 'gridDisplayMenu')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuCheckboxItem
            checked={showKeyColumn}
            onCheckedChange={(checked) => onShowKeyColumn(Boolean(checked))}
          >
            {t('extraction', 'gridDisplayKeyColumn')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showOptionsColumn}
            onCheckedChange={(checked) => onShowOptionsColumn(Boolean(checked))}
          >
            {t('extraction', 'gridDisplayOptionsColumn')}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('extraction', 'inspectorToggle')}
            aria-pressed={inspectorPressed}
            onClick={onToggleInspector}
          >
            <PanelRight className="size-3.5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('extraction', 'inspectorToggle')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** One leg of the Undo/Redo pair.
 *
 * Disabled is the honest state for an empty slot — this surface writes
 * every edit through immediately, so there is nothing to rewind until an
 * edit has actually landed. The tooltip still renders while disabled
 * (the trigger wraps a span, since a disabled button fires no pointer
 * events) so the manager can read WHY it is off. */
function HistoryButton({
  icon,
  label,
  emptyLabel,
  step,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  emptyLabel: string;
  step: {label: string} | null;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            disabled={disabled || step === null}
            onClick={onClick}
          >
            {icon}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {step ? `${label} — ${step.label}` : emptyLabel}
      </TooltipContent>
    </Tooltip>
  );
}
