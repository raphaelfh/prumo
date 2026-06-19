/**
 * Header "More options" menu.
 * Groups secondary actions: AI extraction, quality assessment,
 * keyboard shortcuts, help. (Export now lives in the consolidated
 * ExtractionExportDialog, not here.)
 */

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from '@/components/ui/dialog';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {ExternalLink, HelpCircle, Keyboard, MoreHorizontal, ShieldAlert, Sparkles} from 'lucide-react';
import {useFullAIExtraction} from '@/hooks/extraction/useFullAIExtraction';
import {useRunAIExtraction} from '@/hooks/extraction/ai/useRunAIExtraction';
import {useHITLProjectTemplates} from '@/hooks/hitl/useHITLProjectTemplates';
import {t} from '@/lib/copy';

interface HeaderMoreMenuProps {
  /** Project id (kept for symmetry / future scoped actions). */
  projectId: string;
  /** Compact mode (icon only). */
  compact?: boolean;
  /** Article id for AI extraction. */
  articleId?: string;
  /** Template id for AI extraction. */
  templateId?: string;
  /**
   * Active extraction run id. When provided, "Extract with AI" reuses
   * this run via ``extract_for_run`` (preserving any human proposals
   * the user already typed). When absent, falls back to the legacy
   * multi-step orchestration that creates a fresh run.
   */
  runId?: string | null;
  /**
   * Whether AI extraction may run. AI seeds proposals only in the PROPOSAL
   * stage; once the run is in REVIEW it is a one-time-done step (re-running
   * would be rejected by the backend), so the action is disabled. Defaults to
   * ``true`` for callers that don't track stage.
   */
  canRunAI?: boolean;
  /** Callback after extraction completes. */
  onExtractionComplete?: () => Promise<void>;
    /** Callback to expose extraction state (to render progress in parent) */
  onExtractionStateChange?: (state: { loading: boolean; progress: any }) => void;
}

export function HeaderMoreMenu({
  projectId,
  compact: _compact = false,
  articleId,
  templateId,
  runId,
  canRunAI = true,
  onExtractionComplete,
  onExtractionStateChange,
}: HeaderMoreMenuProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const navigate = useNavigate();
  const { globalTemplates: qaTemplates, loading: qaTemplatesLoading } =
    useHITLProjectTemplates({ projectId, kind: 'quality_assessment' });

    // Hook for full AI extraction (legacy path: creates a fresh run).
    // Used when no active run is available — e.g., bulk operations from
    // the articles table.
  const { extractFullAI, loading: extractingFullAI, progress: extractionProgress } = useFullAIExtraction({
    onSuccess: async () => {
      if (onExtractionComplete) {
        await onExtractionComplete();
      }
    },
  });

  // Run-scoped AI extraction (preferred when ``runId`` is available):
  // calls ``extract_for_run`` against the existing run with
  // ``skipFieldsWithHumanProposals=true`` so manual edits aren't buried
  // by a fresh AI guess.
  const { extractForRun, loading: extractingForRun } = useRunAIExtraction({
    onSuccess: async () => {
      if (onExtractionComplete) {
        await onExtractionComplete();
      }
    },
  });

  const extractingAI = extractingFullAI || extractingForRun;

  // Expose state to the parent (to render progress outside the menu).
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

  const handleShortcuts = () => {
    setShortcutsOpen(true);
  };

  const handleHelp = () => {
    // Open the documentation in a new tab.
    window.open('/docs', '_blank');
  };

  const handleFullAIExtraction = async () => {
    if (!articleId || !templateId) {
        console.warn('[HeaderMoreMenu] articleId or templateId not provided for AI extraction');
      return;
    }

    try {
      if (runId) {
        // Active run available — reuse it. ``extract_for_run`` keeps
        // any ``human`` proposals the user has typed while filling
        // unfilled coords with AI guesses.
        await extractForRun({
          projectId,
          articleId,
          templateId,
          runId,
        });
      } else {
        await extractFullAI({
          projectId,
          articleId,
          templateId,
        });
      }
    } catch (error) {
      // Error already handled by the hook with a toast.
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
              disabled={extractingAI || !canRunAI}
            >
              <Sparkles className="mr-2 h-4 w-4" />
                {extractingAI ? t('extraction', 'moreExtractingAI') : t('extraction', 'moreExtractAI')}
            </DropdownMenuItem>
          )}
          {articleId && qaTemplates.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="header-qa-trigger">
                <ShieldAlert className="mr-2 h-4 w-4" />
                {t('extraction', 'moreOpenQA')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {qaTemplatesLoading ? (
                  <DropdownMenuItem disabled>
                    {t('common', 'loading')}
                  </DropdownMenuItem>
                ) : (
                  qaTemplates.map((tpl) => (
                    <DropdownMenuItem
                      key={tpl.id}
                      onClick={() =>
                        navigate(
                          `/projects/${projectId}/articles/${articleId}/quality-assessment/${tpl.id}`,
                        )
                      }
                      data-testid={`header-qa-template-${tpl.name}`}
                    >
                      <ShieldAlert className="mr-2 h-4 w-4 text-warning" />
                      <span>{tpl.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        v{tpl.version}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
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

