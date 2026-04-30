import {useEffect, useRef} from 'react';
import {ChevronUp, ChevronDown, X, Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import {searchDocument} from '../services/searchService';

export interface SearchBarProps {
  open: boolean;
  onClose: () => void;
}

export function SearchBar({open, onClose}: SearchBarProps) {
  const storeApi = useViewerStoreApi();
  const document = useViewerStore((s) => s.document);
  const search = useViewerStore((s) => s.search);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search: fires 250ms after query or options change.
  useEffect(() => {
    if (!open || !document) return;
    const query = search.query;
    const options = search.options;
    if (!query) {
      storeApi.getState().actions.setSearchMatches([]);
      return;
    }

    const ctrl = new AbortController();
    storeApi.getState().actions.setSearchSearching(true);
    const timer = setTimeout(() => {
      searchDocument(document, query, options, undefined, ctrl.signal)
        .then((matches) => {
          if (ctrl.signal.aborted) return;
          storeApi.getState().actions.setSearchMatches(matches);
        })
        .catch((err) => {
          if ((err as DOMException).name !== 'AbortError') {
            console.warn('pdf search failed', err);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) {
            storeApi.getState().actions.setSearchSearching(false);
          }
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, document, search.query, search.options, storeApi]);

  if (!open) return null;

  const {actions} = storeApi.getState();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) actions.goToPrevMatch();
      else actions.goToNextMatch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const matchCount = search.matches.length;
  const positionLabel =
    matchCount === 0
      ? search.searching
        ? 'Searching…'
        : search.query
          ? 'No results'
          : ''
      : `${search.activeIndex + 1} / ${matchCount}`;

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b bg-background"
      role="search"
      data-testid="pdf-search-bar"
    >
      <Search className="h-4 w-4 text-muted-foreground ml-1" />
      <Input
        ref={inputRef}
        value={search.query}
        onChange={(e) => actions.setSearchQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in document"
        className="h-8 w-64 text-sm"
        aria-label="Search query"
      />
      <span className="text-xs text-muted-foreground min-w-[68px] text-center">
        {positionLabel}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={matchCount === 0}
        onClick={() => actions.goToPrevMatch()}
        aria-label="Previous match"
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={matchCount === 0}
        onClick={() => actions.goToNextMatch()}
        aria-label="Next match"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <label className="flex items-center gap-1 text-xs text-muted-foreground ml-2">
        <input
          type="checkbox"
          checked={search.options.caseSensitive}
          onChange={(e) => actions.setSearchOptions({caseSensitive: e.target.checked})}
        />
        Aa
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={search.options.wholeWords}
          onChange={(e) => actions.setSearchOptions({wholeWords: e.target.checked})}
        />
        \b
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 ml-auto"
        onClick={onClose}
        aria-label="Close search"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
