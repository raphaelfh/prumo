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

interface Coordinate { instanceId: string; fieldId: string }
interface Proposal extends Coordinate { id: string; value: unknown; allowsNoInformation?: boolean }
interface LocalDecision extends Coordinate { id: string; expectedId: string; predecessor: Record<string, unknown> }
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
  const [state, setState] = useState({session, saving: false, error: null as string | null, stack: [] as LocalDecision[]});
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

  const record = (decision: ReviewerDecisionResponse, predecessor: Record<string, unknown>, undoable: boolean) => {
    void queryClient.invalidateQueries({queryKey: runsKeys.detail(decision.run_id)});
    if (!isCurrent()) return;
    setConfirmed(prev => ({session, rows: [...(prev.session === session ? prev.rows : []), decision]}));
    if (undoable) stackRef.current.push({instanceId: decision.instance_id, fieldId: decision.field_id, id: decision.id, expectedId: decision.id, predecessor});
    setState(prev => ({...prev, session, stack: [...stackRef.current]}));
  };

  const readHistory = async (coordinate: Coordinate) => {
    if (!runId || !reviewerId || !isCurrent()) return null;
    const result = await readDecisionAuthority(runId);
    if (!result.ok) return null;
    if (!isCurrent() || result.data.run.id !== runId) return null;
    setConfirmed({session, rows: result.data.decisions});
    if (result.data.run.stage !== 'extract') return null;
    return historyFor(result.data.decisions, coordinate);
  };

  const writeValue = async (params: WriteProposalParams): Promise<void> => {
    // A lifecycle flush belongs to its captured run, even after navigation.
    if (!reviewerId || reviewerRef.current !== reviewerId) return Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')));
    const authority = await readDecisionAuthority(params.runId);
    if (!authority.ok) return Promise.reject(authority.error);
    if (reviewerRef.current !== reviewerId || authority.data.run.id !== params.runId || authority.data.run.stage !== 'extract') return Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')));
    const history = reviewerCoordinateHistory(authority.data.decisions, reviewerId, params.runId, params.instanceId, params.fieldId);
    const result = await appendReviewerDecision(params.runId, {
      instance_id: params.instanceId, field_id: params.fieldId, decision: 'edit', proposal_record_id: null,
      value: params.absentReason ? {value: params.normalizedValue, absent_reason: params.absentReason} : {value: params.normalizedValue},
    });
    if (!result.ok) return Promise.reject(result.error);
    record(result.data, history.at(-1)?.value ?? {value: null}, true);
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

  const transact = (operation: () => Promise<boolean>): Promise<boolean> => {
    if (lockRef.current || !runId || !reviewerId || props.enabled === false || props.stage !== 'extract') return Promise.resolve(false);
    lockRef.current = true;
    setState(prev => ({...prev, session, saving: true, error: null}));
    return operation().catch(() => false).then(async ok => {
      if (!ok && isCurrent()) await queryClient.invalidateQueries({queryKey: runsKeys.detail(runId)});
      if (isCurrent()) {
        lockRef.current = false;
        setState(prev => ({...prev, session, saving: false, error: ok ? null : t('extraction', 'reviewDecisionConflict')}));
      }
      return ok;
    });
  };

  const toggle = (proposal: Proposal): Promise<boolean> => transact(async () => {
    if (valueAbsentReason(proposal.value) === 'no_information' && proposal.allowsNoInformation === false) return false;
    await autosave.saveNow(proposal);
    let success = false;
    await autosave.runExclusive(async () => {
      const history = await readHistory(proposal);
      if (!history || !isCurrent()) return;
      const key = `${proposal.instanceId}_${proposal.fieldId}`;
      const draft = valuesRef.current[key];
      const reverse = acceptedProposal(history, draft) === proposal.id &&
        decisionMatchesVersion(history.at(-1)?.value, proposal.value);
      const result = await appendReviewerDecision(runId!, {
        instance_id: proposal.instanceId, field_id: proposal.fieldId, decision: 'edit',
        proposal_record_id: reverse ? null : proposal.id,
        value: reverse ? reversalPayload(history) : toConsensusValueEnvelope(proposal.value),
      });
      if (!result.ok) return;
      record(result.data, history.at(-1)?.value ?? {value: null}, true);
      reconcile(proposal, result.data, draft);
      success = true;
    });
    return success;
  });

  const undoLatestLocalDecision = (): Promise<boolean> => transact(async () => {
    // Flush all questions before choosing the latest CONFIRMED local write.
    await autosave.saveNow();
    let success = false;
    await autosave.runExclusive(async () => {
      const entry = stackRef.current.at(-1);
      if (!entry || !isCurrent()) return;
      const history = await readHistory(entry);
      if (!history || history.at(-1)?.id !== entry.expectedId) return;
      const draft = valuesRef.current[`${entry.instanceId}_${entry.fieldId}`];
      const result = await appendReviewerDecision(runId!, {
        instance_id: entry.instanceId, field_id: entry.fieldId, decision: 'edit',
        proposal_record_id: null, value: entry.predecessor,
      });
      if (!result.ok || !isCurrent()) return;
      stackRef.current.pop();
      // The compensating edit becomes the expected head for the preceding
      // local action on this coordinate; it is not itself an undoable action.
      const previous = [...stackRef.current].reverse().find(item => item.instanceId === entry.instanceId && item.fieldId === entry.fieldId);
      if (previous) previous.expectedId = result.data.id;
      record(result.data, entry.predecessor, false);
      reconcile(entry, result.data, draft);
      success = true;
    });
    return success;
  });

  const activeState = state.session === session ? state : {saving: false, error: null, stack: []};
  return {...autosave, toggle, isAccepted, acceptedProposalIdFor, undoLatestLocalDecision,
    canUndo: activeState.stack.length > 0,
    undoTarget: activeState.stack.at(-1) ?? null,
    saving: activeState.saving || autosave.saveState === 'saving',
    error: activeState.error ?? autosave.error,
  };
}
