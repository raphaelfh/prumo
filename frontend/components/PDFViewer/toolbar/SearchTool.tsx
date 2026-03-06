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
import {t} from '@/lib/copy';

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
            aria-label={t('extraction', 'searchDocumentAria')}
          >
            <Search className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
            <p>{t('extraction', 'searchDocumentAria')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

