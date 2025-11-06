/**
 * Menu "Mais Opções" do header
 * Agrupa ações secundárias: Export, Atalhos, Ajuda
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  MoreHorizontal, 
  Download, 
  Keyboard, 
  HelpCircle,
  ExternalLink 
} from 'lucide-react';
import { ExtractionExport } from '@/components/extraction/ExtractionExport';
import type { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue 
} from '@/types/extraction';

interface HeaderMoreMenuProps {
  /** Projeto ID para export */
  projectId: string;
  /** Template para export */
  template?: ProjectExtractionTemplate | null;
  /** Instâncias para export */
  instances?: ExtractionInstance[];
  /** Valores extraídos para export */
  values?: ExtractedValue[];
  /** Modo compacto (apenas ícone) */
  compact?: boolean;
}

export function HeaderMoreMenu({
  projectId,
  template,
  instances = [],
  values = [],
  compact = false,
}: HeaderMoreMenuProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const shortcuts = [
    { keys: 'Ctrl/Cmd + S', action: 'Salvar manualmente' },
    { keys: 'Ctrl/Cmd + K', action: 'Buscar' },
    { keys: 'Esc', action: 'Cancelar ação' },
    { keys: 'Tab', action: 'Próximo campo' },
    { keys: 'Shift + Tab', action: 'Campo anterior' },
  ];

  const handleExport = () => {
    setExportOpen(true);
  };

  const handleShortcuts = () => {
    setShortcutsOpen(true);
  };

  const handleHelp = () => {
    // Abrir documentação em nova aba
    window.open('/docs', '_blank');
  };

  const triggerButton = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
      aria-label="Mais opções"
    >
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {triggerButton}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={5} className="z-[100]">
            Mais opções
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Ações
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Exportar Dados
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleShortcuts}>
            <Keyboard className="mr-2 h-4 w-4" />
            Atalhos de Teclado
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleHelp}>
            <HelpCircle className="mr-2 h-4 w-4" />
            Ajuda
            <ExternalLink className="ml-auto h-3 w-3" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialog de Export */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exportar Dados Extraídos</DialogTitle>
            <DialogDescription>
              Exporte os dados extraídos em diferentes formatos
            </DialogDescription>
          </DialogHeader>
          <ExtractionExport
            projectId={projectId}
            template={template || null}
            instances={instances}
            values={values}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog de Atalhos */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              Atalhos de Teclado
            </DialogTitle>
            <DialogDescription>
              Atalhos disponíveis na interface de extração
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto py-4">
            {shortcuts.map((shortcut, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm text-foreground">{shortcut.action}</span>
                <kbd className="px-2 py-1 text-xs font-mono bg-muted border border-border/60 rounded text-muted-foreground">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
            Dica: Pressione <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">?</kbd> para ver esta lista rapidamente
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

