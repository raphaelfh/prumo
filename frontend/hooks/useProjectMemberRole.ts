/**
 * Hook to get the user's role in the project (project_members).
 * Used to condition UI (e.g. show Configuration tab only for managers).
 */

import {useEffect, useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import type {ProjectMemberRole} from '@/types/extraction';
import {getProjectMemberRole} from '@/services/projectSettingsService';

export interface UseProjectMemberRoleReturn {
    role: ProjectMemberRole | null;
    isManager: boolean;
    loading: boolean;
}

export function useProjectMemberRole(projectId: string): UseProjectMemberRoleReturn {
    const {user} = useAuth();
    const [role, setRole] = useState<ProjectMemberRole | null>(null);
    const [loading, setLoading] = useState(true);

    const userId = user?.id;
    const load = async () => {
        if (!projectId || !userId) {
            setRole(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        const result = await getProjectMemberRole(projectId, userId);
        setRole(result.ok ? result.data : null);
        setLoading(false);
    };

    useEffect(() => {
        // Microtask so the loader's setState calls run in an async callback.
        queueMicrotask(() => void load());
    }, [load]);

    return {
        role,
        isManager: role === 'manager',
        loading,
    };
}
