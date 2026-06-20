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

import {useEffect, useState} from 'react';
import {loadComparisonPermissions} from '@/services/projectSettingsService';
import {type PermissionRules, type ReviewKind, type UserRole} from '@/lib/comparison/permissions';
import {t} from '@/lib/copy';

/**
 * Full permission state
 */
export interface ComparisonPermissions extends PermissionRules {
  userRole: UserRole;
  isBlindMode: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to load and manage comparison permissions
 *
 * Runs 2 optimized queries:
 * 1. Fetch member role in project
 * 2. Fetch the per-kind manager-visibility setting
 *    (`projects.settings.managers_see_reviewers[kind]`)
 *
 * @param projectId - Project ID
 * @param userId - User ID
 * @param kind - `extraction` | `quality_assessment` (the policy is per-kind)
 * @returns Full permissions with loading state
 *
 * @example
 * const permissions = useComparisonPermissions(projectId, userId, 'extraction');
 *
 * if (permissions.loading) return <Loader />;
 * if (!permissions.canSeeOthers) return null;
 *
 * return <ComparisonView ... />;
 */
export function useComparisonPermissions(
  projectId: string,
  userId: string,
  kind: ReviewKind
): ComparisonPermissions {
  const [permissions, setPermissions] = useState<Omit<ComparisonPermissions, 'refresh'>>({
    userRole: 'reviewer',
    isBlindMode: false,
    canSeeOthers: false,
    canResolveConflicts: false,
    canManageBlindMode: false,
    canExport: false,
    canEditTemplate: false,
    // Only show the loader when there is actually something to load.
    loading: Boolean(projectId && userId),
    error: null
  });

  // Params cleared after mount: stop the loader (during render, not via effect).
  const [prevKey, setPrevKey] = useState({ projectId, userId, kind });
  if (prevKey.projectId !== projectId || prevKey.userId !== userId || prevKey.kind !== kind) {
    setPrevKey({ projectId, userId, kind });
    if (!projectId || !userId) {
      setPermissions(prev => ({ ...prev, loading: false }));
    }
  }

  const fetchPermissions = async () => {
    setPermissions(prev => ({ ...prev, loading: true, error: null }));

    const result = await loadComparisonPermissions(projectId, userId, kind);

    if (result.ok) {
      setPermissions({
        userRole: result.data.userRole,
        isBlindMode: result.data.isBlindMode,
        ...result.data.rules,
        loading: false,
        error: null,
      });
    } else {
      console.error('Error loading comparison permissions:', result.error);
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
        error: result.error.message || t('common', 'errors_loadPermissions'),
      });
    }
  };

  useEffect(() => {
    if (!projectId || !userId) {
      return;
    }
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void fetchPermissions());
  }, [projectId, userId, kind, fetchPermissions]);

  // Return refresh function to reload permissions
  return {
    ...permissions,
    refresh: fetchPermissions,
  };
}
