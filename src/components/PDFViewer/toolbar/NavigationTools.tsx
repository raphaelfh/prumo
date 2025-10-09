/**
 * NavigationTools - Ferramentas de navegação entre páginas
 * 
 * Features:
 * - Botões Previous/Next
 * - Input de página com validação
 * - Exibição do total de páginas
 * - Atalhos de teclado (PageUp/PageDown)
 */

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePDFStore } from '@/stores/usePDFStore';

export function NavigationTools() {
  const { currentPage, numPages, nextPage, prevPage, goToPage } = usePDFStore();
  const [pageInput, setPageInput] = useState(currentPage.toString());
  
  // Sincronizar input com currentPage
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput, 10);
    
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) {
      goToPage(pageNum);
    } else {
      // Resetar para página atual se inválido
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Permitir apenas números
    if (value === '' || /^\d+$/.test(value)) {
      setPageInput(value);
    }
  };

  // Sempre mostrar navegação completa
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={prevPage}
        disabled={currentPage <= 1}
        title="Página Anterior (PageUp)"
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
        <Input
          type="text"
          value={pageInput}
          onChange={handlePageInputChange}
          onBlur={handlePageSubmit}
          className="w-12 h-8 text-center text-sm px-1"
          aria-label="Número da página"
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          / {numPages}
        </span>
      </form>

      <Button
        variant="ghost"
        size="icon"
        onClick={nextPage}
        disabled={currentPage >= numPages}
        title="Próxima Página (PageDown)"
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

