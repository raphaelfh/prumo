import {Check, Focus, Minimize, ChevronLeft, ChevronRight, RotateCcw, Undo2, PanelLeftClose, PanelLeftOpen} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {Button} from '@/components/ui/button';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {sameReviewCoordinate, type ReviewQuestion} from '@/hooks/extraction/useReviewNavigation';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {AISuggestion} from '@/types/ai-extraction';
import type {ReviewWorkspace} from './ExtractionReviewTable';

export function ReviewQuickActions({review, rows, suggestions, guideOpen, onToggleGuide}: {review: ReviewWorkspace; rows: ReviewQuestion[]; suggestions: Record<string, AISuggestion>; guideOpen: boolean; onToggleGuide: () => void}) {
  const {navigation: nav, decisions} = review;
  const current = nav.current;
  const active = current && sameReviewCoordinate(review.activeProposal, current) && sameReviewCoordinate(nav.open, current) ? review.activeProposal?.proposal : undefined;
  const proposal = active ?? (current ? suggestions[`${current.instanceId}_${current.fieldId}`] : undefined);
  const accepted = !!current && !!proposal && decisions.isAccepted({...current, id: proposal.id, value: proposal.proposedValue ?? proposal.value});
  const blocked = decisions.saving || decisions.conflicted;
  const accept = () => {if (current && proposal && !blocked) void decisions.toggle({...current, id: proposal.id, value: proposal.proposedValue ?? proposal.value, allowsNoInformation: current.allowsNoInformation});};
  useKeyboardShortcuts({enabled: true, bindings: [
    {type: 'chord', key: 'a', handler: accept},
    {type: 'chord', key: 'f', handler: nav.toggleFocus},
    {type: 'chord', key: 'ArrowLeft', shift: true, handler: nav.previous},
    {type: 'chord', key: 'ArrowRight', shift: true, handler: nav.next},
  ]});
  const target = rows.find(row => sameReviewCoordinate(row, decisions.undoTarget));
  const undoHint = decisions.saving ? t('extraction', 'reviewSavingDecision') : decisions.undoTarget ? t('extraction', 'reviewUndoTarget').replace('{{question}}', target?.label ?? `${decisions.undoTarget.instanceId} / ${decisions.undoTarget.fieldId}`) : t('extraction', 'reviewNoUndoDecision');
  const actionClass = 'rounded-full border-0';
  return <div className="sticky top-0 z-20 bg-background pb-1">
    <div role="toolbar" aria-label={t('extraction', 'reviewTitle')} className="flex min-w-0 flex-wrap items-center gap-0.5 py-1">
      <IconButton label={t('runs', guideOpen ? 'sectionNavHide' : 'sectionNavShow')} icon={guideOpen ? <PanelLeftClose/> : <PanelLeftOpen/>} onClick={onToggleGuide} aria-expanded={guideOpen} className={actionClass}/>
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">{current?.label ?? t('extraction', 'reviewQuestionCount').replace('{{count}}', String(rows.length))}</span>
      <IconButton label={t('extraction', accepted ? 'reviewUnacceptExtraction' : 'reviewAcceptExtraction')} icon={<Check/>} shortcut={['A']} onClick={accept} disabled={!proposal || blocked} aria-pressed={accepted} className={cn(actionClass, accepted && 'bg-success/10 text-success shadow-sm hover:text-success')}/>
      <IconButton label={t('extraction', nav.focused ? 'reviewLeaveFocus' : 'reviewFocusQuestion')} icon={nav.focused ? <Minimize/> : <Focus/>} shortcut={['F']} onClick={nav.toggleFocus} disabled={!current} aria-pressed={nav.focused} className={cn(actionClass, nav.focused && 'bg-muted text-foreground shadow-sm')}/>
      <IconButton label={t('extraction', 'reviewPreviousQuestion')} hint={!nav.canPrevious ? t('extraction', 'reviewNoPreviousQuestion') : undefined} icon={<ChevronLeft/>} shortcut={['shift', '←']} onClick={nav.previous} disabled={!nav.canPrevious} className={actionClass}/>
      <IconButton label={t('extraction', 'reviewNextPendingQuestion')} hint={!nav.canNext ? t('extraction', 'reviewNoPendingQuestion') : undefined} icon={<ChevronRight/>} shortcut={['shift', '→']} onClick={nav.next} disabled={!nav.canNext} className={actionClass}/>
      <IconButton label={t('extraction', 'reviewResetWidths')} icon={<RotateCcw/>} onClick={review.columns.resetWidths} className={actionClass}/>
      <IconButton label={t('extraction', 'reviewUndoDecision')} hint={undoHint} icon={<Undo2/>} onClick={() => void decisions.undoLatestLocalDecision()} disabled={!decisions.canUndo || blocked} className={actionClass}/>
    </div>
    {decisions.error && <p role="alert" className="px-2 text-xs text-destructive">{decisions.error}</p>}
    {decisions.conflicted && <div className="px-2 text-xs text-muted-foreground"><p>{t('extraction', 'reviewConflictContext')}</p><Button size="xs" variant="ghost" disabled={decisions.saving} onClick={() => void decisions.resumeDraftAfterConflict()}>{t('extraction', 'reviewResumeDraft')}</Button></div>}
  </div>;
}
