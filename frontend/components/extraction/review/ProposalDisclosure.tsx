import {useEffect, useRef, useState, type WheelEvent} from 'react';
import {ChevronLeft, ChevronRight, Columns2, History} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {ProposalCard} from './ProposalCard';
import {t} from '@/lib/copy';
import {readBooleanPreference, writeBooleanPreference} from '@/lib/localPreference';
import {cn} from '@/lib/utils';
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
  /** The proposal whose decision is in flight. */
  pendingProposalId?: string | null;
  onToggle: (proposal: AISuggestion) => void;
  readOnly?: boolean;
  initialProposalId?: string;
  /** The row's newest proposal; when a new extraction lands it changes and the history reloads in place. */
  latestProposalId?: string;
  onActiveProposalChange?: (proposal: AISuggestion | undefined) => void;
  id?: string;
}

/**
 * Side-by-side is a reviewer's working habit, not a per-row choice: whoever
 * compares versions on one question compares them on the next. The preference
 * is remembered in this browser so it survives the remount every coordinate
 * change forces — no account state, no server round-trip.
 */
const COMPARE_PREFERENCE = 'review.compareProposals';

/** Opening straight onto one proposal is a request for THAT one, never a layout. */
function preferredCompare(initialProposalId: string | undefined): boolean {
  return !initialProposalId && readBooleanPreference(COMPARE_PREFERENCE, false);
}

/** Coordinate identity remounts local history; closing only hides the mounted subtree. */
export function ProposalDisclosure(props: ProposalDisclosureProps) {
  return <CoordinateDisclosure key={`${props.instanceId}:${props.fieldId}`} {...props}/>;
}

function CoordinateDisclosure({instanceId, fieldId, getHistory, expanded, acceptedProposalId, isAccepted, saving, pendingProposalId, onToggle, readOnly, initialProposalId, latestProposalId, onActiveProposalChange, id, ...field}: ProposalDisclosureProps) {
  const [history, setHistory] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(initialProposalId);
  const [compare, setCompareState] = useState(() => preferredCompare(initialProposalId));
  const setCompare = (next: boolean) => {
    setCompareState(next);
    writeBooleanPreference(COMPARE_PREFERENCE, next);
  };
  const [previousInitialId, setPreviousInitialId] = useState(initialProposalId);
  if (previousInitialId !== initialProposalId) {
    setPreviousInitialId(initialProposalId);
    setSelectedId(initialProposalId);
    setCompareState(preferredCompare(initialProposalId));
  }
  // Re-read on every OPEN, not only on mount: a row keeps its disclosure
  // mounted once visited and merely hides it, so a component that read the
  // preference once would serve whatever it was the first time the reviewer
  // touched that question — and a preference set later would never reach it.
  const [previouslyExpanded, setPreviouslyExpanded] = useState(expanded);
  if (previouslyExpanded !== expanded) {
    setPreviouslyExpanded(expanded);
    if (expanded) setCompareState(preferredCompare(initialProposalId));
  }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true); setError(false);
      void getHistory(instanceId, fieldId).then(data => {
        if (cancelled) return;
        const sorted = [...data].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id));
        // An unchanged reload keeps the mounted array, so a background refresh repaints nothing.
        setHistory(prev => sameIds(prev, sorted) ? prev : sorted);
        setLoading(false);
      }, () => {if (!cancelled) {setError(true); setLoading(false);}});
    });
    return () => {cancelled = true;};
  }, [instanceId, fieldId, getHistory, refresh, latestProposalId]);
  const selectedIndex = Math.max(0, history.findIndex(item => item.id === selectedId));
  const active = history[selectedIndex];
  useEffect(() => {onActiveProposalChange?.(active);}, [active, onActiveProposalChange]);
  const accepted = history.find(item => item.id === acceptedProposalId && isAccepted(item));
  const lastSwipe = useRef(0);
  // A horizontal trackpad swipe or shift+wheel steps the single view; compare scrolls natively.
  const onWheel = (event: WheelEvent) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (compare || Math.abs(delta) < 20 || event.timeStamp - lastSwipe.current < 400) return;
    const next = selectedIndex + Math.sign(delta);
    if (next < 0 || next >= history.length) return;
    lastSwipe.current = event.timeStamp;
    setSelectedId(history[next].id);
  };
  return <div id={id} hidden={!expanded} className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-1">
      {history.length > 1 && <>
        <IconButton icon={<ChevronLeft/>} label={t('extraction', 'reviewPreviousExtraction')} disabled={compare || selectedIndex === 0} onClick={() => setSelectedId(history[selectedIndex - 1].id)}/>
        <span className="text-xs tabular-nums text-muted-foreground">{selectedIndex + 1} / {history.length}</span>
        <IconButton icon={<ChevronRight/>} label={t('extraction', 'reviewNextExtraction')} disabled={compare || selectedIndex === history.length - 1} onClick={() => setSelectedId(history[selectedIndex + 1].id)}/>
        <IconButton icon={<Columns2/>} label={t('extraction', compare ? 'reviewSingleExtraction' : 'reviewCompareExtractions')} aria-pressed={compare} onClick={() => setCompare(!compare)} className={cn(compare && 'bg-muted text-foreground shadow-sm')}/>
      </>}
      {accepted && accepted.id !== active?.id && <IconButton icon={<History/>} label={t('extraction', 'reviewOpenAccepted')} className="text-success hover:text-success" onClick={() => {setSelectedId(accepted.id); setCompareState(false);}}/>}
    </div>
    {loading && history.length === 0 && <p role="status">{t('extraction', 'reviewLoadingExtractions')}</p>}
    {error && <div role="alert" className="text-xs text-muted-foreground">{t('extraction', history.length ? 'reviewRefreshError' : 'reviewLoadError')}<Button size="xs" variant="ghost" onClick={() => setRefresh(refresh + 1)}>{t('extraction', 'generationTextRetry')}</Button></div>}
    {!loading && !error && !history.length && <p>{t('extraction', 'reviewNoVersions')}</p>}
    <div onWheel={onWheel} className={compare ? 'flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1' : 'min-w-0'}>
      {history.map((proposal, index) => <div key={proposal.id} hidden={!compare && proposal.id !== active?.id} className={cn(compare && 'min-w-0 flex-[1_0_min(100%,320px)] snap-start')}>
        <ProposalCard proposal={proposal} ordinal={history.length - index} latest={index === 0} accepted={isAccepted(proposal)} saving={saving} pending={proposal.id === pendingProposalId} onToggle={onToggle} readOnly={readOnly} {...field}/>
      </div>)}
    </div>
  </div>;
}

function sameIds(a: AISuggestion[], b: AISuggestion[]) {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id);
}
