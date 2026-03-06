/**
 * Hook to get the user's role in the project (project_members).
 * Used to condition UI (e.g. show Configuration tab only for managers).
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import type {ProjectMemberRole} from '@/types/extraction';

export interface UseProjectMemberRoleReturn {
    role: ProjectMemberRole | null;
    isManager: boolean;
    loading: boolean;
}

export function useProjectMemberRole(projectId: string): UseProjectMemberRoleReturn {
    const {user} = useAuth();
    const [role, setRole] = useState<ProjectMemberRole | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!projectId || !user) {
            setRole(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const {data, error} = await supabase
                .from('project_members')
                .select('role')
                .eq('project_id', projectId)
                .eq('user_id', user.id)
                .single();

            if (error) {
                setRole(null);
                return;
            }
            const r = data?.role as ProjectMemberRole | null;
            setRole(r ?? null);
        } catch {
            setRole(null);
        } finally {
            setLoading(false);
        }
    }, [projectId, user?.id]);

    useEffect(() => {
        load();
    }, [load]);

    return {
        role,
        isManager: role === 'manager',
        loading,
    };
}
