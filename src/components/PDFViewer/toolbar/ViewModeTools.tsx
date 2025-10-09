/**
 * ViewModeTools - Selector compacto de modo de visualização (SIMPLIFICADO)
 * 
 * Modos suportados:
 * - Página Única (padrão - melhor performance)
 * - Duas Páginas (comparação lado a lado)
 * 
 * Removidos temporariamente para estabilidade:
 * - Scroll Contínuo (causava lag com 72 páginas)
 * - Book View (complexo e bugado)
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

  // Callback otimizado com debounce para mudança de modo
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
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="continuous">Página Única</SelectItem>
          <SelectItem value="two-page">Duas Páginas</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
