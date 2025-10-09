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

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  pageNumber: number;
  text: string;
  context: string;
  position: { start: number; end: number };
}

export function SearchPanel({ isOpen, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Função de busca (placeholder - será implementada com PDF.js API)
  const performSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setCurrentIndex(-1);
      return;
    }

    setIsSearching(true);
    
    try {
      // TODO: Integrar com PDF.js para busca real
      // Por ora, simulação
      console.log('🔍 Buscando:', { query, caseSensitive, wholeWords, useRegex });
      
      // Simulação de resultados
      await new Promise(resolve => setTimeout(resolve, 300));
      
      setResults([]);
      setCurrentIndex(-1);
      
    } catch (error) {
      console.error('Erro na busca:', error);
    } finally {
      setIsSearching(false);
    }
  }, [query, caseSensitive, wholeWords, useRegex]);

  // Buscar quando query mudar (debounced)
  useEffect(() => {
    const timer = setTimeout(performSearch, 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const goToNextResult = () => {
    if (results.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % results.length);
  };

  const goToPrevResult = () => {
    if (results.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + results.length) % results.length);
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
        {isSearching && (
          <div className="text-xs text-muted-foreground">
            Buscando...
          </div>
        )}
        
        {query && !isSearching && results.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Nenhum resultado encontrado para "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

