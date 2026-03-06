/**
 * Header More Menu - Assessment Module
 *
 * Header sub-component responsible for:
 * - Dropdown menu with secondary actions
 * - Undo/Redo (when available)
 * - Export data (future)
 * - Other admin actions
 *
 * Baseado em ExtractionHeader/HeaderMoreMenu (DRY + KISS)
 *
 * @component
 */

import {Button} from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Download, MoreHorizontal, Redo2, Undo2} from 'lucide-react';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface HeaderMoreMenuProps {
  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

    // Future actions
  onExport?: () => void;
}

// =================== COMPONENT ===================

export function HeaderMoreMenu(props: HeaderMoreMenuProps) {
  const { canUndo, canRedo, onUndo, onRedo, onExport } = props;

    // If no action available, do not render
  const hasAnyAction = canUndo || canRedo || onExport;
  if (!hasAnyAction) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {/* Undo/Redo */}
        {(canUndo || canRedo) && (
          <>
            <DropdownMenuItem onClick={onUndo} disabled={!canUndo}>
              <Undo2 className="h-4 w-4 mr-2" />
                {t('assessment', 'headerUndo')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRedo} disabled={!canRedo}>
              <Redo2 className="h-4 w-4 mr-2" />
                {t('assessment', 'headerRedo')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Exportar (futuro) */}
        {onExport && (
          <DropdownMenuItem onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
              {t('assessment', 'headerExportData')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
