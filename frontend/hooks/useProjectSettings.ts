/**
 * Hook to load, update and persist project settings.
 * Extracts data logic from ProjectSettings to keep the component focused on layout.
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {Project} from '@/types/project';

export function useProjectSettings(projectId: string) {
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const loadProject = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        try {
            const {data, error} = await supabase
                .from('projects')
                .select('*')
                .eq('id', projectId)
                .single();

            if (error) throw error;
            setProject(data as Project);
            setHasUnsavedChanges(false);
        } catch (err: unknown) {
            console.error('Error loading project:', err);
            toast.error(t('common', 'errors_loadProject'));
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        loadProject();
    }, [loadProject]);

    const updateProject = useCallback((updates: Partial<Project>) => {
        setProject((prev) => (prev ? {...prev, ...updates} : null));
        setHasUnsavedChanges(true);
    }, []);

    const saveProject = useCallback(async () => {
        if (!project) return;

        setLoading(true);
        try {
            const {error} = await supabase
                .from('projects')
                .update({
                    name: project.name,
                    description: project.description,
                    review_type: project.review_type,
                    review_title: project.review_title,
                    condition_studied: project.condition_studied,
                    review_rationale: project.review_rationale,
                    search_strategy: project.search_strategy,
                    picots_config_ai_review: project.picots_config_ai_review,
                    settings: project.settings,
                    eligibility_criteria: project.eligibility_criteria,
                    study_design: project.study_design,
                    review_keywords: project.review_keywords,
                    review_context: project.review_context,
                })
                .eq('id', projectId);

            if (error) throw error;

            toast.success(t('project', 'settingsSaveSuccess'));
            setHasUnsavedChanges(false);
            await loadProject();
        } catch (err: unknown) {
            console.error('Error updating project:', err);
            toast.error(t('project', 'settingsSaveError'));
        } finally {
            setLoading(false);
        }
    }, [project, projectId, loadProject]);

    return {
        project,
        loading,
        hasUnsavedChanges,
        updateProject,
        saveProject,
        loadProject,
    };
}
