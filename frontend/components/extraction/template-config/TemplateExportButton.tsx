// frontend/components/extraction/template-config/TemplateExportButton.tsx
/**
 * Export the template's LIVE structure as a prumo-template@1 file (spec
 * §6.1). Sibling of TemplateConfigPublishControls: same prop shape, reads
 * config-status itself, owns its confirm. The file is the UNWRAPPED
 * document — never the envelope (the importer is `extra="forbid"`).
 */

import {useState} from 'react';
import {FileDown} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useTemplateConfigStatus} from '@/hooks/extraction/useTemplateConfigStatus';
import {t} from '@/lib/copy';
import {triggerDownload} from '@/lib/download';
import {exportTemplate, templateExportFilename} from '@/services/templateImportService';

interface TemplateExportButtonProps {
  projectId: string;
  templateId: string;
}

export function TemplateExportButton({projectId, templateId}: TemplateExportButtonProps) {
  const {data: configStatus} = useTemplateConfigStatus(projectId, templateId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const exportNow = async () => {
    const result = await exportTemplate(projectId, templateId);
    if (!result.ok) {
      toast.error(`${t('templateConfig', 'exportError')}: ${result.error.message}`);
      return;
    }
    triggerDownload(
      new Blob([JSON.stringify(result.data, null, 2)], {type: 'application/json'}),
      templateExportFilename(result.data.name),
    );
  };

  const handleClick = () => {
    if (configStatus?.has_pending_changes) {
      setConfirmOpen(true);
      return;
    }
    void exportNow();
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="template-config-export"
            aria-label={t('extraction', 'exportButton')}
            onClick={handleClick}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            <FileDown className="h-4 w-4 @6xl/configbar:mr-2" />
            {/* The command bar (a @container) is full at ~920px — its title
                truncated once this button joined it — so the label earns its
                room only when the BAR is wide, not the viewport. */}
            <span className="hidden @6xl/configbar:inline">{t('extraction', 'exportButton')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('templateConfig', 'exportTemplateTooltip')}</TooltipContent>
      </Tooltip>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templateConfig', 'exportDraftTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('templateConfig', 'exportDraftBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="template-config-export-confirm"
              onClick={() => {
                setConfirmOpen(false);
                void exportNow();
              }}
            >
              {t('templateConfig', 'exportDraftConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
