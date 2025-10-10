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

import { useState, useCallback, useEffect } from 'react';
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
  const { getPdfDocument, goToPage } = usePDFStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });

  // Função de busca real usando PDF.js
  const performSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setCurrentIndex(-1);
      setSearchProgress({ current: 0, total: 0 });
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
      console.log('🔍 Buscando:', { query, caseSensitive, wholeWords, useRegex });
      
      const searchResults = await searchInDocument(
        pdfDoc,
        query,
        { caseSensitive, wholeWords, useRegex },
        (current, total) => {
          setSearchProgress({ current, total });
        }
      );
      
      console.log(`✅ Busca concluída: ${searchResults.length} página(s) com resultados`);
      setResults(searchResults);
      setCurrentIndex(searchResults.length > 0 ? 0 : -1);
      
      // Navegar para primeira página com resultado
      if (searchResults.length > 0) {
        goToPage(searchResults[0].pageNumber);
      }
    } catch (error) {
      console.error('❌ Erro na busca:', error);
      setResults([]);
      setCurrentIndex(-1);
    } finally {
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
    }
  }, [query, caseSensitive, wholeWords, useRegex, getPdfDocument, goToPage]);

  // Buscar quando query mudar (debounced)
  useEffect(() => {
    const timer = setTimeout(performSearch, 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const goToNextResult = () => {
    if (results.length === 0) return;
    const newIndex = (currentIndex + 1) % results.length;
    setCurrentIndex(newIndex);
    goToPage(results[newIndex].pageNumber);
  };

  const goToPrevResult = () => {
    if (results.length === 0) return;
    const newIndex = (currentIndex - 1 + results.length) % results.length;
    setCurrentIndex(newIndex);
    goToPage(results[newIndex].pageNumber);
  };

  // Atalhos de teclado
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPrevResult();
        } else {
          goToNextResult();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, results]);

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
              disabled={results.length === 0}
              className="h-9 w-9"
              title="Resultado Anterior (Shift+Enter)"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextResult}
              disabled={results.length === 0}
              className="h-9 w-9"
              title="Próximo Resultado (Enter)"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            
            {/* Contador */}
            <Badge variant="secondary" className="min-w-[60px] justify-center">
              {results.length === 0 
                ? '0/0' 
                : `${currentIndex + 1}/${results.length}`}
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
        
        {query && !isSearching && results.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Nenhum resultado encontrado para "{query}"
          </div>
        )}
        
        {query && !isSearching && results.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Encontrado em {results.length} página(s) • 
            Total: {results.reduce((sum, r) => sum + r.matches.length, 0)} resultado(s)
          </div>
        )}
      </div>
    </div>
  );
}

