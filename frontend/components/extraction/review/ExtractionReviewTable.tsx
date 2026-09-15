import type {RunDetailResponse} from '@/hooks/runs/types';
import {useEffect, useRef, useState} from 'react';
import type {useProposalDecision} from '@/hooks/extraction/useProposalDecision';
import type {useReviewNavigation} from '@/hooks/extraction/useReviewNavigation';
import type {useResizableTableColumns} from '@/components/shared/list/useResizableTableColumns';
import {ColumnResizeHandle} from '@/components/shared/list/ColumnResizeHandle';
import {fitReviewColumns} from '@/lib/extraction/reviewColumnWidths';
import {t} from '@/lib/copy';
import type {ExtractionField} from '@/types/extraction';
import type {AISuggestion} from '@/types/ai-extraction';
import {ExtractionReviewRow} from './ExtractionReviewRow';

export interface ReviewWorkspace {
  proposals: RunDetailResponse['proposals'];
  navigation: ReturnType<typeof useReviewNavigation>;
  decisions: Pick<ReturnType<typeof useProposalDecision>, 'isAccepted' | 'acceptedProposalIdFor' | 'toggle' | 'saving' | 'error' | 'canUndo' | 'undoTarget' | 'undoLatestLocalDecision' | 'conflicted' | 'resumeDraftAfterConflict'>;
  widths: Record<string, number>;
  columns: ReturnType<typeof useResizableTableColumns>;
  activeProposal: {instanceId: string; fieldId: string; proposal: AISuggestion} | null;
  setActiveProposal: (instanceId: string, fieldId: string, proposal: AISuggestion | undefined) => void;
}
export interface ExtractionReviewTableProps {
  instanceId: string;
  fields: ExtractionField[];
  values: Record<string, unknown>;
  onValueChange: (fieldId: string, value: unknown) => void;
  aiSuggestions?: Record<string, AISuggestion>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestion[]>;
  review?: ReviewWorkspace;
}

export function ExtractionReviewTable(props: ExtractionReviewTableProps) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const widths = fitReviewColumns(width, props.review?.widths ?? {});
  const stacked = width > 0 && width < 600;
  const headers = [t('extraction', 'reviewQuestionColumn'), t('extraction', 'reviewValueColumn'), t('extraction', 'reviewProposalColumn')];
  return <div ref={container} className="min-w-0">
    <table className="w-full table-fixed border-collapse text-[13px]" role="table">
      {!stacked && <colgroup><col style={{width: width ? widths.question : '30%'}}/><col style={{width: width ? widths.value : '35%'}}/><col/></colgroup>}
      <thead className={stacked ? 'sr-only' : undefined}><tr role="row">{headers.map((label, index) => {
        const column = index === 0 ? 'question' : 'value';
        const handle = props.review?.columns.getHandleProps(column);
        const max = width - (index === 0 ? 420 : 380);
        return <th key={label} scope="col" role="columnheader" className="relative px-2 py-1.5 text-left text-xs font-normal text-muted-foreground">
          {label}
          {width >= 900 && index < 2 && handle && <ColumnResizeHandle {...handle} label={label} width={widths[column]} max={max} onWidth={value => handle.onWidth(Math.min(max, value))} coarseTarget/>}
        </th>;
      })}</tr></thead>
      <tbody role="rowgroup">{props.fields.map(field => <ExtractionReviewRow key={field.id} {...props} field={field} stacked={stacked}/>)}</tbody>
    </table>
  </div>;
}
