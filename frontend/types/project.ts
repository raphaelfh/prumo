/**
 * Types for Projects and settings
 *
 * Centralizes project-related interfaces to avoid 'any'
 * and ensure type safety.
 *
 * Based on Supabase generated types for consistency.
 */

import type {Database, Json} from '@/integrations/supabase/types';

/** Review type (Supabase enum). */
export type ReviewType = Database['public']['Enums']['review_type'];

/** Project member role (Supabase enum). */
export type MemberRole = Database['public']['Enums']['project_member_role'];

/** Metadata per review type for UI labels and descriptions. */
export const REVIEW_TYPES: Record<
    ReviewType,
    { label: string; description: string; badge?: string }
> = {
    interventional: {
        label: 'Interventions',
        description: 'Review of intervention effectiveness (classic PICO)',
    },
    predictive_model: {
        label: 'Predictive Models',
        description: 'Review of predictive and prognostic models (PICOTS)',
        badge: 'PICOTS',
    },
    diagnostic: {
        label: 'Diagnostic Tests',
        description: 'Review of diagnostic test accuracy',
    },
    prognostic: {
        label: 'Prognostic Factors',
        description: 'Review of factors associated with prognosis',
    },
    qualitative: {
        label: 'Qualitative Studies',
        description: 'Synthesis of qualitative evidence',
    },
    other: {
        label: 'Other',
        description: 'Other types of systematic review',
    },
};

/** Metadata per member role for labels and Badge variant. */
export const MEMBER_ROLES: Record<
    MemberRole,
    { label: string; description: string; variant: 'default' | 'secondary' | 'outline' }
> = {
    manager: {
        label: 'Manager',
        description: 'Manages settings, members, and has full access',
        variant: 'default',
    },
    reviewer: {
        label: 'Reviewer',
        description: 'Evaluates articles and participates in the review',
        variant: 'secondary',
    },
    viewer: {
        label: 'Viewer',
        description: 'View only, no edit permission',
        variant: 'outline',
    },
    consensus: {
        label: 'Consensus',
        description: 'Resolves conflicts between reviewers',
        variant: 'secondary',
    },
};

/**
 * Base Project type from database
 * Uses Supabase-generated type for type safety
 */
export type Project = Database['public']['Tables']['projects']['Row'];

/**
 * Lean type for project lists.
 *
 * `project_members` carries membership rows for this project.
 * `listProjectsForDashboard` narrows the embed to the caller with
 * `.eq('project_members.user_id', …)`, but `isProjectManager` re-checks
 * `user_id` anyway: the RLS policy `project_members_select` lets any member
 * read every member row, so a predicate that trusted the transport would say
 * "manager" for any project that has one.
 *
 * None of this is the security boundary. The archive write is
 * `PATCH /api/v1/projects/{id}/archive`, gated by `require_project_manager`
 * against the same `public.is_project_manager` the `project_update` RLS policy
 * calls. This only decides whether the menu item is offered.
 */
export type ProjectListItem = Pick<
    Project,
    'id' | 'name' | 'description' | 'created_at' | 'updated_at' | 'is_active' | 'review_title'
> & {
    project_members: { user_id: string; role: MemberRole }[];
};

/**
 * The ONE client-side answer to "does this role mean manager?".
 *
 * `useProjectMemberRole` derived the same `role === 'manager'` inline; both
 * now call this, so the hub and a project route cannot disagree within one
 * session. (`extractionFieldService.checkProjectPermissions` is a separate
 * *read* of `project_members`, not a second role predicate — consolidating
 * that read belongs to the ADR-0011 data-path work, not here.)
 */
export function isManagerRole(role: MemberRole | null | undefined): boolean {
    return role === 'manager';
}

/** True when `userId`'s OWN membership row on this project is a manager row. */
export function isProjectManager(project: ProjectListItem, userId: string): boolean {
    return project.project_members.some(
        (member) => member.user_id === userId && isManagerRole(member.role),
    );
}

/**
 * Lean type for project context.
 */
export type ProjectSummary = Pick<
    Project,
    'id' | 'name' | 'description' | 'review_title' | 'condition_studied'
>;


export interface EligibilityCriteria {
  inclusion?: string[];
  exclusion?: string[];
  notes?: string;
  [key: string]: Json | undefined;
}

export interface StudyDesign {
  types?: string[];
  notes?: string;
  [key: string]: Json | undefined;
}

