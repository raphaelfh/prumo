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
 * Determines whether user can see other users' extractions/assessments.
 *
 * Layer 3 of the multi-reviewer blind fix: the role is the source of
 * truth for read access, not the project's ``blind_mode`` flag. The
 * previous rule "blind_mode = ON → nobody sees, not even manager"
 * stranded the arbitrator: they could never reach consensus on a
 * blinded project without first manually flipping the flag from a
 * Settings page they often did not know existed.
 *
 * New semantics:
 *   - manager / consensus: ALWAYS see other reviewers' values. The
 *     ``isBlindMode`` flag is *informational* for these roles (e.g.
 *     surfacing a "blind methodology in effect" banner) but does not
 *     gate visibility.
 *   - reviewer / viewer: NEVER see other reviewers' values. The flag
 *     is moot — they never had access.
 *
 * The flag still gets persisted on the project (via the Settings
 * toggle) so external consumers (audit log, exports, downstream
 * tooling) can know whether the project was run under a blind
 * methodology. The change here is strictly the in-app gate.
 *
 * @param role - User's role in the project
 * @param isBlindMode - Whether blind mode is active (informational for
 *   manager/consensus; ignored for reviewer/viewer because they cannot
 *   see others either way)
 * @returns true if can see others
 */
export function canUserSeeOthers(
  role: UserRole,
  _isBlindMode: boolean,
): boolean {
  // Role-based gate. Manager and consensus need unblinded read access
  // to do their arbitration job; reviewer / viewer roles never see
  // other reviewers regardless of the flag.
  return role === 'manager' || role === 'consensus';
}

/**
 * Returns all permissions for a role.
 *
 * ``canSeeOthers`` follows the Layer 3 role-based gate (see
 * ``canUserSeeOthers``). All other permission flags are role-only and
 * unaffected by ``isBlindMode``.
 *
 * @param role - User role
 * @param isBlindMode - Blind mode state (informational only for
 *   manager/consensus; ignored for reviewer/viewer)
 * @returns Object with all permissions
 */
export function getRolePermissions(
  role: UserRole,
  isBlindMode: boolean,
): PermissionRules {
  const canSeeOthers = canUserSeeOthers(role, isBlindMode);
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

/**
 * Returns readable label for role
 *
 * @param role - User role
 * @returns English label with emoji
 */
export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
      manager: '👑 Manager',
      consensus: '⚖️ Consensus',
      reviewer: '✍️ Reviewer',
      viewer: '👁️ Viewer'
  };
  return labels[role];
}

