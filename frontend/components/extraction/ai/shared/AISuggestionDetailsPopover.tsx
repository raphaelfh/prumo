/**
 * AI suggestion details modal (rationale + evidence) - Extraction
 *
 * Uses viewport-centered Dialog so content is never clipped
 * Same strategy as Assessment. Responsive, with internal scroll.
 */

import {useState} from 'react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,} from '@/components/ui/dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Sparkles} from 'lucide-react';
import {AISuggestionEvidence} from '../AISuggestionEvidence';
import {t} from '@/lib/copy';
import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';

// -----------------------------------------------------------------------------
// Constantes de layout (viewport-safe, alinhado ao Assessment)
// -----------------------------------------------------------------------------

const DIALOG_CONTENT_CLASS =
  'max-w-[min(420px,calc(100vw-2rem))] w-[calc(100vw-2rem)] max-h-[85vh] h-[85vh] p-0 gap-0 flex flex-col z-[100] overflow-hidden';

const SCROLL_AREA_CLASS = 'flex-1 min-h-0 min-w-0';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function hasSuggestionDetails(suggestion: AISuggestion): boolean {
  const hasReasoning = !!suggestion.reasoning?.trim();
  const hasEvidence =
    !!suggestion.evidence?.text?.trim();
  return hasReasoning || hasEvidence;
}

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

interface AISuggestionDetailsPopoverProps {
  suggestion: AISuggestion;
  trigger: React.ReactNode;
}

// -----------------------------------------------------------------------------
// Componente
// -----------------------------------------------------------------------------

export function AISuggestionDetailsPopover({
  suggestion,
  trigger,
}: AISuggestionDetailsPopoverProps) {
  const [open, setOpen] = useState(false);

  if (!hasSuggestionDetails(suggestion)) {
    return <>{trigger}</>;
  }

  const hasReasoning = !!suggestion.reasoning?.trim();
  const evidence = suggestion.evidence;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={DIALOG_CONTENT_CLASS}
        aria-describedby={undefined}
      >
        <DialogHeader className="p-4 pr-12 pb-3 border-b shrink-0 space-y-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-600 shrink-0" />
              Suggestion details
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className={SCROLL_AREA_CLASS}>
          <div className="p-4 pt-3 space-y-5 min-w-0">
            {hasReasoning && (
              <section className="space-y-2" aria-label="Justificativa">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Justificativa
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {suggestion.reasoning}
                </p>
              </section>
            )}

            {evidence?.text?.trim() && (
                <section className="space-y-2" aria-label={t('extraction', 'evidenceCitedAria')}>
                <AISuggestionEvidence
                  evidence={{
                    text: evidence.text,
                    pageNumber: evidence.pageNumber ?? null,
                  }}
                />
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
