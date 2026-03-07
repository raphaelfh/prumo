/**
 * SearchPanel - Advanced document search panel
 * 
 * Features:
 * - Busca em tempo real
 * - Case sensitive toggle
 * - Whole words toggle
 * - Regex support
 * - Navigation between results
 * - Highlight de resultados
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronUp, Search, Settings2, X} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {Collapsible, CollapsibleContent, CollapsibleTrigger,} from '@/components/ui/collapsible';
import {usePDFStore} from '@/stores/usePDFStore';
import {searchInDocument, type SearchResult} from '@/services/pdfSearchService';
import {t} from '@/lib/copy';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchPanel({ isOpen, onClose }: SearchPanelProps) {
  const { 
    getPdfDocument,
      goToPage: _goToPage,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    currentSearchIndex,
    setCurrentSearchIndex,
    goToSearchResult,
  } = usePDFStore();
  
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });

    // Sync local query with store
  const [query, setQuery] = useState(searchQuery);

    // Fine scroll to result (used as fallback)
  const scrollToSearchResult = useCallback((pageNumber: number, matchIndex: number) => {
      // Kept as fallback; usePDFSearchHighlight does the main work
      // Kept here only to ensure the page is rendered
    goToSearchResult(searchResults.findIndex(r => r.pageNumber === pageNumber && r.matchIndex === matchIndex));
  }, [goToSearchResult, searchResults]);

    // Actual search using PDF.js
  const performSearch = useCallback(async () => {
      const currentQuery = query; // Capture current query
    
    if (!currentQuery.trim()) {
      setLocalResults([]);
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      setSearchProgress({ current: 0, total: 0 });
      setSearchQuery('');
      return;
    }

    const pdfDoc = getPdfDocument();
    if (!pdfDoc) {
        console.warn('PDF document not available for search');
      return;
    }

    setIsSearching(true);
    setSearchProgress({ current: 0, total: pdfDoc.numPages });
    
    try {
        console.warn('🔍 Buscando:', {query: currentQuery, caseSensitive, wholeWords, useRegex});
      
      const searchResults = await searchInDocument(
        pdfDoc,
        currentQuery,
        { caseSensitive, wholeWords, useRegex },
        (current, total) => {
          setSearchProgress({ current, total });
        }
      );

        console.warn(`Search complete: ${searchResults.length} page(s) with results`);
      setLocalResults(searchResults);
      
      // Transformar resultados em formato flat para store
      const flatResults: Array<{ pageNumber: number; matchIndex: number }> = [];
      searchResults.forEach((result) => {
        result.matches.forEach((_, matchIndex) => {
          flatResults.push({
            pageNumber: result.pageNumber,
            matchIndex,
          });
        });
      });
      
      setSearchResults(flatResults);
      setSearchQuery(currentQuery);
      
      // Navegar para primeiro resultado
      if (flatResults.length > 0) {
        setCurrentSearchIndex(0);
        goToSearchResult(0);
        scrollToSearchResult(flatResults[0].pageNumber, flatResults[0].matchIndex);
      } else {
        setCurrentSearchIndex(-1);
      }
    } catch (error) {
        console.error('Search error:', error);
      setLocalResults([]);
      setSearchResults([]);
      setCurrentSearchIndex(-1);
    } finally {
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
    }
  }, [query, caseSensitive, wholeWords, useRegex, getPdfDocument, setSearchResults, setSearchQuery, setCurrentSearchIndex, goToSearchResult, scrollToSearchResult]);

    // Search when query changes (debounced)
  // Usar ref para evitar re-execução quando performSearch muda
  const performSearchRef = useRef(performSearch);
  performSearchRef.current = performSearch;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearchRef.current();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]); // Apenas query como dependência

    // Sync local query with store when it changes externally
  useEffect(() => {
    if (searchQuery !== query) {
      setQuery(searchQuery);
    }
  }, [searchQuery]);

  // Navegar para página quando currentSearchIndex mudar
  useEffect(() => {
    if (currentSearchIndex >= 0 && searchResults.length > 0) {
      const result = searchResults[currentSearchIndex];
      if (result) {
        // Navegar para a página (o hook usePDFSearchHighlight fará o scroll fino)
        goToSearchResult(currentSearchIndex);
      }
    }
  }, [currentSearchIndex, searchResults, goToSearchResult]);

  const goToNextResult = () => {
    if (searchResults.length === 0) return;
    const newIndex = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(newIndex);
  };

  const goToPrevResult = () => {
    if (searchResults.length === 0) return;
    const newIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(newIndex);
  };

  // Atalhos de teclado
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        goToNextResult();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
          goToPrevResult();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, searchResults, currentSearchIndex, goToNextResult, goToPrevResult]);

  if (!isOpen) return null;

  return (
    <div className="w-full bg-background border-b shadow-lg z-40">
      <div className="p-3 space-y-3">
        {/* Campo de busca principal */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('pdf', 'searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 pr-4"
              autoFocus
            />
          </div>

            {/* Results navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevResult}
              disabled={searchResults.length === 0}
              className="h-9 w-9"
              title={t('pdf', 'searchPrevResult')}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextResult}
              disabled={searchResults.length === 0}
              className="h-9 w-9"
              title={t('pdf', 'searchNextResult')}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            
            {/* Contador */}
            <Badge variant="secondary" className="min-w-[60px] justify-center">
              {searchResults.length === 0 
                ? '0/0' 
                : `${currentSearchIndex + 1}/${searchResults.length}`}
            </Badge>
          </div>

          {/* Opções avançadas */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                title={t('pdf', 'searchAdvancedOptions')}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

            {/* Close */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9"
            title={t('pdf', 'searchClose')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Opções avançadas (colapsável) */}
        <Collapsible open={advancedOpen}>
          <CollapsibleContent>
            <div className="flex items-center gap-4 pl-2 pt-2 border-t">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="case-sensitive"
                  checked={caseSensitive}
                  onCheckedChange={(checked) => setCaseSensitive(checked as boolean)}
                />
                <Label
                  htmlFor="case-sensitive"
                  className="text-sm font-normal cursor-pointer"
                >
                    {t('pdf', 'searchCaseSensitive')}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="whole-words"
                  checked={wholeWords}
                  onCheckedChange={(checked) => setWholeWords(checked as boolean)}
                />
                <Label
                  htmlFor="whole-words"
                  className="text-sm font-normal cursor-pointer"
                >
                    {t('pdf', 'searchWholeWords')}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="regex"
                  checked={useRegex}
                  onCheckedChange={(checked) => setUseRegex(checked as boolean)}
                />
                <Label
                  htmlFor="regex"
                  className="text-sm font-normal cursor-pointer"
                >
                    {t('pdf', 'searchRegex')}
                </Label>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Status da busca */}
        {isSearching && searchProgress.total > 0 && (
          <div className="text-xs text-muted-foreground">
              {t('pdf', 'searchSearching').replace('{{current}}', String(searchProgress.current)).replace('{{total}}', String(searchProgress.total))}
          </div>
        )}
        
        {query && !isSearching && searchResults.length === 0 && (
          <div className="text-xs text-muted-foreground">
              {t('pdf', 'searchNoResults').replace('{{query}}', query)}
          </div>
        )}
        
        {query && !isSearching && searchResults.length > 0 && (
          <div className="text-xs text-muted-foreground">
              {t('pdf', 'searchResultsInPages').replace('{{n}}', String(localResults.length))} •
              {t('pdf', 'searchTotalResults').replace('{{n}}', String(searchResults.length))}
          </div>
        )}
      </div>
    </div>
  );
}

