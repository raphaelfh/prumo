/**
 * AI suggestion details — rationale + cited evidence.
 *
 * Rendered as a non-modal, anchored Popover (not a full-screen modal): it
 * floats beside its trigger in the form panel and never covers the document
 * viewer. That is what makes locating usable — clicking a cited passage scrolls
 * the reader (still visible on the right) to the quote and flashes it, while the
 * popover stays open so the user can step through other citations; the located
 * citation keeps an active ring (markdown-first locate, via the shared viewer
 * store). Outside a ViewerProvider the locate affordance is simply absent.
 */

import {useState} from 'react';
import {Popover, PopoverTrigger} from '@/components/ui/popover';
import {Sparkles} from 'lucide-react';
import {AISuggestionEvidence} from '../AISuggestionEvidence';
import {AIPopoverShell} from './AIPopoverShell';
import {t} from '@/lib/copy';
import type {AISuggestion, EvidenceCitation} from '@/types/ai-extraction';
import {useReaderLocate} from '@/hooks/extraction/useReaderLocate';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function hasSuggestionDetails(suggestion: AISuggestion): boolean {
  const hasReasoning = !!suggestion.reasoning?.trim();
  const hasEvidence = (suggestion.evidence?.length ?? 0) > 0 && !!suggestion.evidence?.[0]?.text?.trim();
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
  evidence: EvidenceCitation[];
  activeRank: number | null;
  onActivate: (rank: number) => void;
}

function EvidenceSection({evidence, activeRank, onActivate}: EvidenceSectionProps) {
  const {locate, isAvailable} = useReaderLocate();

  // Per-citation locate: finds the matching citation by rank, marks it active,
  // then locates it in the reader. The popover stays open so the user can step
  // through other citations; the active citation keeps a ring.
  const onLocate = isAvailable
    ? (rank: number) => {
        const citation = evidence.find((e) => e.rank === rank) ?? evidence[0];
        onActivate(rank);
        locate(citation.text, citation.pageNumber ?? null, citation.blockIds ?? []);
      }
    : undefined;

  return (
    <section className="space-y-2" aria-label={t('extraction', 'evidenceCitedAria')}>
      <AISuggestionEvidence
        evidence={evidence}
        onLocate={onLocate}
        activeRank={activeRank}
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
  const [activeRank, setActiveRank] = useState<number | null>(null);

  if (!hasSuggestionDetails(suggestion)) {
    return <>{trigger}</>;
  }

  const hasReasoning = !!suggestion.reasoning?.trim();
  const evidence = suggestion.evidence;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActiveRank(null);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <AIPopoverShell
        icon={<Sparkles className="h-4 w-4" />}
        title={t('extraction', 'aiSuggestionDetailsTitle')}
      >
        <div className="space-y-4 p-4">
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

          {evidence && evidence.length > 0 && evidence[0]?.text?.trim() && (
            <EvidenceSection
              evidence={evidence}
              activeRank={activeRank}
              onActivate={setActiveRank}
            />
          )}
        </div>
      </AIPopoverShell>
    </Popover>
  );
}
