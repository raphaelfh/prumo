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
import type {MemberRole, Project} from '@/types/project';
import type {ProjectMemberRole} from '@/types/extraction';
import {getRolePermissions, isValidUserRole, type ManagerVisibilitySettings, type PermissionRules, type ReviewKind, type UserRole} from '@/lib/comparison/permissions';

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

export type SaveProjectFields = Pick<Project,
  | 'name'
  | 'description'
  | 'review_type'
  | 'review_title'
  | 'condition_studied'
  | 'review_rationale'
  | 'search_strategy'
  | 'picots_config_ai_review'
  | 'eligibility_criteria'
  | 'study_design'
  | 'review_keywords'
  | 'review_context'
>;

/**
 * Persist updated project fields.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function saveProjectSettings(
  projectId: string,
  fields: SaveProjectFields,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('projects')
      .update(fields)
      .eq('id', projectId);
    if (error) throw error;
  }, 'projectSettingsService.saveProjectSettings');
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
// useNavigation: search and profile
// ---------------------------------------------------------------------------

export interface SearchProjectResult {
  id: string;
  name: string;
  description: string | null;
}

export interface SearchArticleResult {
  id: string;
  title: string;
  abstract: string | null;
}

/**
 * Search projects by name (ilike).
 *
 * NOTE: errors are silently ignored by the caller (returns []).
 */
export function searchProjects(
  query: string,
): Promise<ErrorResult<SearchProjectResult[]>> {
  return toResult(async () => {
    const {data} = await supabase
      .from('projects')
      .select('id, name, description')
      .ilike('name', `%${query}%`)
      .limit(5);
    return (data ?? []) as SearchProjectResult[];
  }, 'projectSettingsService.searchProjects');
}

/**
 * Search articles by title (ilike).
 *
 * NOTE: errors are silently ignored by the caller (returns []).
 */
export function searchArticles(
  query: string,
): Promise<ErrorResult<SearchArticleResult[]>> {
  return toResult(async () => {
    const {data} = await supabase
      .from('articles')
      .select('id, title, abstract')
      .ilike('title', `%${query}%`)
      .limit(5);
    return (data ?? []) as SearchArticleResult[];
  }, 'projectSettingsService.searchArticles');
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

// ---------------------------------------------------------------------------
// QualityAssessmentFullScreen: template kind resolution
// ---------------------------------------------------------------------------

/**
 * Resolve whether a template id belongs to a project clone or the global pool.
 *
 * NOTE: errors cause kind:'missing' in the caller.
 */
export interface ResolvedTemplateKind {
  projectId: string | null;
  globalId: string | null;
}

export function resolveQATemplateKind(
  templateId: string,
): Promise<ErrorResult<ResolvedTemplateKind>> {
  return toResult(async () => {
    const [projectRes, globalRes] = await Promise.all([
      supabase
        .from('project_extraction_templates')
        .select('id')
        .eq('id', templateId)
        .eq('kind', 'quality_assessment')
        .maybeSingle(),
      supabase
        .from('extraction_templates_global')
        .select('id')
        .eq('id', templateId)
        .eq('kind', 'quality_assessment')
        .maybeSingle(),
    ]);
    if (projectRes.error && globalRes.error) throw projectRes.error;
    return {
      projectId: projectRes.data?.id ?? null,
      globalId: globalRes.data?.id ?? null,
    };
  }, 'projectSettingsService.resolveQATemplateKind');
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
