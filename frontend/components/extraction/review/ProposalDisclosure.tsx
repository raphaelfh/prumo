import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight, Columns2, RefreshCw, Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {ProposalCard} from './ProposalCard';
import {t} from '@/lib/copy';
import type {SuggestionFieldContext} from '@/lib/ai-extraction/suggestionUtils';
import type {AISuggestion} from '@/types/ai-extraction';

interface ProposalDisclosureProps extends SuggestionFieldContext {
  instanceId: string;
  fieldId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestion[]>;
  expanded: boolean;
  acceptedProposalId?: string | null;
  isAccepted: (proposal: AISuggestion) => boolean;
  saving: boolean;
  onToggle: (proposal: AISuggestion) => void;
  readOnly?: boolean;
  initialProposalId?: string;
  onActiveProposalChange?: (proposal: AISuggestion | undefined) => void;
  id?: string;
}

/** Coordinate identity remounts local history; closing only hides the mounted subtree. */
export function ProposalDisclosure(props: ProposalDisclosureProps) {
  return <CoordinateDisclosure key={`${props.instanceId}:${props.fieldId}`} {...props}/>;
}

function CoordinateDisclosure({instanceId, fieldId, getHistory, expanded, acceptedProposalId, isAccepted, saving, onToggle, readOnly, initialProposalId, onActiveProposalChange, id, ...field}: ProposalDisclosureProps) {
  const [history, setHistory] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(initialProposalId);
  const [compare, setCompare] = useState(false);
  const [previousInitialId, setPreviousInitialId] = useState(initialProposalId);
  if (previousInitialId !== initialProposalId) {
    setPreviousInitialId(initialProposalId);
    setSelectedId(initialProposalId);
    setCompare(false);
  }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true); setError(false);
      void getHistory(instanceId, fieldId).then(data => {
        if (cancelled) return;
        setHistory([...data].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id)));
        setLoading(false);
      }, () => {if (!cancelled) {setError(true); setLoading(false);}});
    });
    return () => {cancelled = true;};
  }, [instanceId, fieldId, getHistory, refresh]);
  const selectedIndex = Math.max(0, history.findIndex(item => item.id === selectedId));
  const active = history[selectedIndex];
  useEffect(() => {onActiveProposalChange?.(active);}, [active, onActiveProposalChange]);
  const accepted = history.find(item => item.id === acceptedProposalId && isAccepted(item));
  return <div id={id} hidden={!expanded} className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-1">
      {history.length > 1 && <>
        <IconButton icon={<ChevronLeft/>} label={t('extraction', 'reviewPreviousExtraction')} disabled={compare || selectedIndex === 0} onClick={() => setSelectedId(history[selectedIndex - 1].id)}/>
        <span className="text-xs tabular-nums text-muted-foreground">{selectedIndex + 1} / {history.length}</span>
        <IconButton icon={<ChevronRight/>} label={t('extraction', 'reviewNextExtraction')} disabled={compare || selectedIndex === history.length - 1} onClick={() => setSelectedId(history[selectedIndex + 1].id)}/>
        <IconButton icon={<Columns2/>} label={t('extraction', compare ? 'reviewSingleExtraction' : 'reviewCompareExtractions')} aria-pressed={compare} onClick={() => setCompare(!compare)}/>
      </>}
      {accepted && accepted.id !== active?.id && <IconButton icon={<Check/>} label={t('extraction', 'reviewOpenAccepted')} onClick={() => {setSelectedId(accepted.id); setCompare(false);}}/>}
      <IconButton icon={<RefreshCw/>} label={t('extraction', 'reviewRefreshExtractions')} disabled={loading} onClick={() => setRefresh(refresh + 1)}/>
    </div>
    {loading && history.length === 0 && <p role="status">{t('extraction', 'reviewLoadingExtractions')}</p>}
    {error && <div role="alert" className="text-xs text-muted-foreground">{t('extraction', history.length ? 'reviewRefreshError' : 'reviewLoadError')}<Button size="xs" variant="ghost" onClick={() => setRefresh(refresh + 1)}>{t('extraction', 'generationTextRetry')}</Button></div>}
    {!loading && !error && !history.length && <p>{t('extraction', 'reviewNoVersions')}</p>}
    <div className={compare ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-2' : 'min-w-0'}>
      {history.map((proposal, index) => <div key={proposal.id} hidden={!compare && proposal.id !== active?.id}>
        <ProposalCard proposal={proposal} ordinal={history.length - index} latest={index === 0} accepted={isAccepted(proposal)} saving={saving} onToggle={onToggle} readOnly={readOnly} {...field}/>
      </div>)}
    </div>
  </div>;
}
