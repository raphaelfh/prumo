/**
 * MoreTools - Menu with additional tools
 * 
 * Features:
 * - Download PDF
 * - Print (to be implemented in Phase 7)
 * - Export Annotations (to be implemented in Phase 7)
 * - Propriedades do Documento
 * - Settings
 */

import { useState } from 'react';
import { Download, Printer, Info, Settings, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {t} from '@/lib/copy';
import { SettingsDialog } from '../dialogs/SettingsDialog';

export function MoreTools() {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleDownload = () => {
    toast({
        title: t('pdf', 'moreToolsDownloadTitle'),
        description: t('pdf', 'moreToolsDownloadDesc'),
    });
  };

  const handlePrint = () => {
    toast({
        title: t('pdf', 'moreToolsPrintTitle'),
        description: t('pdf', 'moreToolsPrintDesc'),
    });
  };


  const handleProperties = () => {
    toast({
        title: t('pdf', 'moreToolsPropertiesTitle'),
        description: t('pdf', 'moreToolsPropertiesDesc'),
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
            aria-label={t('pdf', 'moreToolsAria')}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
              {t('pdf', 'moreToolsDownload')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
              {t('pdf', 'moreToolsPrint')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleProperties}>
            <Info className="h-4 w-4 mr-2" />
              {t('pdf', 'moreToolsProperties')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSettings}>
            <Settings className="h-4 w-4 mr-2" />
              {t('pdf', 'moreToolsSettings')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

