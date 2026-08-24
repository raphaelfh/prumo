/**
 * Auto-save user edits on the active Run, with a proper state machine and
 * lifecycle handlers that survive route changes, tab closes, and visibility
 * switches. One write target (D8): every write is a per-reviewer ``edit``
 * decision on ``/runs/{id}/decisions`` (optionally carrying the D0 AI link),
 * for extraction AND quality-assessment runs alike, and only in the editable
 * ``extract`` stage. The old human ``/proposals`` write path is gone — that
 * endpoint remains for AI/system writers only.
 *
 * Used by both Data Extraction and Quality Assessment full-screen
 * pages — anywhere a flat ``Record<`${instanceId}_${fieldId}`, value>``
 * map needs to be persisted on a Run.
 *
 * State machine:
 *   - ``idle``    nothing dirty, no save in flight
 *   - ``dirty``   user typed (or adopted an AI version); debounce armed
 *   - ``saving``  POST(s) in flight to /decisions
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
 * Diff-aware: only coords whose [value, AI-link] fingerprint changed since
 * the last successful save (or the hydrated baseline) are written, so the
 * append-only tables don't accumulate one duplicate row per debounce tick.
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

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { writeRunFieldValue } from '@/services/extractionRunService';
import { t } from '@/lib/copy';
import { extractValueForSave } from '@/lib/validations/selectOther';
import { fingerprintCoord, selectDirtyEntries } from '@/lib/extraction/autosaveDirty';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveProposalsProps {
  runId: string | null | undefined;
  values: Record<string, unknown>;
  enabled?: boolean;
  /** Debounce delay in ms (default 600). */
  debounceMs?: number;
  /**
   * Active run stage. Autosave writes only in the editable ``'extract'``
   * stage (see ``isWritableStage``); every other value — including
   * ``undefined`` — is inert. Both screens pass the run's live stage.
   */
  stage?: string | null;
  /**
   * Server-persisted values per ``${instanceId}_${fieldId}`` (the map the
   * form hydrated from). A coord whose current value still equals its
   * baseline is treated as already saved, so opening a run never re-POSTs
   * loaded values as fresh proposals/decisions on mount.
   */
  baselineValues?: Record<string, unknown>;
  /**
   * D0 (consensus AI trace): coord key (`${instanceId}_${fieldId}`) →
   * accepted/selected AI proposal id. When a dirty coord has an entry, its
   * `edit` decision carries `proposal_record_id` so the AI basis survives
   * into the append-only audit trail. Later manual edits keep the link — the
   * consensus chip renders "Edited by" when the value differs, so honesty
   * lives in the read path. Only consulted on the /decisions branch.
   */
  linkByKey?: Record<string, string>;
  /**
   * D0: the PERSISTED link state the form hydrated from (layer-1 of
   * `deriveAiLinkByKey`, i.e. session events excluded) — the link-side
   * counterpart of ``baselineValues``. A coord whose value AND link both
   * equal their baselines is clean on mount; a session adoption that only
   * changes the link (same value) still dirties the coord so the human
   * selection event is recorded.
   */
  baselineLinkByKey?: Record<string, string>;
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
 * ``'extract'`` is the single stage at which autosave writes — the backend
 * rejects a decision write past it (HTTP 400 ``run stage is consensus, not
 * in ['extract']``), which used to surface as a spurious "Error saving data
 * automatically" toast the moment a consolidated run was opened. A
 * ``null``/``undefined`` stage is inert too (D8): the pre-D8 legacy QA flow
 * that omitted ``stage`` to reach the human /proposals fallback is gone.
 * One predicate shared by the dirty badge, the debounce, and the write path.
 */
function isWritableStage(stage?: string | null): boolean {
  return stage === 'extract';
}

