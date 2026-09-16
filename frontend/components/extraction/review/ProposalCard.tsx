import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {AcceptCheck} from './AcceptCheck';
import {AISuggestionEvidence} from '../ai/AISuggestionEvidence';
import {GenerationDetailsContent} from '../ai/shared/GenerationDetailsContent';
import {useReaderLocate} from '@/hooks/extraction/useReaderLocate';
import {formatFullSuggestionValue, valuelessProposalKind, type SuggestionFieldContext} from '@/lib/ai-extraction/suggestionUtils';
import {t} from '@/lib/copy';
import type {AISuggestion} from '@/types/ai-extraction';

interface ProposalCardProps extends SuggestionFieldContext {
  proposal: AISuggestion;
  ordinal: number;
  latest: boolean;
  accepted: boolean;
  /** Any decision or save is in flight: the check ignores clicks but is never swapped to `disabled`. */
  saving: boolean;
  /** This proposal is the in-flight decision. */
  pending?: boolean;
  readOnly?: boolean;
  onToggle: (proposal: AISuggestion) => void;
}

export function ProposalCard({proposal, ordinal, latest, accepted, saving, pending, readOnly, onToggle, ...field}: ProposalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeRank, setActiveRank] = useState<number | null>(null);
  const {locate, isAvailable} = useReaderLocate();
  const evidence = proposal.evidence ?? [];
  const snapshot = proposal.generationSnapshot;
  const kind = valuelessProposalKind(proposal.value);
  return <article className="min-w-0 space-y-3 rounded-md border border-border/40 p-2 text-[13px] motion-reduce:transition-none">
    <header className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('extraction', 'reviewExtractionOrdinal').replace('{{n}}', String(ordinal))}</span>
        {latest && <span>{t('extraction', 'reviewLatestExtraction')}</span>}
        <span>{t('extraction', evidence.length === 1 ? 'reviewSourcesCountOne' : 'reviewSourcesCountOther').replace('{{n}}', String(evidence.length))}</span>
        {snapshot?.model && <span className="break-all">{snapshot.model}</span>}
        <time dateTime={Number.isNaN(proposal.timestamp.getTime()) ? undefined : proposal.timestamp.toISOString()}>{Number.isNaN(proposal.timestamp.getTime()) ? t('extraction', 'historyInvalidDate') : proposal.timestamp.toLocaleString()}</time>
      </div>
      {!readOnly && <AcceptCheck accepted={accepted} saving={saving} pending={pending} onToggle={() => onToggle(proposal)}/>}
    </header>
    <p className="whitespace-pre-wrap break-words font-medium">{kind ? t('extraction', kind === 'marker' ? 'reviewNoInformation' : 'reviewNoValue') : formatFullSuggestionValue(proposal.value, field)}</p>
    {proposal.reasoning && <section className="space-y-1"><h3 className="text-xs text-muted-foreground">{t('extraction', 'aiRationaleLabel')}</h3><p className="whitespace-pre-wrap break-words">{proposal.reasoning}</p></section>}
    <AISuggestionEvidence presentation="review" evidence={evidence} activeRank={activeRank} onLocate={isAvailable ? rank => {
      const citation = evidence.find(item => item.rank === rank);
      if (!citation) return;
      setActiveRank(rank);
      locate(citation.text, citation.pageNumber ?? null, citation.blockIds);
    } : undefined}/>
    <Button size="xs" variant="ghost" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{t('extraction', 'provenanceToggle')}</Button>
    <div hidden={!detailsOpen}><GenerationDetailsContent provenance={snapshot} historicalInputAvailable={snapshot?.promptComposition?.articleRef?.historicalInputAvailable}/></div>
  </article>;
}
