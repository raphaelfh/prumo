/**
 * Hook to load, update and persist project settings.
 * Extracts data logic from ProjectSettings to keep the component focused on layout.
 */

import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {Project} from '@/types/project';
import {loadProjectForSettings, saveProjectSettings} from '@/services/projectSettingsService';

export function useProjectSettings(projectId: string) {
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const loadProject = async () => {
        if (!projectId) return;
        setLoading(true);
        const result = await loadProjectForSettings(projectId);
        setLoading(false);
        if (!result.ok) {
            console.error('Error loading project:', result.error);
            toast.error(t('common', 'errors_loadProject'));
            return;
        }
        setProject(result.data);
        setHasUnsavedChanges(false);
    };

    useEffect(() => {
        // Microtask so the loader's setState calls run in an async callback.
        queueMicrotask(() => void loadProject());
    }, [loadProject]);

    const updateProject = (updates: Partial<Project>) => {
        setProject((prev) => (prev ? {...prev, ...updates} : null));
        setHasUnsavedChanges(true);
    };

    const saveProject = async () => {
        if (!project) return;

        setLoading(true);
        const result = await saveProjectSettings(projectId, {
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
        });
        setLoading(false);
        if (!result.ok) {
            console.error('Error updating project:', result.error);
            toast.error(t('project', 'settingsSaveError'));
            return;
        }
        toast.success(t('project', 'settingsSaveSuccess'));
        setHasUnsavedChanges(false);
        await loadProject();
    };

    return {
        project,
        loading,
        hasUnsavedChanges,
        updateProject,
        saveProject,
        loadProject,
    };
}