export function useAutoSaveProposals(
  props: UseAutoSaveProposalsProps,
): UseAutoSaveProposalsReturn {
  const { runId, values, enabled = true, debounceMs = 600, stage, baselineValues, linkByKey, baselineLinkByKey } =
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
  const linkByKeyRef = useRef<Record<string, string>>(linkByKey ?? {});
  const baselineLinkRef = useRef<Record<string, string>>(baselineLinkByKey ?? {});
  useEffect(() => {
    valuesRef.current = values;
    runIdRef.current = runId;
    enabledRef.current = enabled;
    stageRef.current = stage;
    baselineRef.current = baselineValues ?? {};
    linkByKeyRef.current = linkByKey ?? {};
    baselineLinkRef.current = baselineLinkByKey ?? {};
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
  const activeSavePromiseRef = useRef<Promise<boolean> | null>(null);

  // An acknowledgment is a statement about ONE run, but the coord key it is
  // filed under is not: ``extraction_instances`` has no ``run_id`` (its scope
  // is (article_id, template_id)), and ``POST /runs/{id}/reopen`` forks a
  // child run seeded from the parent's published states — carrying the
  // parent's ``instance_id`` verbatim. Both full-screen pages then swap
  // ``activeRunId`` in place via ``sessionResult.refetch()`` rather than
  // remounting, so without this reset a value re-entered identically to one
  // saved on the parent run fingerprint-matches and never reaches the child.
  // That is the same silent-drop class the ``autosaveDirty`` docstring
  // describes for a stale baseline, on the run axis: consensus publishes the
  // other reviewer's value, the reviewer re-asserts theirs on the revision,
  // and the write is skipped with a clean badge and no error.
  //
  // The reset swaps in a FRESH object instead of emptying this one. Effect
  // cleanups all run before any setup, so the run-keyed flush below has
  // already CAPTURED the outgoing map by identity — it keeps diffing and
  // acknowledging against the run it was invoked for, and never re-POSTs
  // coords that run already acknowledged.
  const lastSavedRunIdRef = useRef(runId);
  useEffect(() => {
    if (lastSavedRunIdRef.current === runId) return;
    lastSavedRunIdRef.current = runId;
    lastSavedByKeyRef.current = {};
    setLastSavedByKey({});
  }, [runId]);

  const computeDirtyEntries = (): Array<[string, unknown]> =>
    selectDirtyEntries(
      valuesRef.current,
      lastSavedByKeyRef.current,
      baselineRef.current,
      linkByKeyRef.current,
      baselineLinkRef.current,
    );

  const performSave = (): Promise<boolean> => {
    // Capture the save context SYNCHRONOUSLY at invocation. The run-switch
    // flush below runs in an effect cleanup; by the time the deferred
    // microtask executes, the ref-sync effect has already re-pointed the
    // refs at the NEW run, so reading them lazily would drop the old run's
    // pending edit (or worse, POST it against the new run). The dirty diff
    // itself is still computed after any in-flight batch settles, against
    // the acknowledgment map captured here BY IDENTITY: saves within one run
    // share that object, so a queued save still sees what the in-flight batch
    // acknowledged and never re-writes those coords, while the run-change
    // reset above swaps in a fresh object that this invocation cannot see.
    const currentRunId = runIdRef.current;
    const currentEnabled = enabledRef.current;
    const currentStage = stageRef.current;
    const currentValues = valuesRef.current;
    const currentBaseline = baselineRef.current;
    const currentLinkByKey = linkByKeyRef.current;
    const currentBaselineLink = baselineLinkRef.current;
    const currentLastSaved = lastSavedByKeyRef.current;

    // Serialize concurrent saves: wait for any in-flight batch, swallowing
    // its error (the owner invocation surfaces it; queued calls still retry
    // dirty values that weren't acknowledged).
    const waitForActive = activeSavePromiseRef.current
      ? activeSavePromiseRef.current.catch(() => undefined)
      : Promise.resolve();

    const savePromise: Promise<boolean> = waitForActive.then(() => {
      // Skip when there's no run, autosave is disabled, or the run stage
      // does not accept writes (consensus/finalized/pending). The stage
      // guard here also protects the flush paths (unmount, pagehide,
      // visibilitychange) so a consolidated run never fires a doomed POST.
      if (
        !currentRunId ||
        !currentEnabled ||
        !isWritableStage(currentStage)
      )
        return true;

      const dirty = selectDirtyEntries(
        currentValues,
        currentLastSaved,
        currentBaseline,
        currentLinkByKey,
        currentBaselineLink,
      );
      if (dirty.length === 0) return true;

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
            absentReason,
          } = extractValueForSave(valueData);
          const writeValue = isOther
            ? actualValue
            : unit !== null && unit !== undefined
              ? { value: actualValue, unit }
              : actualValue;
          const normalized =
            writeValue === '' || writeValue === undefined ? null : writeValue;
          // One write path (D8): a per-reviewer ``edit`` decision, for both
          // run kinds — the run view's reviewer-scoped read
          // (``current_values``) holds on extraction AND QA. The stage gate
          // lives in ``isWritableStage`` above.
          return writeRunFieldValue({
            runId: currentRunId,
            instanceId,
            fieldId,
            normalizedValue: normalized,
            absentReason,
            proposalRecordId: currentLinkByKey[key] ?? null,
          }).then(() => {
            // Acknowledge value AND link together (the D0 fingerprint) so a
            // later link-only adoption re-dirties the coord. Written to the
            // CAPTURED map, so a write that lands after a run switch records
            // against the run it addressed instead of vouching for a coord
            // the new run has never been told about.
            currentLastSaved[key] = fingerprintCoord(
              valueData,
              currentLinkByKey[key],
            );
          });
        }),
      ).then((results) => {
        // Mirror the diff map into state — partial successes updated the
        // ref even when some writes failed.
        setLastSavedByKey({ ...lastSavedByKeyRef.current });

        // Any acknowledged write moved the server, so the save clock advances
        // even when a sibling failed: server-DERIVED reads key off it (the QA
        // overall banner via useRefetchOnSave), and parking it on a partial
        // failure meant a domain judgment that reached the server never showed
        // up in the computed overall. The error surface is untouched —
        // SaveStatusBadge returns on `saveState === 'error'` before it reads
        // the timestamp.
        if (results.some((r) => r.status === 'fulfilled')) setLastSavedAt(new Date());

        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failures.length > 0) {
          const first = failures[0].reason;
          const message =
            first instanceof Error ? first.message : String(first ?? 'unknown');
          throw new Error(message);
        }

        setSaveState('saved');
      });

      return batchPromise.then(
        () => true,
        (err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : t('extraction', 'errors_autoSaveFailed');
          console.error('Auto-save error:', err);
          setError(message);
          setSaveState('error');
          toast.error(t('extraction', 'errors_autoSaveFailed'));
          // Resolve to `false` (not reject) so fire-and-forget callers
          // (debounce / unmount / pagehide) never raise an unhandled
          // rejection; `saveNow` reads this flag and rejects for callers that
          // gate a run-stage advance on a successful flush.
          return false;
        },
      );
    }).finally(() => {
      if (activeSavePromiseRef.current === savePromise) {
        activeSavePromiseRef.current = null;
      }
    });

    activeSavePromiseRef.current = savePromise;
    return savePromise;
  };

  // (1) Debounced save on values change. The cleanup clears the timer
  // when ``values`` changes so the next keystroke restarts the
  // countdown; the dedicated unmount-flush effect below handles the
  // route-change case.
  // The badge flips to 'dirty' as soon as a render sees newly-typed
  // entries — adjusted during render (the effect below only schedules the
  // debounce). Keyed by content, not identity: callers may rebuild the
  // values map every render, and an identity-keyed adjustment would
  // re-render forever.
  // The content key includes the link map (D0): a link-only adoption on an
  // unchanged value must flip the badge and schedule a save like a keystroke.
  const valuesKey = JSON.stringify([values, linkByKey ?? {}]);
  const [prevValuesKey, setPrevValuesKey] = useState(valuesKey);
  if (valuesKey !== prevValuesKey) {
    setPrevValuesKey(valuesKey);
    if (
      enabled &&
      runId &&
      isWritableStage(stage) &&
      selectDirtyEntries(
        values,
        lastSavedByKey,
        baselineValues ?? {},
        linkByKey ?? {},
        baselineLinkByKey ?? {},
      ).length > 0
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
    linkByKey,
    baselineLinkByKey,
    enabled,
    runId,
    stage,
    debounceMs,
    performSave,
    computeDirtyEntries,
  ]);

  // (2) Flush pending edits on UNMOUNT and on an IN-PLACE RUN SWITCH.
  // The article pagers (#657/#671) navigate without unmounting this
  // hook's owner, so an unmount-only flush dropped the armed debounce's
  // edit. ``runId`` in the deps makes the cleanup fire on both paths;
  // the cleanup runs before the ref-sync effect above re-runs, so the
  // flush still reads the OLD run's id, values, stage and baselines
  // from the refs by construction. React doesn't await async cleanups,
  // but ``keepalive: true`` on the POST(s) lets the browser carry the
  // request through the route change / page unload.
  useEffect(() => {
    return () => {
      void performSave();
    };
  }, [performSave, runId]);

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

  const saveNow = async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    const ok = await performSave();
    if (!ok) {
      // Reject so callers that gate a run-stage advance on a successful flush
      // (onMarkReady / onOpenConsensus `.catch(() => false)`) actually block
      // instead of advancing past unsaved edits.
      throw new Error('autosave failed');
    }
  };

  // Re-evaluate the dirty diff whenever ``values`` changes (user typed)
  // or a save acknowledges (``lastSavedByKey`` advances). Computed from
  // render-safe state — never from the mutable refs.
  const hasUnsavedChanges =
    selectDirtyEntries(
      values,
      lastSavedByKey,
      baselineValues ?? {},
      linkByKey ?? {},
      baselineLinkByKey ?? {},
    ).length > 0;

  return { saveState, lastSavedAt, error, hasUnsavedChanges, saveNow };
}
