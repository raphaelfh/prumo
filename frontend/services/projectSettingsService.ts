// frontend/services/projectSettingsService.ts
/**
 * Project settings service — IO for the Settings page and the
 * comparison-permission checks.
 *
 * Writes to `projects` go through the API (`apiClient`): the details save
 * (PATCH /projects/{id}/details, optimistic precondition) and the delete
 * (DELETE /projects/{id}); the browser role holds no INSERT/UPDATE/DELETE
 * grant on that table. The remaining Supabase calls are the Settings load,
 * the comparison-permission reads, the member RPCs/writes and the profile read.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
 */
import {apiClient, ApiError} from '@/integrations/api/client';
import {supabase} from '@/integrations/supabase/client';
import type {components} from '@/types/api/schema';
import {toResult, PgError, type ErrorResult} from '@/lib/error-utils';
import type {MemberRole, Project} from '@/types/project';
import type {ProjectMemberRole} from '@/types/extraction';
import {getRolePermissions, isValidUserRole, type ManagerVisibilitySettings, type PermissionRules, type ReviewKind, type UserRole} from '@/lib/comparison/permissions';

// ---------------------------------------------------------------------------
// AdvancedSettingsSection: delete project
// ---------------------------------------------------------------------------

type ProjectDeleteRead = components['schemas']['ProjectDeleteRead'];

/**
 * Delete a project by id (`DELETE /api/v1/projects/{id}`, manager-gated).
 * A non-manager's attempt comes back as an ApiError 403, never as an empty
 * success; a non-member or missing project as a 404.
 *
 * NOTE: toast messages are handled by the caller (AdvancedSettingsSection).
 */
export function deleteProject(projectId: string): Promise<ErrorResult<ProjectDeleteRead>> {
  return toResult(
    () => apiClient<ProjectDeleteRead>(`/api/v1/projects/${projectId}`, {method: 'DELETE'}),
    'projectSettingsService.deleteProject',
  );
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
    // Re-wrap into PgError so the pg code (e.g. 'PM001' from the
    // min-one-manager guard) survives toResult and the caller can branch on
    // `instanceof PgError && .code`. A bare throw would reach the component as
    // a PostgrestError, defeating that check.
    if (error) throw new PgError(error.message, error.code);
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
    // Re-wrap so the pg code (e.g. 'PM001') reaches the caller as a PgError.
    if (error) throw new PgError(error.message, error.code);
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

// ---------------------------------------------------------------------------
// useProjectSettings: load and save project
// ---------------------------------------------------------------------------

/**
 * Load a single project row for the settings hook.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function loadProjectForSettings(
  projectId: string,
): Promise<ErrorResult<Project>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();
    if (error) throw error;
    return data as Project;
  }, 'projectSettingsService.loadProjectForSettings');
}

export type ProjectDetailsFields = components['schemas']['ProjectDetailsFields'];
type ProjectDetailsUpdate = components['schemas']['ProjectDetailsUpdate'];
type ProjectDetailsRead = components['schemas']['ProjectDetailsRead'];

/**
 * Persist the changed descriptive fields; `expected` holds the values the
 * page loaded (409 STALE_VALUE when any moved server-side).
 *
 * NOTE: toast messages are handled by the caller.
 */
export function saveProjectSettings(
  projectId: string,
  body: ProjectDetailsUpdate,
): Promise<ErrorResult<ProjectDetailsRead>> {
  return toResult(
    () => apiClient<ProjectDetailsRead>(`/api/v1/projects/${projectId}/details`, {method: 'PATCH', body}),
    'projectSettingsService.saveProjectSettings',
  );
}

/** The server's current values of the contested fields for a 409 STALE_VALUE; null for any other error. */
export function staleValuesOf(error: Error): Record<string, unknown> | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'STALE_VALUE') return null;
  const current = error.details?.current;
  return isRecord(current) ? current : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/** The Supabase row's `Json` columns narrowed to the PATCH contract; null when a JSONB value has the wrong shape. */
export function toDetailsFields(values: Partial<Project>): ProjectDetailsFields | null {
  const {eligibility_criteria, study_design, review_keywords} = values;
  if (eligibility_criteria !== undefined && !isRecord(eligibility_criteria)) return null;
  if (study_design !== undefined && !isRecord(study_design)) return null;
  if (review_keywords !== undefined && !isStringList(review_keywords)) return null;
  return {
    name: values.name,
    description: values.description,
    review_type: values.review_type,
    review_title: values.review_title,
    condition_studied: values.condition_studied,
    review_rationale: values.review_rationale,
    search_strategy: values.search_strategy,
    review_context: values.review_context,
    eligibility_criteria,
    study_design,
    review_keywords,
  };
}

// ---------------------------------------------------------------------------
// useProjectMemberRole: member role lookup
// ---------------------------------------------------------------------------

/**
 * Fetch the current user's role in a project.
 * Returns null when the user is not a member.
 *
 * NOTE: errors are silently cleared (role → null) by the caller.
 */
export function getProjectMemberRole(
  projectId: string,
  userId: string,
): Promise<ErrorResult<ProjectMemberRole | null>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();
    if (error) return null;
    return (data?.role as ProjectMemberRole | null) ?? null;
  }, 'projectSettingsService.getProjectMemberRole');
}

// ---------------------------------------------------------------------------
// useNavigation: user profile
// ---------------------------------------------------------------------------

export interface ProfileRow {
  full_name: string | null;
  avatar_url: string | null;
}

/**
 * Load the profiles row for the given user.
 * Returns null when not found (caller falls back to auth metadata).
 *
 * NOTE: errors are silently handled by the caller.
 */
export function loadUserProfile(
  userId: string,
): Promise<ErrorResult<ProfileRow | null>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data as ProfileRow | null;
  }, 'projectSettingsService.loadUserProfile');
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
  kind: ReviewKind,
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

    const settings = (project?.settings as ManagerVisibilitySettings | null) ?? undefined;
    const rules = getRolePermissions(role, settings, kind);
    // "Blind" = the current user cannot see peers for this kind. Drives the
    // EyeOff badge; per-user truth now, not the old project-wide flag.
    const isBlindMode = !rules.canSeeOthers;
    return {userRole: role, isBlindMode, rules};
  }, 'projectSettingsService.loadComparisonPermissions');
}
