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

import { apiClient } from '@/integrations/api';
import { t } from '@/lib/copy';
import { extractValueForSave } from '@/lib/validations/selectOther';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveProposalsProps {
  runId: string | null | undefined;
  values: Record<string, unknown>;
  enabled?: boolean;
  /** Debounce delay in ms (default 600). */
  debounceMs?: number;
}

export interface UseAutoSaveProposalsReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
  error: string | null;
  hasUnsavedChanges: boolean;
  /** Cancel any pending debounce and POST every dirty coord immediately. */
  saveNow: () => Promise<void>;
}

export function useAutoSaveProposals(
  props: UseAutoSaveProposalsProps,
): UseAutoSaveProposalsReturn {
  const { runId, values, enabled = true, debounceMs = 600 } = props;

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror the latest props so lifecycle handlers (pagehide,
  // unmount cleanup) read fresh values without closing over a stale
  // render snapshot.
  const valuesRef = useRef(values);
  const runIdRef = useRef(runId);
  const enabledRef = useRef(enabled);
  valuesRef.current = values;
  runIdRef.current = runId;
  enabledRef.current = enabled;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  // Stringified last successful write per `${instanceId}_${fieldId}` —
  // the diff check against the current values map.
  const lastSavedByKeyRef = useRef<Record<string, string>>({});
  // React state is async, so ``saveState === 'saving'`` cannot be used
  // as a synchronous lock across overlapping ``performSave`` invocations.
  const activeSavePromiseRef = useRef<Promise<void> | null>(null);

  const computeDirtyEntries = useCallback((): Array<[string, unknown]> => {
    const dirty: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(valuesRef.current)) {
      // Skip ``undefined`` (field never touched) but treat ``null`` /
      // ``''`` as deliberate clears — they must be persisted as
      // ``{ value: null }`` proposals so reloads don't resurrect the
      // previous value.
      if (value === undefined) continue;
      const stringified = JSON.stringify(value ?? null);
      if (lastSavedByKeyRef.current[key] === stringified) continue;
      dirty.push([key, value]);
    }
    return dirty;
  }, []);

  const performSave = useCallback(async (): Promise<void> => {
    while (activeSavePromiseRef.current) {
      try {
        await activeSavePromiseRef.current;
      } catch {
        // The owner call surfaces the error state/toast; queued calls can
        // still retry any dirty values that were not acknowledged.
      }
    }

    const currentRunId = runIdRef.current;
    if (!currentRunId || !enabledRef.current) return;

    const dirty = computeDirtyEntries();
    if (dirty.length === 0) return;

    setSaveState('saving');
    setError(null);

    const savePromise = (async () => {
      // ``Promise.allSettled`` so a single failed write does not abort
      // the others mid-flight; otherwise their ``lastSavedByKeyRef``
      // updates race the catch block and leave the diff map
      // inconsistent.
      const results = await Promise.allSettled(
        dirty.map(async ([key, valueData]) => {
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
          await apiClient(`/api/v1/runs/${currentRunId}/proposals`, {
            method: 'POST',
            body: {
              instance_id: instanceId,
              field_id: fieldId,
              source: 'human',
              proposed_value: { value: normalized },
            },
            // Keepalive lets the OS deliver the request even if the
            // page is in the process of unloading (route change, tab
            // close, mobile background). Capped at 64KB body — a single
            // proposal write is well under that.
            keepalive: true,
          });
          lastSavedByKeyRef.current[key] = JSON.stringify(valueData ?? null);
        }),
      );

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
    })();

    activeSavePromiseRef.current = savePromise;

    try {
      await savePromise;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('extraction', 'errors_autoSaveFailed');
      console.error('Auto-save error:', err);
      setError(message);
      setSaveState('error');
      toast.error(t('extraction', 'errors_autoSaveFailed'));
    } finally {
      if (activeSavePromiseRef.current === savePromise) {
        activeSavePromiseRef.current = null;
      }
    }
  }, [computeDirtyEntries]);

  // (1) Debounced save on values change. The cleanup clears the timer
  // when ``values`` changes so the next keystroke restarts the
  // countdown; the dedicated unmount-flush effect below handles the
  // route-change case.
  useEffect(() => {
    if (!enabled || !runId) return;

    const dirty = computeDirtyEntries();
    if (dirty.length === 0) return;

    setSaveState('dirty');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void performSave();
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [values, enabled, runId, debounceMs, performSave, computeDirtyEntries]);

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
  // or ``lastSavedAt`` advances (a save just acknowledged and updated
  // the ``lastSavedByKeyRef`` map). Reading the ref directly inside
  // ``useMemo`` is fine because those two triggers cover every state
  // transition that could flip the answer.
  const hasUnsavedChanges = useMemo(
    () => computeDirtyEntries().length > 0,
    [values, lastSavedAt, computeDirtyEntries],
  );

  return { saveState, lastSavedAt, error, hasUnsavedChanges, saveNow };
}
