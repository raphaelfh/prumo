/**
 * Header More Menu - Assessment Module
 *
 * Sub-componente do header responsável por:
 * - Menu dropdown com ações secundárias
 * - Undo/Redo (quando disponível)
 * - Exportar dados (futuro)
 * - Outras ações administrativas
 *
 * Baseado em ExtractionHeader/HeaderMoreMenu (DRY + KISS)
 *
 * @component
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Undo2, Redo2, Download } from 'lucide-react';

// =================== INTERFACES ===================

export interface HeaderMoreMenuProps {
  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  // Futuras ações
  onExport?: () => void;
}

// =================== COMPONENT ===================

export function HeaderMoreMenu(props: HeaderMoreMenuProps) {
  const { canUndo, canRedo, onUndo, onRedo, onExport } = props;

  // Se não há nenhuma ação disponível, não renderizar
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
              Desfazer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRedo} disabled={!canRedo}>
              <Redo2 className="h-4 w-4 mr-2" />
              Refazer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Exportar (futuro) */}
        {onExport && (
          <DropdownMenuItem onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
            Exportar dados
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
