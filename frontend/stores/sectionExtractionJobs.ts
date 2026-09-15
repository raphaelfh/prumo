import {create} from 'zustand';
import type {AsyncSectionExtractionParams} from '@/services/sectionExtractionService';

/** The user is part of the coordinate, never part of the extraction payload. */
export function sectionJobKey(params: AsyncSectionExtractionParams & {userId: string}): string {
  return JSON.stringify([
    params.userId, params.projectId, params.articleId, params.templateId,
    params.runId ?? null, params.entityTypeId ?? null, params.parentInstanceId ?? null,
  ]);
}

export interface SectionJobState {
  status: 'idle' | 'starting' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  requestId: string | null;
  jobId: string | null;
  error: {code: string | null; message: string} | null;
  uncertainTransport: boolean;
}

interface SectionJobRecord extends SectionJobState {
  params: AsyncSectionExtractionParams;
  userId: string;
  handled: boolean;
}

export const idleSectionJob: SectionJobState = {
  status: 'idle', requestId: null, jobId: null, error: null, uncertainTransport: false,
};

interface SectionJobsStore {
  ownerId: string | null;
  records: Record<string, SectionJobRecord>;
  adoptOwner: (ownerId: string | null) => void;
  begin: (userId: string, params: AsyncSectionExtractionParams) => SectionJobRecord | null;
  update: (key: string, requestId: string, patch: Partial<SectionJobState>) => boolean;
  claimTerminal: (key: string, requestId: string, patch: Partial<SectionJobState>) => boolean;
  clearProject: (userId: string, projectId: string) => void;
}

/** Session memory only: no persistence, query clients, callbacks or proposal data. */
export const useSectionExtractionJobs = create<SectionJobsStore>((set, get) => ({
  ownerId: null,
  records: {},
  adoptOwner: ownerId => {
    if (get().ownerId !== ownerId) set({ownerId, records: {}});
  },
  begin: (userId, params) => {
    if (get().ownerId !== userId) return null;
    const key = sectionJobKey({...params, userId});
    const previous = get().records[key];
    if (previous && ['starting', 'pending', 'running'].includes(previous.status)) return null;
    const record: SectionJobRecord = {
      ...idleSectionJob,
      // An uncertain retry replays the entire original payload, including flags.
      params: previous?.uncertainTransport ? previous.params : {...params},
      userId,
      requestId: previous?.uncertainTransport ? previous.requestId : crypto.randomUUID(),
      status: 'starting',
      handled: false,
    };
    set(state => ({records: {...state.records, [key]: record}}));
    return record;
  },
  update: (key, requestId, patch) => {
    const record = get().records[key];
    if (!record || record.requestId !== requestId || record.userId !== get().ownerId) return false;
    set(state => ({records: {...state.records, [key]: {...record, ...patch}}}));
    return true;
  },
  claimTerminal: (key, requestId, patch) => {
    const record = get().records[key];
    if (!record || record.handled || record.requestId !== requestId || record.userId !== get().ownerId) return false;
    set(state => ({records: {...state.records, [key]: {...record, ...patch, handled: true}}}));
    return true;
  },
  clearProject: (userId, projectId) => {
    set(state => ({records: Object.fromEntries(Object.entries(state.records).filter(
      ([, record]) => record.userId !== userId || record.params.projectId !== projectId,
    ))}));
  },
}));
