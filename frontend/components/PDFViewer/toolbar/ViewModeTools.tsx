/**
 * ViewModeTools - View mode selector
 *
 * Supported modes:
 * - Single page - best performance for navigation
 * - Continuous scroll - smooth scroll between pages
 * - Two pages - side-by-side comparison
 */

import {useCallback} from 'react';
import {LayoutList} from 'lucide-react';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {usePDFStore} from '@/stores/usePDFStore';

export function ViewModeTools() {
  const { ui, setViewMode } = usePDFStore();
  const viewMode = ui?.viewMode || 'continuous';

    // Callback for mode change
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
            <SelectItem value="single">Single Page</SelectItem>
            <SelectItem value="continuous">Continuous Scroll</SelectItem>
            <SelectItem value="two-page">Two Pages</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
