/**
 * Permission rules for comparison
 *
 * Centralizes all permission rules for comparing extractions/assessments across users.
 * Keeps Assessment and Extraction consistent.
 *
 * @module comparison/permissions
 */

/**
 * Roles available for project members
 * Based on project_member_role enum in DB
 */
export type UserRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

/**
 * Full set of permissions for a user
 */
export interface PermissionRules {
    canSeeOthers: boolean;         // See other users' extractions/assessments
    canResolveConflicts: boolean;  // Resolve conflicts and create consensus
    canManageBlindMode: boolean;   // Enable/disable blind mode
    canExport: boolean;            // Export data and reports
    canEditTemplate: boolean;      // Edit extraction template
}

/**
 * Canonical HITL "kind" discriminator (mirrors `run.kind` / the backend
 * `TemplateKind` enum). This is the single source of the union — `HITLKind`,
 * `HITLKindParam`, and any other kind type alias to this rather than
 * re-declaring the literal (which drifts).
 */
export type ReviewKind = 'extraction' | 'quality_assessment';

/** Minimal projection of `projects.settings` the visibility gate reads. */
export interface ManagerVisibilitySettings {
  managers_see_reviewers?: Partial<Record<ReviewKind, boolean>>;
}

/**
 * Determines whether a user can see OTHER reviewers' values, per kind.
 *
 * Blind-by-default for managers: a manager sees peers only when the
 * project's live, per-kind setting ``managers_see_reviewers[kind]`` is
 * true (toggled from the extraction / QA settings). The rule:
 *   - consensus: ALWAYS sees peers (pure adjudicator, never blind);
 *   - manager: sees peers IFF ``managers_see_reviewers[kind]`` is true;
 *   - reviewer / viewer: NEVER see peers.
 *
 * This is the frontend mirror of the server rule in
 * ``extraction_run_read_service.caller_can_see_peers``; the data the
 * compare surfaces consume is already server-blinded in ``runDetail``,
 * so this gate decides only whether the affordance is offered.
 *
 * @param role - User's role in the project
 * @param settings - The project's settings (the per-kind toggle map)
 * @param kind - Which HITL kind the current screen is operating on
 * @returns true if the user may see other reviewers' values
 */
export function canUserSeeOthers(
  role: UserRole,
  settings: ManagerVisibilitySettings | null | undefined,
  kind: ReviewKind,
): boolean {
  if (role === 'consensus') return true;
  if (role === 'manager') return settings?.managers_see_reviewers?.[kind] === true;
  return false; // reviewer / viewer never see peers
}

/**
 * Returns all permissions for a role. ``canSeeOthers`` follows the
 * per-kind gate (see ``canUserSeeOthers``); all other flags are
 * role-only.
 *
 * @param role - User role
 * @param settings - Project settings (per-kind manager toggle)
 * @param kind - Which HITL kind the current screen operates on
 * @returns Object with all permissions
 */
export function getRolePermissions(
  role: UserRole,
  settings: ManagerVisibilitySettings | null | undefined,
  kind: ReviewKind,
): PermissionRules {
  const canSeeOthers = canUserSeeOthers(role, settings, kind);
  switch (role) {
    case 'manager':
      return {
        canSeeOthers,
        canResolveConflicts: true,
        canManageBlindMode: true,
        canExport: true,
        canEditTemplate: true,
      };
    case 'consensus':
      return {
        canSeeOthers,
        canResolveConflicts: true,
        canManageBlindMode: false,
        canExport: true,
        canEditTemplate: false,
      };
    case 'reviewer':
    case 'viewer':
      // Neither role ever sees other reviewers (avoids bias for
      // reviewers; viewers have no edit/decision surface at all).
      return {
        canSeeOthers: false,
        canResolveConflicts: false,
        canManageBlindMode: false,
        canExport: false,
        canEditTemplate: false,
      };
  }
}

/**
 * Validates that role is valid
 * Type guard for runtime validation
 *
 * @param role - String to validate
 * @returns true if valid UserRole
 */
export function isValidUserRole(role: string): role is UserRole {
  return ['manager', 'reviewer', 'viewer', 'consensus'].includes(role);
}

