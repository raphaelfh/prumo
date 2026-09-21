import {useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {FieldValueEditor} from '../FieldValueEditor';
import {DispositionRow} from '../DispositionRow';
import {ProposalPreview} from './ProposalPreview';
import {ProposalDisclosure} from './ProposalDisclosure';
import {sameReviewCoordinate} from '@/hooks/extraction/useReviewNavigation';
import {isEmptyValue} from '@/lib/ai-extraction/valueParser';
import {unwrapProposedValue, valueAbsentReason} from '@/lib/extraction/valueSemantics';
import {withPinnedTop} from '@/lib/extraction/scrollAnchor';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {ExtractionField} from '@/types/extraction';
import type {AISuggestion} from '@/types/ai-extraction';
import type {ExtractionReviewTableProps} from './ExtractionReviewTable';

export function ExtractionReviewRow({instanceId, field, values, onValueChange, aiSuggestions, getSuggestionsHistory, review, stacked}: ExtractionReviewTableProps & {field: ExtractionField; stacked: boolean}) {
  const coordinate = {instanceId, fieldId: field.id};
  const key = `${instanceId}_${field.id}`;
  const latest = aiSuggestions?.[key];
  const [initialProposalId, setInitialProposalId] = useState<string>();
  const [visited, setVisited] = useState(false);
  const expanded = sameReviewCoordinate(review?.navigation.open ?? null, coordinate);
  const focused = !!review?.navigation.focused && sameReviewCoordinate(review.navigation.current, coordinate);
  const hidden = !!review?.navigation.focused && !focused;
  const history = review?.proposals.filter(proposal => proposal.source === 'ai' && proposal.instance_id === instanceId && proposal.field_id === field.id) ?? [];
  const acceptedId = review?.decisions.acceptedProposalIdFor(instanceId, field.id);
  const pendingDecision = review?.decisions.pendingDecision ?? null;
  const pendingProposalId = sameReviewCoordinate(pendingDecision, coordinate) ? pendingDecision?.proposalId : null;
  const busy = !!review?.decisions.saving || !!review?.decisions.conflicted;
  const isAccepted = (proposal: AISuggestion) => review?.decisions.isAccepted({...coordinate, id: proposal.id, value: proposal.value}) ?? false;
  const acceptedOlder = history.find(item => item.id === acceptedId && item.id !== latest?.id && review?.decisions.isAccepted({...coordinate, id: item.id, value: unwrapProposedValue(item.proposed_value)}));
  const toggle = (proposal: AISuggestion) => {void review?.decisions.toggle({...coordinate, id: proposal.id, value: proposal.value, allowsNoInformation: field.allows_no_information !== false});};
  const rowRef = useRef<HTMLTableRowElement>(null);
  // The panel always opens directly below this row; what used to move was the
  // row itself, because opening here collapses whichever question was open
  // before — often one higher up the form. Pin this row's top edge across the
  // commit so the question the reviewer clicked stays where they are looking.
  const open = (id?: string) => {
    withPinnedTop(rowRef.current, () => flushSync(() => {
      setVisited(true);
      setInitialProposalId(id);
      if (!expanded || !id) review?.navigation.toggleDisclosure(coordinate);
    }));
  };
  const value = values[key];
  const pending = field.is_required && isEmptyValue(value);
  const cellClass = cn('min-w-0 px-2 py-2 align-top', stacked && 'block w-full');
  const disclosureId = `review-disclosure-${key}`;
  return <>
    <tr ref={rowRef} role="row" id={`review-question-${key}`} tabIndex={-1} hidden={hidden} data-field-row data-pending-required={pending || undefined} onFocus={() => review?.navigation.activate(coordinate)} className={cn('border-b border-border/40 outline-none focus-visible:outline-2 focus-visible:outline-ring', stacked && 'block', hidden && 'hidden', focused && 'border-b-0')}>
      <th scope="row" role="rowheader" className={cn(cellClass, 'text-left font-medium')}>
        <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="block whitespace-normal break-words rounded focus-visible:outline-2 focus-visible:outline-ring">{field.label}{field.is_required && <span className="ml-1 text-muted-foreground" aria-hidden="true">*</span>}</span></TooltipTrigger>{field.description && !focused && <TooltipContent className="max-h-[40vh] max-w-sm overflow-auto whitespace-pre-wrap">{field.description}</TooltipContent>}</Tooltip>
        {focused && field.description && <p className="mt-1 text-xs font-normal text-muted-foreground">{field.description}</p>}
      </th>
      <td role="cell" className={cellClass}>
        <FieldValueEditor field={field} value={valueAbsentReason(value) ? '' : value} onChange={onValueChange.bind(null, field.id)} density="compact" disabled={review?.decisions.conflicted} inputClassName={pending ? 'border-warning/60' : undefined}/>
        <DispositionRow field={field} value={value} onChange={onValueChange.bind(null, field.id)} disabled={review?.decisions.conflicted}/>
      </td>
      <td role="cell" className={cellClass}>
        {latest ? <ProposalPreview latest={latest} count={Math.max(history.length, 1)} expanded={expanded} onExpand={() => open()} fieldType={field.field_type} allowedValues={field.allowed_values} accepted={isAccepted(latest)} saving={busy} pending={!!pendingProposalId && pendingProposalId === latest.id} onToggle={() => toggle(latest)} acceptedOlder={!!acceptedOlder} onOpenAccepted={() => open(acceptedOlder?.id)} disclosureId={disclosureId}/> : <span className="text-xs text-muted-foreground">{t('extraction', 'reviewNoVersions')}</span>}
      </td>
    </tr>
    {(visited || expanded) && getSuggestionsHistory && <tr role="row" hidden={hidden || !expanded} className={cn(stacked && 'block', (hidden || !expanded) && 'hidden')}><td role="cell" colSpan={3} className={cn('min-w-0 px-2 pb-3', stacked && 'block')}>
      <ProposalDisclosure id={disclosureId} instanceId={instanceId} fieldId={field.id} getHistory={getSuggestionsHistory} expanded={expanded} acceptedProposalId={acceptedId} isAccepted={isAccepted} saving={busy} pendingProposalId={pendingProposalId} onToggle={toggle} initialProposalId={initialProposalId} latestProposalId={latest?.id} onActiveProposalChange={proposal => {if (expanded) review?.setActiveProposal(instanceId, field.id, proposal);}} fieldType={field.field_type} allowedValues={field.allowed_values}/>
    </td></tr>}
  </>;
}
