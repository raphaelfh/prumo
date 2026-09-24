/**
 * Hook to load, update and persist project settings.
 * Extracts data logic from ProjectSettings to keep the component focused on layout.
 *
 * The save is `PATCH /projects/{id}/details` with an optimistic precondition:
 * only the changed keys travel, each with the value the page loaded as
 * `expected`. When another writer (a teammate, an AI agent) moved one of them,
 * the server answers 409 STALE_VALUE and the hook exposes the contested keys
 * as `staleFields` for the page's banner: `loadLatest` takes the server value
 * for those keys and keeps every other edit; `keepMine` re-sends the edit
 * against the server's current values.
 */

import {useEffect, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {projectKeys} from '@/lib/query-keys';
import {useAuth} from '@/contexts/AuthContext';
import {projectsListKey} from '@/hooks/useProjectsQuery';
import type {Project} from '@/types/project';
import {
    loadProjectForSettings,
    saveProjectSettings,
    staleValuesOf,
    toDetailsFields,
} from '@/services/projectSettingsService';

/** The 11 columns PATCH /projects/{id}/details writes (backend ProjectDetailsFields). */
const DETAIL_KEYS = [
    'name',
    'description',
    'review_type',
    'review_title',
    'condition_studied',
    'review_rationale',
    'search_strategy',
    'eligibility_criteria',
    'study_design',
    'review_keywords',
    'review_context',
] as const;
type DetailKey = (typeof DETAIL_KEYS)[number];

const changedKeys = (edited: Project, loaded: Project): DetailKey[] =>
    DETAIL_KEYS.filter((key) => JSON.stringify(edited[key]) !== JSON.stringify(loaded[key]));

const pick = (row: Project, keys: readonly DetailKey[]): Partial<Project> =>
    Object.fromEntries(keys.map((key) => [key, row[key]]));

export function useProjectSettings(projectId: string) {
    const queryClient = useQueryClient();
    const {user} = useAuth();
    const [project, setProject] = useState<Project | null>(null);
    /** The last server snapshot: the `expected` side of the next save. */
    const [loadedProject, setLoadedProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [staleFields, setStaleFields] = useState<string[]>([]);
    const [staleCurrent, setStaleCurrent] = useState<Partial<Project>>({});

    const clearStale = () => {
        setStaleFields([]);
        setStaleCurrent({});
    };

    const fetchProject = async (): Promise<Project | null> => {
        if (!projectId) return null;
        setLoading(true);
        const result = await loadProjectForSettings(projectId);
        setLoading(false);
        if (!result.ok) {
            console.error('Error loading project:', result.error);
            toast.error(t('common', 'errors_loadProject'));
            return null;
        }
        return result.data;
    };

    const loadProject = async () => {
        const fresh = await fetchProject();
        if (!fresh) return;
        setProject(fresh);
        setLoadedProject(fresh);
        setHasUnsavedChanges(false);
        clearStale();
    };

    useEffect(() => {
        // Microtask so the loader's setState calls run in an async callback.
        queueMicrotask(() => void loadProject());
    }, [loadProject]);

    const updateProject = (updates: Partial<Project>) => {
        setProject((prev) => (prev ? {...prev, ...updates} : null));
        setHasUnsavedChanges(true);
    };

    const persist = async (edited: Project, snapshot: Project) => {
        const keys = changedKeys(edited, snapshot);
        if (keys.length === 0) {
            setHasUnsavedChanges(false);
            return;
        }
        const fields = toDetailsFields(pick(edited, keys));
        const expected = toDetailsFields(pick(snapshot, keys));
        if (!fields || !expected) {
            toast.error(t('project', 'settingsSaveError'));
            return;
        }

        setLoading(true);
        const result = await saveProjectSettings(projectId, {fields, expected});
        setLoading(false);
        if (!result.ok) {
            const current = staleValuesOf(result.error);
            if (current) {
                setStaleFields(Object.keys(current));
                setStaleCurrent(current as Partial<Project>);
                return;
            }
            console.error('Error updating project:', result.error);
            toast.error(t('project', 'settingsSaveError'));
            return;
        }
        toast.success(t('project', 'settingsSaveSuccess'));
        void queryClient.invalidateQueries({queryKey: projectKeys.aiContext(projectId)});
        if (user?.id) void queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
        await loadProject();
    };

    const saveProject = async () => {
        if (!project || !loadedProject) return;
        await persist(project, loadedProject);
    };

    /** Overwrite the contested fields with this page's values. */
    const keepMine = async () => {
        if (!project || !loadedProject) return;
        const snapshot = {...loadedProject, ...staleCurrent};
        setLoadedProject(snapshot);
        clearStale();
        await persist(project, snapshot);
    };

    /** Take the server's values for the contested fields; keep every other edit. */
    const loadLatest = async () => {
        if (!project || !loadedProject) return;
        const fresh = await fetchProject();
        if (!fresh) return;
        const kept = changedKeys(project, loadedProject).filter((key) => !staleFields.includes(key));
        setProject({...fresh, ...pick(project, kept)});
        setLoadedProject(fresh);
        setHasUnsavedChanges(kept.length > 0);
        clearStale();
    };

    return {
        project,
        loading,
        hasUnsavedChanges,
        updateProject,
        saveProject,
        loadProject,
        staleFields,
        loadLatest,
        keepMine,
    };
}
