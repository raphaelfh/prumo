/**
 * GenerationDetailsDialog — the full "how this was generated" surface.
 *
 * Opened from the review popover's one-line provenance summary. Renders the run
 * parameters, the structured prompt-composition recipe (system prompt, section
 * instruction with the article replaced by a marker, article reference, and the
 * requested fields), and the token totals. Runs that predate composition capture
 * fall back to the legacy flat rows + raw prompt-text code block.
 *
 * The article chip's "view text sent" markdown expand is wired in a follow-up
 * (needs the lazy content-markdown fetch); this component renders the recipe and
 * the chip metadata.
 */

import {useState} from 'react';
import {Check, ChevronDown, ChevronRight, Copy} from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {t} from '@/lib/copy';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
import {useArticleContentMarkdown} from '@/hooks/extraction/useArticleContentMarkdown';
import type {RunProvenance} from '@/types/ai-extraction';
import {GenerationDetailsContent} from './GenerationDetailsContent';

/**
 * The "view text sent" expand: lazily fetches the stored article markdown (the
 * exact text the LLM received) only when the user opens it. Renders a loading,
 * error+retry, or scrollable text state inside the article chip.
 */
function ArticleTextExpand({articleId}: {articleId: string}) {
  const [open, setOpen] = useState(false);
  const {data, isLoading, isError, refetch} = useArticleContentMarkdown(articleId, {enabled: open});
  const {copied, copy} = useCopyToClipboard();

  return (
    <div className="mt-2">
      <Button
        size="xs"
        variant="ghost"
        className="gap-1 px-1 text-[11px] text-ai hover:text-ai"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? t('extraction', 'generationHideTextSent') : t('extraction', 'generationViewTextSent')}
      </Button>
      {open && (
        <div className="mt-1">
          {isLoading && (
            <div className="h-16 animate-pulse rounded border bg-muted/40" aria-hidden />
          )}
          {isError && (
            <div className="flex items-center justify-between gap-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              <span>{t('extraction', 'generationTextError')}</span>
              <Button
                size="xs"
                variant="ghost"
                className="px-1.5 text-[11px]"
                onClick={() => void refetch()}
              >
                {t('extraction', 'generationTextRetry')}
              </Button>
            </div>
          )}
          {!isLoading && !isError && data && (
            <div className="relative">
              <IconButton
                size="icon-xs"
                className="absolute right-1 top-1"
                onClick={() => copy(data.contentMarkdown ?? '')}
                label={
                  copied ? t('extraction', 'provenanceCopied') : t('extraction', 'provenanceCopyPrompt')
                }
                icon={copied ? <Check className="text-success" /> : <Copy />}
              />
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 pr-8 text-[11px] leading-relaxed text-foreground/80">
                {data.contentMarkdown}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dialog
// -----------------------------------------------------------------------------

interface GenerationDetailsDialogProps {
  provenance: RunProvenance;
  /** The call's immutable facts. Runner identity rides only here: the backend
   *  resolves it from the attempt owner after the run reveals peers (spec §12.2). */
  generationSnapshot?: RunProvenance;
  /** Threaded so a follow-up can lazily fetch the stored markdown. */
  articleId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerationDetailsDialog({
  provenance,
  generationSnapshot,
  articleId,
  open,
  onOpenChange,
}: GenerationDetailsDialogProps) {
  // D3 display consistency: the "Ran by" surfaces follow the same
  // peer-identity gate as the popover run headers (fail-closed). The dialog
  // renders inside the run provider's React tree, so context crosses the
  // portal.
  const {showPeerIdentity} = useRunEditability();
  const composition = provenance.promptComposition;
  const contextParts = [
    composition?.sectionName,
    showPeerIdentity ? generationSnapshot?.ranByName : undefined,
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {t('extraction', 'provenanceToggle')}
          </DialogTitle>
          {contextParts.length > 0 && (
            <DialogDescription className="text-xs text-muted-foreground">
              {contextParts.join(' · ')}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* The "Ran by" row names the snapshot's runner or none — never a provenance identity. */}
          <GenerationDetailsContent provenance={{...provenance, ranByName: generationSnapshot?.ranByName}} articleText={articleId ? <ArticleTextExpand articleId={articleId} /> : undefined} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
