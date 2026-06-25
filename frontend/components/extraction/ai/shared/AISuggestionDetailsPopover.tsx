/**
 * AI suggestion details — rationale + cited evidence.
 *
 * Rendered as a non-modal, anchored Popover (not a full-screen modal): it
 * floats beside its trigger in the form panel and never covers the document
 * viewer. That is what makes "Locate in document" usable — clicking it closes
 * the popover and the reader, still visible on the right, scrolls to and
 * flashes the cited passage (markdown-first locate, via the shared viewer
 * store). Outside a ViewerProvider the locate affordance is simply absent.
 */

import {useState} from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {Sparkles} from 'lucide-react';
import {AISuggestionEvidence} from '../AISuggestionEvidence';
import {t} from '@/lib/copy';
import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';
import {useReaderLocate} from '@/hooks/extraction/useReaderLocate';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function hasSuggestionDetails(suggestion: AISuggestion): boolean {
  const hasReasoning = !!suggestion.reasoning?.trim();
  const hasEvidence = !!suggestion.evidence?.text?.trim();
  return hasReasoning || hasEvidence;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AISuggestionDetailsPopoverProps {
  suggestion: AISuggestion;
  trigger: React.ReactNode;
}

// -----------------------------------------------------------------------------
// Evidence section — owns the reader-locate wiring.
// -----------------------------------------------------------------------------

interface EvidenceSectionProps {
  evidence: {text: string; pageNumber?: number | null; blockIds?: number[]};
  onClose: () => void;
}

function EvidenceSection({evidence, onClose}: EvidenceSectionProps) {
  const {locate, isAvailable} = useReaderLocate();

  // Locate in the document reader, then close the popover so the (still
  // visible) viewer shows the flash unobstructed.
  const onLocate = isAvailable
    ? () => {
        locate(evidence.text, evidence.pageNumber ?? null, evidence.blockIds ?? []);
        onClose();
      }
    : undefined;

  return (
    <section className="space-y-2" aria-label={t('extraction', 'evidenceCitedAria')}>
      <AISuggestionEvidence
        evidence={{text: evidence.text, pageNumber: evidence.pageNumber ?? null}}
        onLocate={onLocate}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Component
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[380px] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="h-4 w-4 shrink-0 text-ai" />
          <span className="text-sm font-semibold">
            {t('extraction', 'aiSuggestionDetailsTitle')}
          </span>
        </div>

        <div className="max-h-[min(60vh,28rem)] space-y-4 overflow-y-auto p-4">
          {hasReasoning && (
            <section className="space-y-1.5" aria-label={t('extraction', 'aiRationaleLabel')}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('extraction', 'aiRationaleLabel')}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {suggestion.reasoning}
              </p>
            </section>
          )}

          {evidence?.text?.trim() && (
            <EvidenceSection
              evidence={{text: evidence.text, pageNumber: evidence.pageNumber ?? null, blockIds: evidence.blockIds ?? []}}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
