/**
 * Types for Projects and settings
 *
 * Centralizes project-related interfaces to avoid 'any'
 * and ensure type safety.
 *
 * Based on Supabase generated types for consistency.
 */

import type {Database} from '@/integrations/supabase/types';

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
 * Type for Project insert
 */
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];

/**
 * Type for Project update
 */
export type ProjectUpdate = Partial<Omit<Project, 'id' | 'created_at'>>;

/**
 * Lean type for project lists.
 */
export type ProjectListItem = Pick<
    Project,
    'id' | 'name' | 'description' | 'created_at' | 'is_active' | 'review_title'
>;

/**
 * Lean type for project context.
 */
export type ProjectSummary = Pick<
    Project,
    'id' | 'name' | 'description' | 'review_title' | 'condition_studied'
>;

/**
 * Full Project type with all settings
 * Kept for compatibility with existing code
 */
export interface ProjectData extends Project {
  review_rationale: string | null;
  review_keywords: string[];
  eligibility_criteria: EligibilityCriteria;
  study_design: StudyDesign;
  review_context: string | null;
  search_strategy: string | null;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  blind_mode?: boolean;
  [key: string]: unknown;
}

export interface EligibilityCriteria {
  inclusion?: string[];
  exclusion?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface StudyDesign {
  types?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface ProjectConfigData {
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
  eligibility_criteria: EligibilityCriteria;
  study_design: StudyDesign;
}
