/**
 * The run screen's values: what the form shows and how it is written, for
 * BOTH run kinds (extraction, quality assessment). One invariant, stated once:
 *
 *  - `extract` / `consensus` — the form shows the caller-scoped current value
 *    per coordinate (`runDetail.current_values`: own decisions over own human
 *    proposals over system seeds, resolved server-side; a `reject` clears).
 *  - `finalized` — the form shows published truth (`published_states`) and
 *    nothing else (spec 2026-07-02 D3); every refetch replaces it.
 *  - any other stage, no run, or no signed-in caller — an empty form.
 *  - Local edits win mid-save: a refetch of the SAME run for the SAME caller
 *    only adds coordinates the form does not hold yet, so a keystroke the
 *    debounce has not written is never overwritten by the older server value.
 *    Another run or another caller replaces the form outright — the old run's
 *    pending edit is carried by the autosave's run-keyed flush, never by state
 *    bleeding into the new run.
 *
 * Writes are per-reviewer `edit` decisions on `/runs/{id}/decisions`, only in
 * `extract`, each guarded on the caller's local head decision for the coord
 * (`expected_current_decision_id`). Typing autosaves through the debounced
 * queue (`useAutoSaveProposals`); accepting an AI proposal is an explicit
 * decision carrying `proposal_record_id`, shared by both kinds, with local
 * undo/redo. A 409 — or a 400 after the run left `extract` — freezes the
 * session's writes until `resumeDraftAfterConflict` re-reads authority. The
 * AI link of a coordinate is never inferred from suggestion status: it is the
 * caller's latest decision on it, when that decision still matches the value.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAutoSaveProposals } from '@/hooks/runs/useAutoSaveProposals';
import { runsKeys, type ReviewerDecisionResponse, type RunViewResponse } from '@/hooks/runs/types';
import { ApiError } from '@/integrations/api/client';
import { t } from '@/lib/copy';
import { acceptedProposal, mergeConfirmedRows, reversalPayload, reviewerCoordinateHistory, reviewerHistoriesByCoord } from '@/lib/extraction/proposalDecisionState';
import { currentValuesToValuesMap, publishedStatesToValuesMap } from '@/lib/extraction/publishedValues';
import { toConsensusValueEnvelope, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { dispatchValueUpdates } from '@/lib/extraction/valueUpdates';
import { deriveAiLinkByKey } from '@/lib/runs/aiLink';
import { coordKey, parseCoordKey, type Coord } from '@/lib/runs/coord';
import { decisionMatchesVersion, stableStringify } from '@/lib/runs/valueEquality';
import { appendReviewerDecision, type WriteProposalParams } from '@/services/extractionRunService';
import { fetchRunView } from '@/services/runLifecycleService';

/** An AI proposal the caller accepts (or, when it is the accepted one, reverses). */
export interface RunValueProposal extends Coord {
  id: string;
  value: unknown;
  allowsNoInformation?: boolean;
}

export interface UseRunValuesArgs {
  /** The run view the screen renders; undefined while it loads. */
  runDetail: RunViewResponse | undefined;
  currentUserId: string | null;
  /** The caller may write (a viewer never does); the stage gate is the hook's own. */
  enabled: boolean;
  /** Autosave debounce in ms (default 600). */
  debounceMs?: number;
}

/** `conflict`: the review authority disagrees (409, moved head, run left extract); `failed`: anything else. */
type Outcome = 'saved' | 'conflict' | 'failed';
/** `value`/`proposalRecordId` are the action itself, so an undone action can be redone verbatim. */
interface LocalDecision extends Coord { id: string; expectedId: string; predecessorId: string | null; predecessor: Record<string, unknown>; value: Record<string, unknown>; proposalRecordId: string | null }
/** The in-flight decision; `proposalId` is null for undo/redo. */
interface PendingDecision extends Coord { proposalId: string | null }
/** The form: its values, the server map they were hydrated from, and the coordinates the last hydration added. */
interface Form { scope: string; server: Record<string, unknown>; values: Record<string, unknown>; added: string[] }

const EMPTY_VALUES: Record<string, unknown> = {};
const NO_DECISIONS: readonly ReviewerDecisionResponse[] = [];

/** What the server says the caller's form holds — the invariant above, by stage. */
function serverValues(runDetail: RunViewResponse | undefined, currentUserId: string | null): Record<string, unknown> {
  const stage = runDetail?.run.stage;
  if (!runDetail) return EMPTY_VALUES;
  if (stage === 'finalized') return publishedStatesToValuesMap(runDetail.published_states);
  if ((stage === 'extract' || stage === 'consensus') && currentUserId) return currentValuesToValuesMap(runDetail.current_values);
  return EMPTY_VALUES;
}

