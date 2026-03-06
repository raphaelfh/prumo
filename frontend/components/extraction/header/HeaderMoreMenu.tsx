/**
 * Menu "Mais Opções" do header
 * Agrupa ações secundárias: Export, Atalhos, Ajuda
 */

import {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from '@/components/ui/dialog';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {Download, ExternalLink, HelpCircle, Keyboard, MoreHorizontal, Sparkles} from 'lucide-react';
import {ExtractionExport} from '@/components/extraction/ExtractionExport';
import {useFullAIExtraction} from '@/hooks/extraction/useFullAIExtraction';
import type {ExtractedValue, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';
import {t} from '@/lib/copy';

interface HeaderMoreMenuProps {
  /** Projeto ID para export */
  projectId: string;
  /** Template para export */
  template?: ProjectExtractionTemplate | null;
  /** Instâncias para export */
  instances?: ExtractionInstance[];
    /** Extracted values for export */
  values?: ExtractedValue[];
  /** Modo compacto (apenas ícone) */
  compact?: boolean;
  /** Article ID para extração IA */
  articleId?: string;
  /** Template ID para extração IA */
  templateId?: string;
  /** Callback após extração completa */
  onExtractionComplete?: () => Promise<void>;
    /** Callback to expose extraction state (to render progress in parent) */
  onExtractionStateChange?: (state: { loading: boolean; progress: any }) => void;
}

export function HeaderMoreMenu({
  projectId,
  template,
  instances = [],
  values = [],
  compact = false,
  articleId,
  templateId,
  onExtractionComplete,
  onExtractionStateChange,
}: HeaderMoreMenuProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

    // Hook for full AI extraction
  const { extractFullAI, loading: extractingAI, progress: extractionProgress } = useFullAIExtraction({
    onSuccess: async () => {
      if (onExtractionComplete) {
        await onExtractionComplete();
      }
    },
  });

  // Expor estado para parent (para renderizar progresso fora do menu)
  useEffect(() => {
    if (onExtractionStateChange) {
      onExtractionStateChange({
        loading: extractingAI,
        progress: extractionProgress || null,
      });
    }
  }, [extractingAI, extractionProgress, onExtractionStateChange]);

  const shortcuts = [
      {keys: 'Ctrl/Cmd + S', action: t('extraction', 'moreShortcutSave')},
      {keys: 'Ctrl/Cmd + K', action: t('extraction', 'moreShortcutSearch')},
      {keys: 'Esc', action: t('extraction', 'moreShortcutCancel')},
      {keys: 'Tab', action: t('extraction', 'moreShortcutNextField')},
      {keys: 'Shift + Tab', action: t('extraction', 'moreShortcutPrevField')},
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

  const handleFullAIExtraction = async () => {
    if (!articleId || !templateId) {
        console.warn('[HeaderMoreMenu] articleId or templateId not provided for AI extraction');
      return;
    }

    try {
      await extractFullAI({
        projectId,
        articleId,
        templateId,
      });
    } catch (error) {
      // Erro já tratado pelo hook com toast
        console.error('[HeaderMoreMenu] Full AI extraction error:', error);
    }
  };

  const triggerButton = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
      aria-label={t('extraction', 'moreOptions')}
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
              {t('extraction', 'moreOptions')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('extraction', 'moreActions')}
          </DropdownMenuLabel>
          {articleId && templateId && (
            <DropdownMenuItem 
              onClick={handleFullAIExtraction}
              disabled={extractingAI}
            >
              <Sparkles className="mr-2 h-4 w-4" />
                {extractingAI ? t('extraction', 'moreExtractingAI') : t('extraction', 'moreExtractAI')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
              {t('extraction', 'moreExportData')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleShortcuts}>
            <Keyboard className="mr-2 h-4 w-4" />
              {t('extraction', 'moreKeyboardShortcuts')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleHelp}>
            <HelpCircle className="mr-2 h-4 w-4" />
              {t('extraction', 'moreHelp')}
            <ExternalLink className="ml-auto h-3 w-3" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

        {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
              <DialogTitle>{t('extraction', 'moreExportDialogTitle')}</DialogTitle>
            <DialogDescription>
                {t('extraction', 'moreExportDialogDesc')}
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

        {/* Shortcuts Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
                {t('extraction', 'moreShortcutsDialogTitle')}
            </DialogTitle>
            <DialogDescription>
                {t('extraction', 'moreShortcutsDialogDesc')}
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
              {t('extraction', 'moreShortcutTip')}
          </p>
        </DialogContent>
      </Dialog>

    </>
  );
}

