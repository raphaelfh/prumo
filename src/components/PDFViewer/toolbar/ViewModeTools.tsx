/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * ViewModeTools - Selector de modo de visualização
 * 
 * Modos suportados:
 * - Página Única (single) - melhor performance para navegação
 * - Scroll Contínuo (continuous) - scroll fluido entre páginas
 * - Duas Páginas (two-page) - comparação lado a lado
 */

import { useMemo, useCallback } from 'react';
import { LayoutList } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePDFStore } from '@/stores/usePDFStore';

export function ViewModeTools() {
  const { ui, setViewMode } = usePDFStore();
  const viewMode = ui?.viewMode || 'continuous';

  // Callback otimizado para mudança de modo
  const handleViewModeChange = useCallback((value: string) => {
    if (setViewMode) {
      setViewMode(value as any);
    }
  }, [setViewMode]);

  return (
    <div className="flex items-center gap-1">
      <LayoutList className="h-4 w-4 text-muted-foreground hidden sm:block" />
      <Select 
        value={viewMode} 
        onValueChange={handleViewModeChange}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="single">Página Única</SelectItem>
          <SelectItem value="continuous">Scroll Contínuo</SelectItem>
          <SelectItem value="two-page">Duas Páginas</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
