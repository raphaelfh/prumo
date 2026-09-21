import {useEffect, useRef} from 'react';
import {ChevronUp, ChevronDown, X, Search} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {Input} from '@/components/ui/input';
import {t} from '@/lib/copy';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import {searchDocument} from '../services/searchService';

export interface SearchBarProps {
  open: boolean;
  onClose: () => void;
  /**
   * Bumped on every ⌘F press. Opening alone cannot drive the focus effect:
   * a second ⌘F while the bar is already open leaves `open` true, so the
   * effect never re-runs and the caret stays wherever it was (the form field
   * the reviewer was typing in). The counter changes on every press, so the
   * key always lands in the find box.
   */
  focusRequest?: number;
}

export function SearchBar({open, onClose, focusRequest}: SearchBarProps) {
  const storeApi = useViewerStoreApi();
  const document = useViewerStore((s) => s.document);
  const mode = useViewerStore((s) => s.mode);
  const search = useViewerStore((s) => s.search);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened, and select any carried-over query so it can be
  // replaced by typing immediately (standard find-bar behaviour).
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, focusRequest]);

  // Debounced PDF search: fires 250ms after query or options change. Canvas
  // only — in reader mode the reader searches its own rendered markdown and
  // reports its match count via `setReaderMatchCount`.
  useEffect(() => {
    if (!open || mode !== 'canvas' || !document) return;
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
  }, [open, mode, document, search.query, search.options, storeApi]);

  if (!open) return null;

  const {actions} = storeApi.getState();

  // Editor-grade match navigation from the input: Enter / F3 / Cmd|Ctrl+G go to
  // the next match, with Shift for the previous. Esc closes.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isNavKey =
      e.key === 'Enter' ||
      e.key === 'F3' ||
      (e.key.toLowerCase() === 'g' && (e.metaKey || e.ctrlKey));
    if (isNavKey) {
      e.preventDefault();
      if (e.shiftKey) actions.goToPrevMatch();
      else actions.goToNextMatch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Keep focus in the input after a chevron click so Enter/F3 keep working.
  const goPrev = () => {
    actions.goToPrevMatch();
    inputRef.current?.focus();
  };
  const goNext = () => {
    actions.goToNextMatch();
    inputRef.current?.focus();
  };

  const matchCount = search.matchCount;
  const positionLabel =
    matchCount === 0
      ? search.searching
        ? t('pdf', 'viewerSearchSearching')
        : search.query
          ? t('pdf', 'viewerSearchNoResults')
          : ''
      : `${search.activeIndex + 1} / ${matchCount}`;

  return (
    <div
      className="flex min-w-0 items-center gap-1 px-2 py-1 border-b bg-background"
      role="search"
      data-testid="pdf-search-bar"
    >
      <Search className="h-4 w-4 text-muted-foreground ml-1" />
      <Input
        ref={inputRef}
        value={search.query}
        onChange={(e) => actions.setSearchQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('pdf', 'viewerSearchPlaceholder')}
        className="h-8 w-full min-w-0 max-w-64 text-sm"
        aria-label={t('pdf', 'viewerSearchQueryLabel')}
      />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-xs text-muted-foreground min-w-[68px] text-center"
      >
        {positionLabel}
      </span>
      <IconButton
        label={t('pdf', 'viewerSearchPrevMatch')}
        disabled={matchCount === 0}
        onClick={goPrev}
        icon={<ChevronUp />}
      />
      <IconButton
        label={t('pdf', 'viewerSearchNextMatch')}
        disabled={matchCount === 0}
        onClick={goNext}
        icon={<ChevronDown />}
      />
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
      <IconButton
        label={t('pdf', 'viewerSearchClose')}
        className="ml-auto"
        onClick={onClose}
        icon={<X />}
      />
    </div>
  );
}
