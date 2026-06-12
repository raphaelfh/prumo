// frontend/services/projectSettingsService.ts
/**
 * Project settings service — IO for project-level CRUD operations used in
 * the Settings page and comparison-permission checks.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase reads are relocated verbatim from hooks (no
 * new reads); the data-path consolidation owns the typed-client swap.
 */
import {supabase} from '@/integrations/supabase/client';
import {toResult, PgError, type ErrorResult} from '@/lib/error-utils';
import type {MemberRole} from '@/types/project';
import {getRolePermissions, isValidUserRole, type PermissionRules, type UserRole} from '@/lib/comparison/permissions';

// ---------------------------------------------------------------------------
// AdvancedSettingsSection: delete project
// ---------------------------------------------------------------------------

export interface DeleteProjectResult {
  /** True when at least one row was deleted (RLS returned data). */
  deleted: boolean;
}

/**
 * Delete a project by id. Returns {deleted: false} when RLS blocked the
 * delete (no rows returned) so the caller can surface the appropriate toast.
 *
 * NOTE: toast messages are handled by the caller (AdvancedSettingsSection).
 */
export function deleteProject(
  projectId: string,
): Promise<ErrorResult<DeleteProjectResult>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .select();
    if (error) throw error;
    return {deleted: Boolean(data && data.length > 0)};
  }, 'projectSettingsService.deleteProject');
}

// ---------------------------------------------------------------------------
// TeamMembersSection: member CRUD
// ---------------------------------------------------------------------------

export interface ProjectMemberRow {
  id: string;
  user_id: string;
  role: MemberRole;
  user_email: string | null;
  user_full_name: string | null;
  user_avatar_url: string | null;
}

/**
 * Load all members for a project via the get_project_members RPC.
 *
 * NOTE: toast messages are handled by the caller (TeamMembersSection).
 */
export function getProjectMembers(
  projectId: string,
): Promise<ErrorResult<ProjectMemberRow[]>> {
  return toResult(async () => {
    const {data, error} = await supabase.rpc('get_project_members', {
      p_project_id: projectId,
    });
    if (error) throw error;
    return (data as ProjectMemberRow[]) ?? [];
  }, 'projectSettingsService.getProjectMembers');
}

export interface FindUserResult {
  /** Resolved user id, or null when not found. */
  userId: string | null;
}

/**
 * Find a user id by email within a project context (uses find_user_id_by_email
 * RPC). Returns {userId: null} when the user does not exist. On RPC failure the
 * result is ok:false with a PgError carrying the pg error code — callers branch
 * on `instanceof PgError && .code === '42501'` to distinguish permission errors
 * from generic failures.
 *
 * NOTE: toast messages are handled by the caller (TeamMembersSection).
 */
export function findUserIdByEmail(
  email: string,
  projectId: string,
): Promise<ErrorResult<FindUserResult>> {
  return toResult(async () => {
    const {data: userId, error: rpcError} = await supabase.rpc(
      'find_user_id_by_email',
      {p_email: email, p_project_id: projectId},
    );
    if (rpcError) {
      throw new PgError(rpcError.message, rpcError.code);
    }
    return {userId: userId as string | null};
  }, 'projectSettingsService.findUserIdByEmail');
}

export interface InsertMemberResult {
  /** Set when the insert failed with a uniqueness violation. */
  alreadyMember?: boolean;
}

/**
 * Insert a project member row. Returns {alreadyMember: true} on duplicate
 * (pg code 23505) so the caller can show the right toast without re-throwing.
 *
 * NOTE: toast messages are handled by the caller (TeamMembersSection).
 */
export function insertProjectMember(
  projectId: string,
  userId: string,
  role: MemberRole,
): Promise<ErrorResult<InsertMemberResult>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('project_members')
      .insert([{project_id: projectId, user_id: userId, role}]);
    if (error) {
      if (error.code === '23505') return {alreadyMember: true};
      throw error;
    }
    return {};
  }, 'projectSettingsService.insertProjectMember');
}

/**
 * Update the role of an existing project_members row.
 *
 * NOTE: toast messages are handled by the caller (TeamMembersSection).
 */
export function updateMemberRole(
  memberId: string,
  role: MemberRole,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('project_members')
      .update({role})
      .eq('id', memberId);
    if (error) throw error;
  }, 'projectSettingsService.updateMemberRole');
}

/**
 * Remove a project_members row by its id.
 *
 * NOTE: toast messages are handled by the caller (TeamMembersSection).
 */
export function removeProjectMember(
  memberId: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('project_members')
      .delete()
      .eq('id', memberId);
    if (error) throw error;
  }, 'projectSettingsService.removeProjectMember');
}

// ---------------------------------------------------------------------------
// useComparisonPermissions: load role + blind mode in one call
// ---------------------------------------------------------------------------

export interface ComparisonPermissionsData {
  userRole: UserRole;
  isBlindMode: boolean;
  rules: PermissionRules;
}

/**
 * Load the member role and project blind-mode setting for comparison
 * permission computation. Throws when the member row is not found or the
 * role is invalid, so useComparisonPermissions can apply a safe fallback.
 *
 * NOTE: error messages are stored in hook state, not shown as toasts.
 */
export function loadComparisonPermissions(
  projectId: string,
  userId: string,
): Promise<ErrorResult<ComparisonPermissionsData>> {
  return toResult(async () => {
    const {data: member, error: memberError} = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();
    if (memberError) throw memberError;
    if (!member) throw new Error('User is not a project member');

    const {data: project, error: projectError} = await supabase
      .from('projects')
      .select('settings')
      .eq('id', projectId)
      .single();
    if (projectError) throw projectError;

    const role = member.role;
    if (!isValidUserRole(role)) throw new Error(`Invalid role: ${role}`);

    const isBlindMode =
      (project?.settings as {blind_mode?: boolean} | null)?.blind_mode === true;

    const rules = getRolePermissions(role, isBlindMode);
    return {userRole: role, isBlindMode, rules};
  }, 'projectSettingsService.loadComparisonPermissions');
}
