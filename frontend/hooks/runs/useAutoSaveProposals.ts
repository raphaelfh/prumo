/**
 * Auto-save user edits as ``human`` proposals on the active Run, with a
 * proper state machine and lifecycle handlers that survive route
 * changes, tab closes, and visibility switches.
 *
 * Used by both Data Extraction and Quality Assessment full-screen
 * pages — anywhere a flat ``Record<`${instanceId}_${fieldId}`, value>``
 * map needs to be persisted as ProposalRecords on a Run.
 *
 * State machine:
 *   - ``idle``    nothing dirty, no save in flight
 *   - ``dirty``   user typed; debounce armed; save pending
 *   - ``saving``  POST(s) in flight to ``/runs/{id}/proposals``
 *   - ``saved``   last save acknowledged; ``lastSavedAt`` updated
 *   - ``error``   last save failed; retries on next keystroke
 *
 * Survivability:
 *   - ``useEffect`` cleanup on unmount fires ``performSave`` so a
 *     route change mid-debounce does not drop the pending write.
 *   - ``pagehide`` (mobile-safe, fires on tab close + bfcache) and
 *     ``visibilitychange`` -> "hidden" both trigger an immediate flush.
 *   - All POSTs go out with ``keepalive: true`` so the OS keeps the
 *     request alive past page unload (works on iOS Safari where
 *     ``beforeunload`` is ignored).
 *
 * Diff-aware: only fields whose value changed since the last
 * successful save are written, so the append-only
 * ``extraction_proposal_records`` table doesn't accumulate one
 * duplicate row per debounce tick.
 *
 * Concurrent ``performSave`` invocations are serialized: a save triggered
 * while another is in flight waits for the first batch, recomputes the
 * dirty diff, and writes any trailing edits.
 *
 * Goes straight to ``apiClient`` rather than wrapping a TanStack Query
 * mutation: invalidating ``runs.detail(runId)`` on every debounced
 * tick would trigger a ``GET /runs/{id}`` round-trip per save, which
 * the form doesn't need — local state already shows the typed value
 * and the next natural refetch picks up the freshly written proposals.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { writeRunFieldValue } from '@/services/extractionRunService';
import { t } from '@/lib/copy';
import { extractValueForSave } from '@/lib/validations/selectOther';
import { selectDirtyEntries } from '@/lib/extraction/autosaveDirty';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveProposalsProps {
  runId: string | null | undefined;
  values: Record<string, unknown>;
  enabled?: boolean;
  /** Debounce delay in ms (default 600). */
  debounceMs?: number;
  /**
   * Active run stage. Drives the write target:
   *   - ``'review'`` → POST ``/decisions`` with decision='edit' so each
   *     reviewer's typing lands as a per-user ReviewerDecision (the
   *     blind-review contract). The run view reads these back resolved
   *     and scoped to the active reviewer (``currentValues``).
   *   - any other value (``'proposal'``, ``undefined``, …) → POST
   *     ``/proposals`` with source='human'. Preserves the existing QA
   *     single-user publish flow and the extraction PROPOSAL stage
   *     where the AI/proposer fills in initial values.
   *
   * Layer 2 of the multi-reviewer-blind fix. Omitting it keeps the
   * legacy behaviour (proposal write) so callers that don't yet care
   * about the stage discriminator (QA today) are unaffected.
   */
  stage?: string | null;
  /**
   * Server-persisted values per ``${instanceId}_${fieldId}`` (the map the
   * form hydrated from). A coord whose current value still equals its
   * baseline is treated as already saved, so opening a run never re-POSTs
   * loaded values as fresh proposals/decisions on mount.
   */
  baselineValues?: Record<string, unknown>;
}

export interface UseAutoSaveProposalsReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
  error: string | null;
  hasUnsavedChanges: boolean;
  /** Cancel any pending debounce and POST every dirty coord immediately. */
  saveNow: () => Promise<void>;
}

