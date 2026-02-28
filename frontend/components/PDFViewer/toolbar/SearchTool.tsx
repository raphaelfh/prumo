/**
 * SearchTool - Ferramenta de busca profissional
 * 
 * Features:
 * - Abre painel de busca avançada
 * - Busca com opções (case sensitive, whole words, regex)
 * - Navegação entre resultados
 * - Sem conflito com Ctrl+F do navegador
 */

import {Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,} from '@/components/ui/tooltip';
import {usePDFStore} from '@/stores/usePDFStore';

export function SearchTool() {
  const { ui, setSearchOpen } = usePDFStore();
  const searchOpen = ui?.searchOpen || false;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={searchOpen ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setSearchOpen(!searchOpen)}
            className="h-8 w-8"
            aria-label="Buscar no Documento"
          >
            <Search className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Buscar no Documento</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

