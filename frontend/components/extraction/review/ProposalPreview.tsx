import {Check} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {formatFullSuggestionValue, valuelessProposalKind, type SuggestionFieldContext} from '@/lib/ai-extraction/suggestionUtils';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {AISuggestion} from '@/types/ai-extraction';

interface ProposalPreviewProps extends SuggestionFieldContext {
  latest: AISuggestion;
  count: number;
  expanded: boolean;
  onExpand: () => void;
  accepted?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  onToggle?: () => void;
  acceptedOlder?: boolean;
  onOpenAccepted?: () => void;
  disclosureId?: string;
}

export function ProposalPreview({latest, count, expanded, onExpand, accepted = false, saving, readOnly, onToggle, acceptedOlder, onOpenAccepted, disclosureId, ...field}: ProposalPreviewProps) {
  const kind = valuelessProposalKind(latest.value);
  const value = kind ? t('extraction', kind === 'marker' ? 'reviewNoInformation' : 'reviewNoValue') : formatFullSuggestionValue(latest.value, field);
  return <div className="flex min-w-0 items-center gap-1">
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="min-w-0 flex-1 rounded px-1 py-1 text-left text-[13px] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring" onClick={onExpand} aria-expanded={expanded} aria-controls={disclosureId}>
          <span className="line-clamp-2 break-words">{value}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-h-[40vh] max-w-sm overflow-auto whitespace-pre-wrap break-words">{value}</TooltipContent>
    </Tooltip>
    {count > 1 && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{count}</span>}
    {!readOnly && onToggle && <IconButton icon={<Check />} label={t('extraction', accepted ? 'reviewUnacceptExtraction' : 'reviewAcceptExtraction')} aria-pressed={accepted} disabled={saving} onClick={onToggle} className={cn('rounded-full', accepted && 'bg-success/10 text-success shadow-sm hover:text-success')} />}
    {acceptedOlder && onOpenAccepted && <IconButton icon={<Check />} label={t('extraction', 'reviewOpenAccepted')} onClick={onOpenAccepted} />}
  </div>;
}
