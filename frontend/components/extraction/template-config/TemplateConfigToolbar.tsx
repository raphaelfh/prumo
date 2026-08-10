import {PanelRight, Search, SlidersHorizontal, X} from 'lucide-react';

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
  matchCount,
  totalCount,
  showKeyColumn,
  onShowKeyColumn,
  showOptionsColumn,
  onShowOptionsColumn,
  inspectorPressed,
  onToggleInspector,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  /** Filtered-match count while a search is active; null otherwise. */
  matchCount: number | null;
  totalCount: number;
  showKeyColumn: boolean;
  onShowKeyColumn: (show: boolean) => void;
  showOptionsColumn: boolean;
  onShowOptionsColumn: (show: boolean) => void;
  inspectorPressed: boolean;
  onToggleInspector: () => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2 border-b px-3">
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
          className="h-8 pl-7 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('extraction', 'gridSearchClear')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {matchCount !== null && (
        <span className="tabular-nums text-xs text-muted-foreground">
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
                className="h-8"
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
            className="h-8"
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
