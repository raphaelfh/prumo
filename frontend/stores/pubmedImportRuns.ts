import {create} from 'zustand';

/**
 * The PubMed import a project is tracking: the dialog starts it, a tracker
 * mounted for the whole project view polls it. `settled` is set once the
 * finished run has refreshed the project, so a remount does not repeat that.
 */
interface TrackedImport {
  runId: string;
  settled: boolean;
}

interface PubmedImportRunsStore {
  runs: Record<string, TrackedImport>;
  track: (projectId: string, runId: string) => void;
  settle: (projectId: string, runId: string) => void;
  clear: (projectId: string) => void;
}

/** Session memory only: a reload drops the tracking, never the import itself. */
export const usePubmedImportRuns = create<PubmedImportRunsStore>((set) => ({
  runs: {},
  track: (projectId, runId) => set((state) => ({runs: {...state.runs, [projectId]: {runId, settled: false}}})),
  settle: (projectId, runId) =>
    set((state) =>
      state.runs[projectId]?.runId === runId ? {runs: {...state.runs, [projectId]: {runId, settled: true}}} : state,
    ),
  clear: (projectId) =>
    set((state) => {
      const runs = {...state.runs};
      delete runs[projectId];
      return {runs};
    }),
}));
