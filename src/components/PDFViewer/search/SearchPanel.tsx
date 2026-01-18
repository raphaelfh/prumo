/**
 * SearchPanel - Painel de busca avançada no documento
 * 
 * Features:
 * - Busca em tempo real
 * - Case sensitive toggle
 * - Whole words toggle
 * - Regex support
 * - Navegação entre resultados
 * - Highlight de resultados
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X, ChevronUp, ChevronDown, Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { usePDFStore } from '@/stores/usePDFStore';
import { searchInDocument, type SearchResult } from '@/services/pdfSearchService';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchPanel({ isOpen, onClose }: SearchPanelProps) {
  const { 
    getPdfDocument, 
    goToPage,
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
  
  // Sincronizar query local com store
  const [query, setQuery] = useState(searchQuery);
  
  // Função para scroll fino até resultado (usado como fallback)
  const scrollToSearchResult = useCallback((pageNumber: number, matchIndex: number) => {
    // Esta função é mantida como fallback, mas o hook usePDFSearchHighlight
    // deve fazer o trabalho principal
    // Deixar aqui apenas para garantir que a página seja renderizada
    goToSearchResult(searchResults.findIndex(r => r.pageNumber === pageNumber && r.matchIndex === matchIndex));
  }, [goToSearchResult, searchResults]);

  // Função de busca real usando PDF.js
  const performSearch = useCallback(async () => {
    const currentQuery = query; // Capturar query atual
    
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
      console.warn('⚠️ Documento PDF não disponível para busca');
      return;
    }

    setIsSearching(true);
    setSearchProgress({ current: 0, total: pdfDoc.numPages });
    
    try {
      console.log('🔍 Buscando:', { query: currentQuery, caseSensitive, wholeWords, useRegex });
      
      const searchResults = await searchInDocument(
        pdfDoc,
        currentQuery,
        { caseSensitive, wholeWords, useRegex },
        (current, total) => {
          setSearchProgress({ current, total });
        }
      );
      
      console.log(`✅ Busca concluída: ${searchResults.length} página(s) com resultados`);
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
      console.error('❌ Erro na busca:', error);
      setLocalResults([]);
      setSearchResults([]);
      setCurrentSearchIndex(-1);
    } finally {
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
    }
  }, [query, caseSensitive, wholeWords, useRegex, getPdfDocument, setSearchResults, setSearchQuery, setCurrentSearchIndex, goToSearchResult, scrollToSearchResult]);

  // Buscar quando query mudar (debounced)
  // Usar ref para evitar re-execução quando performSearch muda
  const performSearchRef = useRef(performSearch);
  performSearchRef.current = performSearch;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearchRef.current();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]); // Apenas query como dependência

  // Sincronizar query local com store quando mudar externamente
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
              placeholder="Buscar no documento..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 pr-4"
              autoFocus
            />
          </div>

          {/* Navegação de resultados */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevResult}
              disabled={searchResults.length === 0}
              className="h-9 w-9"
              title="Resultado Anterior (Shift+Enter)"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextResult}
              disabled={searchResults.length === 0}
              className="h-9 w-9"
              title="Próximo Resultado (Enter)"
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
                title="Opções Avançadas"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

          {/* Fechar */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9"
            title="Fechar (Esc)"
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
                  Diferenciar maiúsculas/minúsculas
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
                  Palavras inteiras
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
                  Expressão regular
                </Label>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Status da busca */}
        {isSearching && searchProgress.total > 0 && (
          <div className="text-xs text-muted-foreground">
            Buscando... {searchProgress.current}/{searchProgress.total} páginas
          </div>
        )}
        
        {query && !isSearching && searchResults.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Nenhum resultado encontrado para "{query}"
          </div>
        )}
        
        {query && !isSearching && searchResults.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Encontrado em {localResults.length} página(s) • 
            Total: {searchResults.length} resultado(s)
          </div>
        )}
      </div>
    </div>
  );
}

