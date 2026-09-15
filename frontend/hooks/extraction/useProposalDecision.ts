import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAutoSaveProposals, type UseAutoSaveProposalsProps } from '@/hooks/runs/useAutoSaveProposals';
import { runsKeys, type ReviewerDecisionResponse } from '@/hooks/runs/types';
import { appendReviewerDecision, readDecisionAuthority, type WriteProposalParams } from '@/services/extractionRunService';
import { acceptedProposal, reversalPayload, reviewerCoordinateHistory } from '@/lib/extraction/proposalDecisionState';
import { currentValuesToValuesMap } from '@/lib/extraction/publishedValues';
import { toConsensusValueEnvelope, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { decisionMatchesVersion, stableStringify } from '@/lib/runs/valueEquality';
import { t } from '@/lib/copy';
import { ApiError } from '@/integrations/api/client';

interface Coordinate { instanceId: string; fieldId: string }
/** `conflict`: the review authority disagrees (409, moved head, run left extract); `failed`: anything else. */
type Outcome = 'saved' | 'conflict' | 'failed';
interface Proposal extends Coordinate { id: string; value: unknown; allowsNoInformation?: boolean }
interface LocalDecision extends Coordinate { id: string; expectedId: string; predecessorId: string | null; predecessor: Record<string, unknown> }
interface Props extends Omit<UseAutoSaveProposalsProps, 'writeValue' | 'linkByKey'> {
  reviewerId: string | null;
  decisions?: readonly ReviewerDecisionResponse[];
  /** Reconcile the owning shell's draft and baseline in the same update. */
  onConfirmed: (coordinate: Coordinate, value: unknown) => void;
}

/** Mounted by the extraction shell so undo survives question/entry navigation. */
export function useProposalDecision(props: Props) {
  const {runId, reviewerId, values, decisions = [], onConfirmed} = props;
  const queryClient = useQueryClient();
  const scope = `${reviewerId ?? ''}/${runId ?? ''}`;
  const [session, setSession] = useState({scope});
  if (session.scope !== scope) setSession({scope});
  const scopeRef = useRef(session);
  const valuesRef = useRef(values);
  const reviewerRef = useRef(reviewerId);
  const stackRef = useRef<LocalDecision[]>([]);
  const lockRef = useRef(false);
  const blockedSessionsRef = useRef(new WeakSet<object>());
  const [state, setState] = useState({session, saving: false, conflicted: false, error: null as string | null, stack: [] as LocalDecision[]});
  const [confirmed, setConfirmed] = useState<{session: typeof session; rows: ReviewerDecisionResponse[]}>({session, rows: []});
  useEffect(() => {
    valuesRef.current = values;
    reviewerRef.current = reviewerId;
    if (scopeRef.current !== session) {
      scopeRef.current = session;
      stackRef.current = [];
      lockRef.current = false;
    }
  }, [session, values, reviewerId]);

  const isCurrent = () => scopeRef.current === session;
  const localRows = confirmed.session === session ? confirmed.rows : [];
  const historyFor = (rows: readonly ReviewerDecisionResponse[], coordinate: Coordinate) =>
    reviewerCoordinateHistory(rows, reviewerId, runId ?? '', coordinate.instanceId, coordinate.fieldId);
  const allRows = [...decisions.filter(d => !localRows.some(local => local.id === d.id)), ...localRows];
  const acceptedProposalIdFor = (instanceId: string, fieldId: string) =>
    acceptedProposal(historyFor(allRows, {instanceId, fieldId}), values[`${instanceId}_${fieldId}`]);

  const isAccepted = (proposal: Proposal) =>
    acceptedProposalIdFor(proposal.instanceId, proposal.fieldId) === proposal.id &&
    decisionMatchesVersion(historyFor(allRows, proposal).at(-1)?.value, proposal.value);

  // Manual edits sever a proposal link only on this opt-in extraction writer.
  // Unchanged hydrated values keep their link and do not append on mount.
  const linkByKey: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    const [instanceId, fieldId] = key.split('_');
    const link = acceptedProposalIdFor(instanceId, fieldId);
    if (link) linkByKey[key] = link;
  }

  const record = (decision: ReviewerDecisionResponse, predecessor: Record<string, unknown>, undoable: boolean, predecessorId: string | null = null) => {
    void queryClient.invalidateQueries({queryKey: runsKeys.detail(decision.run_id)});
    if (!isCurrent()) return;
    setConfirmed(prev => ({session, rows: [...(prev.session === session ? prev.rows : []), decision]}));
    if (undoable) stackRef.current.push({instanceId: decision.instance_id, fieldId: decision.field_id, id: decision.id, expectedId: decision.id, predecessorId, predecessor});
    setState(prev => ({...prev, session, stack: [...stackRef.current]}));
  };

  const readHistory = async (coordinate: Coordinate): Promise<ReviewerDecisionResponse[] | Exclude<Outcome, 'saved'>> => {
    if (!runId || !reviewerId || !isCurrent()) return 'failed';
    const result = await readDecisionAuthority(runId);
    if (!result.ok) return 'failed';
    if (!isCurrent() || result.data.run.id !== runId) return 'conflict';
    setConfirmed({session, rows: result.data.decisions});
    if (result.data.run.stage !== 'extract') return 'conflict';
    return historyFor(result.data.decisions, coordinate);
  };
  const failureOf = (error: unknown): Exclude<Outcome, 'saved'> =>
    error instanceof ApiError && error.status === 409 && error.code === 'DECISION_CONFLICT' ? 'conflict' : 'failed';

  const freezeConflict = () => {
    blockedSessionsRef.current.add(session);
    if (!isCurrent()) return;
    setState(prev => ({...prev, session, conflicted: true, error: t('extraction', 'reviewDecisionConflict')}));
  };

  const writeValue = async (params: WriteProposalParams): Promise<void> => {
    // A lifecycle flush belongs to its captured run, even after navigation.
    if (blockedSessionsRef.current.has(session) || !reviewerId || reviewerRef.current !== reviewerId) return Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')));
    const authority = await readDecisionAuthority(params.runId);
    if (!authority.ok) return Promise.reject(authority.error);
    if (blockedSessionsRef.current.has(session) || reviewerRef.current !== reviewerId || authority.data.run.id !== params.runId || authority.data.run.stage !== 'extract') return Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')));
    const history = reviewerCoordinateHistory(authority.data.decisions, reviewerId, params.runId, params.instanceId, params.fieldId);
    const result = await appendReviewerDecision(params.runId, {
      instance_id: params.instanceId, field_id: params.fieldId, decision: 'edit', proposal_record_id: null,
      value: params.absentReason ? {value: params.normalizedValue, absent_reason: params.absentReason} : {value: params.normalizedValue},
    });
    if (!result.ok) return Promise.reject(result.error);
    record(result.data, history.at(-1)?.value ?? {value: null}, true, history.at(-1)?.id ?? null);
  };

  const autosave = useAutoSaveProposals({...props, scopeKey: session, enabled: props.enabled !== false && !!reviewerId, linkByKey, writeValue});

  const reconcile = (coordinate: Coordinate, decision: ReviewerDecisionResponse, draftAtStart: unknown) => {
    if (!isCurrent()) return;
    const key = `${coordinate.instanceId}_${coordinate.fieldId}`;
    const value = currentValuesToValuesMap([{instance_id: coordinate.instanceId, field_id: coordinate.fieldId,
      value: decision.value, decision: 'edit'}])[key];
    // Preserve input made while the explicit request was in flight.
    const unchanged = stableStringify(valuesRef.current[key]) === stableStringify(draftAtStart);
    autosave.acknowledge(key, value, decision.proposal_record_id);
    if (unchanged) onConfirmed(coordinate, value);
  };

  const transact = (operation: () => Promise<Outcome>): Promise<boolean> => {
    if (blockedSessionsRef.current.has(session) || lockRef.current || !runId || !reviewerId || props.enabled === false || props.stage !== 'extract') return Promise.resolve(false);
    lockRef.current = true;
    setState(prev => ({...prev, session, saving: true, error: null}));
    return operation().catch((): Outcome => 'failed').then(async outcome => {
      const ok = outcome === 'saved';
      if (!ok && isCurrent()) await queryClient.invalidateQueries({queryKey: runsKeys.detail(runId)});
      if (isCurrent()) {
        lockRef.current = false;
        const error = outcome === 'conflict' ? t('extraction', 'reviewDecisionConflict') : t('extraction', 'reviewDecisionSaveFailed');
        setState(prev => ({...prev, session, saving: false, error: ok ? null : error}));
      }
      return ok;
    });
  };

  const toggle = (proposal: Proposal): Promise<boolean> => transact(async () => {
    if (valueAbsentReason(proposal.value) === 'no_information' && proposal.allowsNoInformation === false) return 'conflict';
    await autosave.saveNow(proposal);
    let outcome: Outcome = 'failed';
    await autosave.runExclusive(async () => {
      const history = await readHistory(proposal);
      if (typeof history === 'string') { outcome = history; return; }
      if (!isCurrent()) return;
      const key = `${proposal.instanceId}_${proposal.fieldId}`;
      const draft = valuesRef.current[key];
      const reverse = acceptedProposal(history, draft) === proposal.id &&
        decisionMatchesVersion(history.at(-1)?.value, proposal.value);
      const result = await appendReviewerDecision(runId!, {
        instance_id: proposal.instanceId, field_id: proposal.fieldId, decision: 'edit',
        proposal_record_id: reverse ? null : proposal.id,
        value: reverse ? reversalPayload(history) : toConsensusValueEnvelope(proposal.value),
      });
      if (!result.ok) { outcome = failureOf(result.error); return; }
      record(result.data, history.at(-1)?.value ?? {value: null}, true, history.at(-1)?.id ?? null);
      reconcile(proposal, result.data, draft);
      outcome = 'saved';
    });
    return outcome;
  });

  const undoLatestLocalDecision = (): Promise<boolean> => transact(async () => {
    // Flush all questions before choosing the latest CONFIRMED local write.
    await autosave.saveNow();
    let outcome: Outcome = 'failed';
    await autosave.runExclusive(async () => {
      const entry = stackRef.current.at(-1);
      if (!entry || !isCurrent()) return;
      const history = await readHistory(entry);
      // An unreadable authority is a retryable failure, not an observed conflict.
      if (history === 'failed') return;
      if (history === 'conflict' || history.at(-1)?.id !== entry.expectedId) {
        // A known conflict must also stop queued debounce and lifecycle writes:
        // refreshing the history changes links but does not discard the draft.
        outcome = 'conflict';
        if (isCurrent()) freezeConflict();
        return;
      }
      const draft = valuesRef.current[`${entry.instanceId}_${entry.fieldId}`];
      const result = await appendReviewerDecision(runId!, {
        instance_id: entry.instanceId, field_id: entry.fieldId, decision: 'edit',
        proposal_record_id: null, value: entry.predecessor,
        expected_current_decision_id: entry.expectedId,
      });
      if (!result.ok) {
        outcome = failureOf(result.error);
        if (outcome === 'conflict') {
          freezeConflict();
          await readHistory(entry);
        }
        return;
      }
      if (!isCurrent()) return;
      stackRef.current.pop();
      // The compensating edit becomes the expected head for the preceding
      // local action on this coordinate; it is not itself an undoable action.
      const previous = [...stackRef.current].reverse().find(item => item.instanceId === entry.instanceId && item.fieldId === entry.fieldId);
      if (previous && previous.expectedId === entry.predecessorId) previous.expectedId = result.data.id;
      record(result.data, entry.predecessor, false);
      reconcile(entry, result.data, draft);
      outcome = 'saved';
    });
    return outcome;
  });

  /** Explicitly resume the retained draft after refreshing current authority.
   * This does not rebase an undo entry onto an external decision. */
  const resumeDraftAfterConflict = async (): Promise<boolean> => {
    if (!blockedSessionsRef.current.has(session) || lockRef.current || !runId || !reviewerId || props.enabled === false) return false;
    lockRef.current = true;
    setState(prev => ({...prev, session, saving: true}));
    const authority = await readDecisionAuthority(runId);
    if (!isCurrent()) return false;
    const ok = authority.ok && authority.data.run.id === runId && authority.data.run.stage === 'extract';
    if (ok) {
      setConfirmed({session, rows: authority.data.decisions});
      blockedSessionsRef.current.delete(session);
    }
    lockRef.current = false;
    setState(prev => ({...prev, session, saving: false, conflicted: !ok,
      error: ok ? null : t('extraction', 'reviewDecisionConflict')}));
    return ok;
  };

  const saveNow: typeof autosave.saveNow = scope => blockedSessionsRef.current.has(session)
    ? Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')))
    : autosave.saveNow(scope);

  const activeState = state.session === session ? state : {saving: false, conflicted: false, error: null, stack: []};
  return {...autosave, saveNow, resumeDraftAfterConflict, conflicted: activeState.conflicted, toggle, isAccepted, acceptedProposalIdFor, undoLatestLocalDecision,
    canUndo: activeState.stack.length > 0,
    undoTarget: activeState.stack.at(-1) ?? null,
    saving: activeState.saving || autosave.saveState === 'saving',
    error: activeState.error ?? autosave.error,
  };
}
