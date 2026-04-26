/**
 * Unified comparison permissions hook
 *
 * Centralizes all permission logic for comparing
 * extractions/assessments across users.
 *
 * Used in ExtractionFullScreen and other comparison-enabled screens.
 *
 * Eliminates code duplication and ensures consistency.
 *
 * @hook
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {getRolePermissions, isValidUserRole, type PermissionRules, type UserRole} from '@/lib/comparison/permissions';
import {t} from '@/lib/copy';

/**
 * Full permission state
 */
export interface ComparisonPermissions extends PermissionRules {
  userRole: UserRole;
  isBlindMode: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to load and manage comparison permissions
 *
 * Runs 2 optimized queries:
 * 1. Fetch member role in project
 * 2. Fetch blind_mode project config
 *
 * @param projectId - Project ID
 * @param userId - User ID
 * @returns Full permissions with loading state
 * 
 * @example
 * const permissions = useComparisonPermissions(projectId, userId);
 * 
 * if (permissions.loading) return <Loader />;
 * if (!permissions.canSeeOthers) return null;
 * 
 * return <ComparisonView ... />;
 */
export function useComparisonPermissions(
  projectId: string,
  userId: string
): ComparisonPermissions {
  const [permissions, setPermissions] = useState<ComparisonPermissions>({
    userRole: 'reviewer',
    isBlindMode: false,
    canSeeOthers: false,
    canResolveConflicts: false,
    canManageBlindMode: false,
    canExport: false,
    canEditTemplate: false,
    loading: true,
    error: null
  });

  const loadPermissions = useCallback(async () => {
    try {
      setPermissions(prev => ({ ...prev, loading: true, error: null }));

        // Query 1: Fetch member role
      const { data: member, error: memberError } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (memberError) throw memberError;

      if (!member) {
          throw new Error(t('common', 'errors_userNotProjectMember'));
      }

        // Query 2: Fetch project config
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('settings')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

        // Validate role
      const role = member.role;
      if (!isValidUserRole(role)) {
          throw new Error(`${t('common', 'errors_invalidRole')}: ${role}`);
      }

        // Extract blind_mode (with safe fallback)
      const isBlindMode = project?.settings?.blind_mode === true;

        // Compute permissions using centralized rules
      const rolePermissions = getRolePermissions(role, isBlindMode);

      setPermissions({
        userRole: role,
        isBlindMode,
        ...rolePermissions,
        loading: false,
        error: null
      });

    } catch (err: any) {
        console.error('Error loading comparison permissions:', err);

        // Error state: assume minimum permissions (safe)
      setPermissions({
        userRole: 'reviewer',
          isBlindMode: true, // Assume blind mode on error (safer)
        canSeeOthers: false,
        canResolveConflicts: false,
        canManageBlindMode: false,
        canExport: false,
        canEditTemplate: false,
        loading: false,
          error: err.message || t('common', 'errors_loadPermissions')
      });
    }
  }, [projectId, userId]);

  useEffect(() => {
    if (!projectId || !userId) {
      setPermissions(prev => ({ ...prev, loading: false }));
      return;
    }

    loadPermissions();
  }, [projectId, userId, loadPermissions]);

    // Return refresh function to reload permissions
  return {
    ...permissions,
    refresh: loadPermissions
  } as ComparisonPermissions & { refresh: () => Promise<void> };
}