/**
 * Stages at which autosave is allowed to write.
 *
 *   - ``null`` / ``undefined`` — legacy QA single-user flow (writes
 *     ``human`` proposals); callers that omit ``stage`` keep their
 *     behaviour.
 *   - ``'proposal'`` — extraction PROPOSAL stage; the proposer (or AI)
 *     fills initial values as ``human`` proposals.
 *   - ``'review'`` — per-reviewer ``ReviewerDecision`` writes (see
 *     ``performSave``).
 *
 * Any other stage (``'consensus'``, ``'finalized'``, ``'pending'``, …) is
 * read-only or terminal for autosave: the backend rejects a proposal
 * write past PROPOSAL (HTTP 400 ``run stage is consensus, not in
 * ['proposal']``), which used to surface as a spurious "Error saving
 * data automatically" toast the moment a consolidated run was opened.
 */
const WRITABLE_STAGES = new Set(['proposal', 'review']);
function isWritableStage(stage?: string | null): boolean {
  return stage == null || WRITABLE_STAGES.has(stage);
}

export function useAutoSaveProposals(
  props: UseAutoSaveProposalsProps,
): UseAutoSaveProposalsReturn {
  const { runId, values, enabled = true, debounceMs = 600, stage, baselineValues } =
    props;

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror the latest props so lifecycle handlers (pagehide,
  // unmount cleanup) read fresh values without closing over a stale
  // render snapshot. Written in an effect (refs must not be written
  // during render) — declared before the effects below so they always
  // read the current commit's values.
  const valuesRef = useRef(values);
  const runIdRef = useRef(runId);
  const enabledRef = useRef(enabled);
  const stageRef = useRef(stage);
  // Server-persisted baseline (see prop docs). Mirrored in a ref so the
  // diff sees the latest hydrated map without re-creating callbacks.
  const baselineRef = useRef<Record<string, unknown>>(baselineValues ?? {});
  useEffect(() => {
    valuesRef.current = values;
    runIdRef.current = runId;
    enabledRef.current = enabled;
    stageRef.current = stage;
    baselineRef.current = baselineValues ?? {};
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Stringified last successful write per `${instanceId}_${fieldId}` —
  // the diff check against the current values map. The ref is the live
  // map updated per write; the state mirror below lets render-phase
  // consumers (dirty badge, hasUnsavedChanges) recompute without
  // reading a ref during render.
  const lastSavedByKeyRef = useRef<Record<string, string>>({});
  const [lastSavedByKey, setLastSavedByKey] = useState<Record<string, string>>({});
  // React state is async, so ``saveState === 'saving'`` cannot be used
  // as a synchronous lock across overlapping ``performSave`` invocations.
  const activeSavePromiseRef = useRef<Promise<void> | null>(null);

  const computeDirtyEntries = useCallback(
    (): Array<[string, unknown]> =>
      selectDirtyEntries(
        valuesRef.current,
        lastSavedByKeyRef.current,
        baselineRef.current,
      ),
    [],
  );

  const performSave = useCallback((): Promise<void> => {
    // Serialize concurrent saves: wait for any in-flight batch, swallowing
    // its error (the owner invocation surfaces it; queued calls still retry
    // dirty values that weren't acknowledged).
    const waitForActive = activeSavePromiseRef.current
      ? activeSavePromiseRef.current.catch(() => undefined)
      : Promise.resolve();

    const savePromise: Promise<void> = waitForActive.then(() => {
      const currentRunId = runIdRef.current;
      // Skip when there's no run, autosave is disabled, or the run stage
      // does not accept writes (consensus/finalized/pending). The stage
      // guard here also protects the flush paths (unmount, pagehide,
      // visibilitychange) so a consolidated run never fires a doomed POST.
      if (
        !currentRunId ||
        !enabledRef.current ||
        !isWritableStage(stageRef.current)
      )
        return;

      const dirty = computeDirtyEntries();
      if (dirty.length === 0) return;

      setSaveState('saving');
      setError(null);

      // ``Promise.allSettled`` so a single failed write does not abort
      // the others mid-flight; otherwise their ``lastSavedByKeyRef``
      // updates race the error path and leave the diff map inconsistent.
      const batchPromise = Promise.allSettled(
        dirty.map(([key, valueData]) => {
          const [instanceId, fieldId] = key.split('_');
          const {
            value: actualValue,
            unit,
            isOther,
          } = extractValueForSave(valueData);
          const writeValue = isOther
            ? actualValue
            : unit !== null && unit !== undefined
              ? { value: actualValue, unit }
              : actualValue;
          const normalized =
            writeValue === '' || writeValue === undefined ? null : writeValue;
          // Stage-aware write target (Layer 2 of the multi-reviewer
          // blind fix). ``stage='review'`` means every reviewer is
          // making per-user decisions on top of the same Run — the
          // write must be a ReviewerDecision so the run view's
          // reviewer-scoped read (``currentValues``) holds. Any other stage
          // (proposal, undefined) keeps writing ``human`` proposals,
          // preserving the QA publish flow and the extraction
          // PROPOSAL stage where one user (or AI) builds the initial
          // value set.
          const useDecisionEndpoint = stageRef.current === 'review';
          return writeRunFieldValue({
            runId: currentRunId,
            instanceId,
            fieldId,
            normalizedValue: normalized,
            useDecisionEndpoint,
          }).then(() => {
            lastSavedByKeyRef.current[key] = JSON.stringify(valueData ?? null);
          });
        }),
      ).then((results) => {
        // Mirror the diff map into state — partial successes updated the
        // ref even when some writes failed.
        setLastSavedByKey({ ...lastSavedByKeyRef.current });

        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failures.length > 0) {
          const first = failures[0].reason;
          const message =
            first instanceof Error ? first.message : String(first ?? 'unknown');
          throw new Error(message);
        }

        setLastSavedAt(new Date());
        setSaveState('saved');
      });

      return batchPromise.then(
        () => undefined,
        (err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : t('extraction', 'errors_autoSaveFailed');
          console.error('Auto-save error:', err);
          setError(message);
          setSaveState('error');
          toast.error(t('extraction', 'errors_autoSaveFailed'));
        },
      );
    }).finally(() => {
      if (activeSavePromiseRef.current === savePromise) {
        activeSavePromiseRef.current = null;
      }
    });

    activeSavePromiseRef.current = savePromise;
    return savePromise;
  }, [computeDirtyEntries]);

  // (1) Debounced save on values change. The cleanup clears the timer
  // when ``values`` changes so the next keystroke restarts the
  // countdown; the dedicated unmount-flush effect below handles the
  // route-change case.
  // The badge flips to 'dirty' as soon as a render sees newly-typed
  // entries — adjusted during render (the effect below only schedules the
  // debounce). Keyed by content, not identity: callers may rebuild the
  // values map every render, and an identity-keyed adjustment would
  // re-render forever.
  const valuesKey = useMemo(() => JSON.stringify(values), [values]);
  const [prevValuesKey, setPrevValuesKey] = useState(valuesKey);
  if (valuesKey !== prevValuesKey) {
    setPrevValuesKey(valuesKey);
    if (
      enabled &&
      runId &&
      isWritableStage(stage) &&
      selectDirtyEntries(values, lastSavedByKey, baselineValues ?? {}).length > 0
    ) {
      setSaveState('dirty');
    }
  }

  useEffect(() => {
    if (!enabled || !runId || !isWritableStage(stage)) return;

    const dirty = computeDirtyEntries();
    if (dirty.length === 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void performSave();
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    values,
    enabled,
    runId,
    stage,
    debounceMs,
    performSave,
    computeDirtyEntries,
  ]);

  // (2) Flush pending edits on UNMOUNT. Separate effect with stable
  // deps so the cleanup only fires when the component truly unmounts —
  // not on every ``values`` change. React doesn't await async cleanups,
  // but ``keepalive: true`` on the POST(s) lets the browser carry the
  // request through the route change / page unload.
  useEffect(() => {
    return () => {
      void performSave();
    };
  }, [performSave]);

  // (3) Survive tab close + mobile background. ``pagehide`` is the
  // cross-platform unload signal; ``beforeunload`` is unreliable on
  // iOS Safari and bfcache-eligible pages. ``visibilitychange`` -> hidden
  // catches the "user switched tabs" case before any unload event.
  useEffect(() => {
    const flush = () => {
      void performSave();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [performSave]);

  const saveNow = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    await performSave();
  }, [performSave]);

  // Re-evaluate the dirty diff whenever ``values`` changes (user typed)
  // or a save acknowledges (``lastSavedByKey`` advances). Computed from
  // render-safe state — never from the mutable refs.
  const hasUnsavedChanges = useMemo(
    () => selectDirtyEntries(values, lastSavedByKey, baselineValues ?? {}).length > 0,
    [values, lastSavedByKey, baselineValues],
  );

  return { saveState, lastSavedAt, error, hasUnsavedChanges, saveNow };
}
