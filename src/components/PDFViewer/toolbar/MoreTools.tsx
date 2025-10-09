/**
 * MoreTools - Menu com ferramentas adicionais
 * 
 * Features:
 * - Download PDF
 * - Print (será implementado na Fase 7)
 * - Exportar Anotações (será implementado na Fase 7)
 * - Propriedades do Documento
 * - Configurações
 */

import { useState } from 'react';
import { Download, Printer, FileOutput, Info, Settings, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { SettingsDialog } from '../dialogs/SettingsDialog';

export function MoreTools() {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleDownload = () => {
    toast({
      title: 'Download',
      description: 'Funcionalidade será implementada em breve.',
    });
  };

  const handlePrint = () => {
    toast({
      title: 'Impressão',
      description: 'Funcionalidade de impressão avançada será implementada em breve.',
    });
  };

  const handleExport = () => {
    toast({
      title: 'Exportar Anotações',
      description: 'Funcionalidade de exportação será implementada em breve.',
    });
  };

  const handleProperties = () => {
    toast({
      title: 'Propriedades do Documento',
      description: 'Visualização de metadados será implementada em breve.',
    });
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Mais Opções"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <FileOutput className="h-4 w-4 mr-2" />
            Exportar Anotações
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleProperties}>
            <Info className="h-4 w-4 mr-2" />
            Propriedades do Documento
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSettings}>
            <Settings className="h-4 w-4 mr-2" />
            Configurações
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

