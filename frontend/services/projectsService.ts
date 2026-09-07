// frontend/services/projectsService.ts
/**
 * Projects service — IO for the project list/navigation surfaces.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase reads are relocated verbatim from hooks (no
 * new reads); the data-path consolidation owns the typed-client swap.
 */
import {supabase} from '@/integrations/supabase/client';
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {MemberRole, ProjectListItem} from '@/types/project';
import type {Article} from '@/types/article';
import type {components} from '@/types/api/schema';

// ---------------------------------------------------------------------------
// Dashboard / SidebarHeader: create project via RPC
// ---------------------------------------------------------------------------

export interface CreateProjectResult {
  projectId: string;
}

/**
 * Create a project with the current user as first member.
 * Returns the new project id on success.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function createProject(
  name: string,
  description?: string,
): Promise<ErrorResult<CreateProjectResult>> {
  return toResult(async () => {
    const {data: projectId, error} = await supabase.rpc(
      'create_project_with_member' as never,
      {p_name: name, p_description: description ?? undefined, p_review_title: undefined} as never,
    );
    if (error) throw error;
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Project id not returned by server');
    }
    return {projectId};
  }, 'projectsService.createProject');
}

// ---------------------------------------------------------------------------
// ProjectView: load project by id
// ---------------------------------------------------------------------------

export interface ProjectViewData {
  id: string;
  name: string;
  description: string | null;
  review_title: string | null;
  review_type: string | null;
  settings: unknown;
  condition_studied: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Load a single project's metadata for the ProjectView page.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function loadProjectById(
  projectId: string,
): Promise<ErrorResult<ProjectViewData>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select('id, name, description, review_title, review_type, settings, condition_studied, created_at, updated_at')
      .eq('id', projectId)
      .single();
    if (error) throw error;
    return data as ProjectViewData;
  }, 'projectsService.loadProjectById');
}

// ---------------------------------------------------------------------------
// ProjectView: load articles list
// ---------------------------------------------------------------------------

const PROJECT_ARTICLES_SELECT = [
  'id', 'title', 'abstract', 'authors', 'publication_year', 'publication_month',
  'publication_day', 'journal_title', 'journal_issn', 'journal_eissn',
  'journal_publisher', 'volume', 'issue', 'pages', 'doi', 'pmid', 'pmcid',
  'arxiv_id', 'pii', 'keywords', 'mesh_terms', 'url_landing', 'url_pdf',
  'language', 'article_type', 'publication_status', 'open_access', 'license',
  'study_design', 'conflicts_of_interest', 'data_availability', 'registration',
  'funding', 'source_payload', 'sync_conflict_log', 'hash_fingerprint',
  'source_lineage', 'row_version', 'ingestion_source', 'sync_state',
  'zotero_item_key', 'zotero_collection_key', 'zotero_version',
  'removed_at_source_at', 'last_synced_at', 'created_at', 'updated_at',
].join(', ');

/**
 * Load all articles for a project (list projection — no large text blobs).
 *
 * NOTE: errors are logged by the caller; no toast.
 */
export function loadProjectArticles(
  projectId: string,
): Promise<ErrorResult<Article[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('articles')
      .select(PROJECT_ARTICLES_SELECT)
      .eq('project_id', projectId)
      .order('created_at', {ascending: false});
    if (error) throw error;
    return (data as unknown as Article[]) ?? [];
  }, 'projectsService.loadProjectArticles');
}

// ---------------------------------------------------------------------------
// Hub: list projects (typed columns + the caller's membership row)
// ---------------------------------------------------------------------------

const PROJECT_LIST_SELECT =
  'id, name, description, created_at, updated_at, is_active, review_title, project_members(user_id, role)';

/**
 * `updated_at` is maintained by the `trg_projects_updated_at` BEFORE UPDATE
 * trigger, so it is real for every writer — the `Updated <relative>` row
 * metadata and the default sort both rest on that (spec §6.2).
 *
 * The embed is narrowed to the caller to keep the payload small; correctness
 * does not depend on it (`isProjectManager` re-checks `user_id`).
 */
export function listProjectsForDashboard(
  userId: string,
): Promise<ErrorResult<ProjectListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select(PROJECT_LIST_SELECT)
      .eq('project_members.user_id', userId)
      .order('updated_at', {ascending: false});
    if (error) throw error;
    // ONE assertion, on the embed only. `as unknown as ProjectListItem[]`
    // would switch off the check that ties this hand-written select string to
    // the generated row types for EVERY column — the same shape as the
    // recorded incident where PostgREST kept reading a dropped column past a
    // migration (constitution §V).
    return (data ?? []).map((row) => ({
      ...row,
      project_members: row.project_members as {user_id: string; role: MemberRole}[],
    }));
  }, 'projectsService.listProjectsForDashboard');
}

// ---------------------------------------------------------------------------
// Hub: archive / restore (backend endpoint, manager-gated)
// ---------------------------------------------------------------------------

export type ProjectArchiveRead = components['schemas']['ProjectArchiveRead'];

/**
 * Archive (`archived = true`) or restore a project.
 *
 * `PATCH /api/v1/projects/{id}/archive` is gated by `require_project_manager`,
 * which evaluates the same `public.is_project_manager` the `project_update`
 * RLS policy calls — so a reviewer gets a 403, not the silent zero-row success
 * a direct PostgREST update would have returned. The response is the row as
 * STORED, so the caller can check that the write did what was asked.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<ErrorResult<ProjectArchiveRead>> {
  return toResult(
    () =>
      apiClient<ProjectArchiveRead>(`/api/v1/projects/${projectId}/archive`, {
        method: 'PATCH',
        body: {archived},
      }),
    'projectsService.setProjectArchived',
  );
}