/** Another scope, or a stage that is not edited, replaces the form; the same scope mid-edit only adopts new coordinates. */
function hydrate(prev: Form, scope: string, server: Record<string, unknown>, stage: string | undefined): Form {
  if (prev.scope !== scope || (stage !== 'extract' && stage !== 'consensus')) {
    return {scope, server, values: server, added: stage === 'finalized' ? [] : Object.keys(server)};
  }
  const added = Object.keys(server).filter(key => !(key in prev.values));
  if (added.length === 0) return {...prev, server};
  const values = {...prev.values};
  for (const key of added) values[key] = server[key];
  return {scope, server, values, added};
}

export function useRunValues(args: UseRunValuesArgs) {
  const {runDetail, currentUserId, enabled} = args;
  const runId = runDetail?.run.id ?? null;
  const stage = runDetail?.run.stage;
  const decisions = runDetail?.decisions ?? NO_DECISIONS;
  const queryClient = useQueryClient();

  // ---- Hydration (render-phase; this render already uses the hydrated form) ----
  const server = useMemo(() => serverValues(runDetail, currentUserId), [runDetail, currentUserId]);
  const scope = `${currentUserId ?? ''}/${runId ?? ''}`;
  const [storedForm, setForm] = useState<Form>(() => hydrate({scope: '', server: EMPTY_VALUES, values: EMPTY_VALUES, added: []}, scope, server, stage));
  const form = storedForm.scope === scope && storedForm.server === server ? storedForm : hydrate(storedForm, scope, server, stage);
  if (form !== storedForm) setForm(form);
  const values = form.values;

  // Newly hydrated coordinates flash in the form (useJustUpdatedValue).
  useEffect(() => {
    if (form.added.length === 0) return;
    const frame = requestAnimationFrame(() => dispatchValueUpdates(form.added));
    return () => cancelAnimationFrame(frame);
  }, [form.added]);

  const updateValue = (instanceId: string, fieldId: string, value: unknown) => {
    const key = coordKey(instanceId, fieldId);
    setForm(prev => ({...prev, values: {...prev.values, [key]: value}}));
  };

  // ---- Decision session: one per (caller, run) ----
  const [session, setSession] = useState({scope});
  if (session.scope !== scope) setSession({scope});
  const scopeRef = useRef(session);
  const valuesRef = useRef(values);
  const reviewerRef = useRef(currentUserId);
  const stackRef = useRef<LocalDecision[]>([]);
  const redoRef = useRef<LocalDecision[]>([]);
  const lockRef = useRef(false);
  const blockedSessionsRef = useRef(new WeakSet<object>());
  const decisionsRef = useRef(decisions);
  const [state, setState] = useState({session, saving: false, pending: null as PendingDecision | null, conflicted: false, error: null as string | null, stack: [] as LocalDecision[], redo: [] as LocalDecision[]});
  const [confirmed, setConfirmed] = useState<{session: typeof session; rows: ReviewerDecisionResponse[]}>({session, rows: []});
  const confirmedRef = useRef(confirmed);
  useEffect(() => {
    valuesRef.current = values;
    reviewerRef.current = currentUserId;
    decisionsRef.current = decisions;
    if (scopeRef.current !== session) {
      scopeRef.current = session;
      stackRef.current = [];
      redoRef.current = [];
      lockRef.current = false;
    }
  }, [session, values, currentUserId, decisions]);

  const isCurrent = () => scopeRef.current === session;
  const sessionRows = (c: typeof confirmed) => (c.session === session ? c.rows : NO_DECISIONS);
  const historyFor = (rows: readonly ReviewerDecisionResponse[], coordinate: Coord) =>
    reviewerCoordinateHistory(rows, currentUserId, runId ?? '', coordinate.instanceId, coordinate.fieldId);
  // Grouped once per render: the link loop below looks up every form coordinate.
  const histories = reviewerHistoriesByCoord(mergeConfirmedRows(decisions, sessionRows(confirmed)), currentUserId, runId ?? '');
  const currentHistory = (instanceId: string, fieldId: string) => histories.get(coordKey(instanceId, fieldId)) ?? NO_DECISIONS;
  const acceptedProposalIdFor = (instanceId: string, fieldId: string) =>
    acceptedProposal(currentHistory(instanceId, fieldId), values[coordKey(instanceId, fieldId)]);

  const isAccepted = (proposal: RunValueProposal) => {
    const history = currentHistory(proposal.instanceId, proposal.fieldId);
    return acceptedProposal(history, values[coordKey(proposal.instanceId, proposal.fieldId)]) === proposal.id &&
      decisionMatchesVersion(history.at(-1)?.value, proposal.value);
  };

  // The AI link of each coordinate: the caller's latest decision on it, while
  // that decision still matches the value. The persisted links (the caller's
  // own decisions as loaded) are the link-side baseline, so an unchanged
  // hydrated coordinate is never re-written on mount.
  const linkByKey: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    const {instanceId, fieldId} = parseCoordKey(key);
    const link = acceptedProposalIdFor(instanceId, fieldId);
    if (link) linkByKey[key] = link;
  }
  const baselineLinkByKey = useMemo(() => deriveAiLinkByKey({decisions, currentUserId}), [decisions, currentUserId]);

  /** The confirmed rows as of now (the ref is written with every confirmation), so async writes never read a stale render. */
  const setRows = (rows: ReviewerDecisionResponse[]) => {
    confirmedRef.current = {session, rows};
    setConfirmed(confirmedRef.current);
  };
  const latestHistory = (coordinate: Coord, run = runId ?? '') => {
    const rows = mergeConfirmedRows(decisionsRef.current, sessionRows(confirmedRef.current));
    return reviewerCoordinateHistory(rows, currentUserId, run, coordinate.instanceId, coordinate.fieldId);
  };
  /** Guard on the local head; with no head the append stays unconditional. */
  const expectedHead = (history: readonly ReviewerDecisionResponse[]) => {
    const id = history.at(-1)?.id;
    return id ? {expected_current_decision_id: id} : {};
  };

  // Confirmed rows are merged locally: a write never invalidates the run view.
  const record = (decision: ReviewerDecisionResponse, predecessor: Record<string, unknown>, undoable: boolean, predecessorId: string | null = null, redone = false) => {
    if (!isCurrent()) return;
    setRows([...sessionRows(confirmedRef.current), decision]);
    if (undoable) stackRef.current.push({instanceId: decision.instance_id, fieldId: decision.field_id, id: decision.id, expectedId: decision.id, predecessorId, predecessor,
      value: decision.value ?? {value: null}, proposalRecordId: decision.proposal_record_id ?? null});
    // A new action forks the history: what was undone before it can no longer be redone.
    if (undoable && !redone) redoRef.current = [];
    setState(prev => ({...prev, session, stack: [...stackRef.current], redo: [...redoRef.current]}));
  };

  const readHistory = async (coordinate: Coord): Promise<ReviewerDecisionResponse[] | Exclude<Outcome, 'saved'>> => {
    if (!runId || !currentUserId || !isCurrent()) return 'failed';
    const result = await fetchRunView(runId);
    if (!result.ok) return 'failed';
    if (!isCurrent() || result.data.run.id !== runId) return 'conflict';
    setRows(result.data.decisions);
    if (result.data.run.stage !== 'extract') return 'conflict';
    return historyFor(result.data.decisions, coordinate);
  };

  const freezeConflict = () => {
    blockedSessionsRef.current.add(session);
    if (!isCurrent()) return;
    setState(prev => ({...prev, session, conflicted: true, error: t('extraction', 'reviewDecisionConflict')}));
  };

  /** A 409 DECISION_CONFLICT is a conflict; a 400 is one only when fresh authority shows the run left extract.
   * Both refresh the authoritative history; a known conflict also stops queued writes. */
  const settleFailure = async (error: unknown, coordinate: Coord): Promise<Exclude<Outcome, 'saved'>> => {
    if (!(error instanceof ApiError)) return 'failed';
    if (error.status === 409 && error.code === 'DECISION_CONFLICT') {
      freezeConflict();
      await readHistory(coordinate);
      return 'conflict';
    }
    if (error.status !== 400 || await readHistory(coordinate) !== 'conflict') return 'failed';
    freezeConflict();
    return 'conflict';
  };

  const writeValue = async (params: WriteProposalParams): Promise<void> => {
    // A lifecycle flush belongs to its captured run, even after navigation.
    if (blockedSessionsRef.current.has(session) || !currentUserId || reviewerRef.current !== currentUserId) return Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')));
    const coordinate = {instanceId: params.instanceId, fieldId: params.fieldId};
    const history = latestHistory(coordinate, params.runId);
    const result = await appendReviewerDecision(params.runId, {
      instance_id: params.instanceId, field_id: params.fieldId, decision: 'edit', proposal_record_id: null,
      value: params.absentReason ? {value: params.normalizedValue, absent_reason: params.absentReason} : {value: params.normalizedValue},
      ...expectedHead(history),
    });
    if (!result.ok) {
      await settleFailure(result.error, coordinate);
      return Promise.reject(result.error);
    }
    record(result.data, history.at(-1)?.value ?? {value: null}, true, history.at(-1)?.id ?? null);
  };

  const autosave = useAutoSaveProposals({
    runId, stage, values, baselineValues: server, linkByKey, baselineLinkByKey, writeValue,
    scopeKey: session, enabled: enabled && !!currentUserId, debounceMs: args.debounceMs,
  });

  const reconcile = (coordinate: Coord, decision: ReviewerDecisionResponse, draftAtStart: unknown) => {
    if (!isCurrent()) return;
    const key = coordKey(coordinate.instanceId, coordinate.fieldId);
    const value = currentValuesToValuesMap([{instance_id: coordinate.instanceId, field_id: coordinate.fieldId,
      value: decision.value, decision: 'edit'}])[key];
    // Preserve input made while the explicit request was in flight.
    const unchanged = stableStringify(valuesRef.current[key]) === stableStringify(draftAtStart);
    autosave.acknowledge(key, value, decision.proposal_record_id);
    if (unchanged) updateValue(coordinate.instanceId, coordinate.fieldId, value);
  };

  const transact = (target: PendingDecision | null, operation: () => Promise<Outcome>): Promise<boolean> => {
    if (blockedSessionsRef.current.has(session) || lockRef.current || !runId || !currentUserId || !enabled || stage !== 'extract') return Promise.resolve(false);
    lockRef.current = true;
    setState(prev => ({...prev, session, saving: true, pending: target, error: null}));
    return operation().catch((): Outcome => 'failed').then(async outcome => {
      const ok = outcome === 'saved';
      if (!ok && isCurrent()) await queryClient.invalidateQueries({queryKey: runsKeys.detail(runId)});
      if (isCurrent()) {
        lockRef.current = false;
        const error = outcome === 'conflict' ? t('extraction', 'reviewDecisionConflict') : t('extraction', 'reviewDecisionSaveFailed');
        setState(prev => ({...prev, session, saving: false, pending: null, error: ok ? null : error}));
      }
      return ok;
    });
  };

  /** Accept an AI proposal as the caller's decision — or, when it is the accepted one, reverse to the predecessor. */
  const acceptProposal = (proposal: RunValueProposal): Promise<boolean> => transact({instanceId: proposal.instanceId, fieldId: proposal.fieldId, proposalId: proposal.id}, async () => {
    if (valueAbsentReason(proposal.value) === 'no_information' && proposal.allowsNoInformation === false) return 'conflict';
    await autosave.saveNow(proposal);
    let outcome: Outcome = 'failed';
    await autosave.runExclusive(async () => {
      if (!isCurrent()) return;
      const history = latestHistory(proposal);
      const draft = valuesRef.current[coordKey(proposal.instanceId, proposal.fieldId)];
      const reverse = acceptedProposal(history, draft) === proposal.id &&
        decisionMatchesVersion(history.at(-1)?.value, proposal.value);
      const result = await appendReviewerDecision(runId!, {
        instance_id: proposal.instanceId, field_id: proposal.fieldId, decision: 'edit',
        proposal_record_id: reverse ? null : proposal.id,
        value: reverse ? reversalPayload(history) : toConsensusValueEnvelope(proposal.value),
        ...expectedHead(history),
      });
      if (!result.ok) { outcome = await settleFailure(result.error, proposal); return; }
      record(result.data, history.at(-1)?.value ?? {value: null}, true, history.at(-1)?.id ?? null);
      reconcile(proposal, result.data, draft);
      outcome = 'saved';
    });
    return outcome;
  });

  /** Rejecting a proposal clears the coordinate; autosave writes the clear. */
  const rejectProposal = (instanceId: string, fieldId: string) => updateValue(instanceId, fieldId, null);

  /** Replays the top of `stack` as a guarded append: the head must still be the entry's expected decision. */
  const replayLocal = (stack: {current: LocalDecision[]}, payload: (entry: LocalDecision) => {value: Record<string, unknown>; proposal_record_id: string | null},
    onSaved: (entry: LocalDecision, decision: ReviewerDecisionResponse) => void): Promise<boolean> => {
    const top = stack.current.at(-1);
    return transact(top ? {instanceId: top.instanceId, fieldId: top.fieldId, proposalId: null} : null, async () => {
      // Flush all questions before choosing the latest CONFIRMED local write.
      await autosave.saveNow();
      let outcome: Outcome = 'failed';
      await autosave.runExclusive(async () => {
        const entry = stack.current.at(-1);
        if (!entry || !isCurrent()) return;
        const draft = valuesRef.current[coordKey(entry.instanceId, entry.fieldId)];
        // No pre-read: the server's expected-head guard is the check. A conflict
        // freezes queued writes and refreshes history without discarding the draft.
        const result = await appendReviewerDecision(runId!, {
          instance_id: entry.instanceId, field_id: entry.fieldId, decision: 'edit',
          ...payload(entry), expected_current_decision_id: entry.expectedId,
        });
        if (!result.ok) { outcome = await settleFailure(result.error, entry); return; }
        if (!isCurrent()) return;
        stack.current.pop();
        onSaved(entry, result.data);
        reconcile(entry, result.data, draft);
        outcome = 'saved';
      });
      return outcome;
    });
  };

  const undoLatestLocalDecision = (): Promise<boolean> => replayLocal(stackRef, entry => ({value: entry.predecessor, proposal_record_id: null}), (entry, decision) => {
    // The compensating edit becomes the expected head for the preceding
    // local action on this coordinate; it is not itself an undoable action.
    const previous = [...stackRef.current].reverse().find(item => item.instanceId === entry.instanceId && item.fieldId === entry.fieldId);
    if (previous && previous.expectedId === entry.predecessorId) previous.expectedId = decision.id;
    redoRef.current.push({...entry, expectedId: decision.id});
    record(decision, entry.predecessor, false);
  });

  /** Re-applies the latest undone action, link included, on top of its compensating edit. */
  const redoLatestLocalDecision = (): Promise<boolean> => replayLocal(redoRef, entry => ({value: entry.value, proposal_record_id: entry.proposalRecordId}),
    (entry, decision) => record(decision, entry.predecessor, true, entry.expectedId, true));

  /** Explicitly resume the retained draft after refreshing current authority.
   * This does not rebase an undo entry onto an external decision. */
  const resumeDraftAfterConflict = async (): Promise<boolean> => {
    if (!blockedSessionsRef.current.has(session) || lockRef.current || !runId || !currentUserId || !enabled) return false;
    lockRef.current = true;
    setState(prev => ({...prev, session, saving: true}));
    const authority = await fetchRunView(runId);
    if (!isCurrent()) return false;
    const ok = authority.ok && authority.data.run.id === runId && authority.data.run.stage === 'extract';
    if (ok) {
      setRows(authority.data.decisions);
      blockedSessionsRef.current.delete(session);
    }
    lockRef.current = false;
    setState(prev => ({...prev, session, saving: false, conflicted: !ok,
      error: ok ? null : t('extraction', 'reviewDecisionConflict')}));
    return ok;
  };

  /** Flush pending edits; rejects when the flush failed or the session is frozen by a conflict. */
  const saveNow: typeof autosave.saveNow = target => blockedSessionsRef.current.has(session)
    ? Promise.reject(new Error(t('extraction', 'reviewDecisionConflict')))
    : autosave.saveNow(target);

  const activeState = state.session === session ? state : {saving: false, pending: null, conflicted: false, error: null, stack: [], redo: []};
  return {
    values,
    updateValue,
    acceptProposal,
    rejectProposal,
    isAccepted,
    acceptedProposalIdFor,
    saveState: autosave.saveState,
    lastSavedAt: autosave.lastSavedAt,
    saveNow,
    undoLatestLocalDecision,
    redoLatestLocalDecision,
    resumeDraftAfterConflict,
    pendingDecision: activeState.pending,
    canUndo: activeState.stack.length > 0,
    undoTarget: activeState.stack.at(-1) ?? null,
    canRedo: activeState.redo.length > 0,
    redoTarget: activeState.redo.at(-1) ?? null,
    conflicted: activeState.conflicted,
    saving: activeState.saving || autosave.saveState === 'saving',
    error: activeState.error ?? autosave.error,
  };
}

export type RunValues = ReturnType<typeof useRunValues>;
