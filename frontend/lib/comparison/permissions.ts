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
 * Determines whether user can see other users' extractions/assessments
 *
 * Business rules:
 * 1. If blind_mode = ON → Nobody sees others (not even manager)
 * 2. If blind_mode = OFF → Only manager and consensus see others
 * 3. Reviewers and viewers NEVER see others (even without blind mode)
 *
 * @param role - User's role in the project
 * @param isBlindMode - Whether blind mode is active
 * @returns true if can see others
 */
export function canUserSeeOthers(
  role: UserRole,
  isBlindMode: boolean
): boolean {
    // Blind mode blocks everyone (rule 1)
  if (isBlindMode) return false;

    // Only manager and consensus (rules 2 and 3)
  return role === 'manager' || role === 'consensus';
}

/**
 * Returns all permissions for a role.
 * * Only when blind_mode = OFF for canSeeOthers.
 *
 * @param role - User role
 * @param isBlindMode - Blind mode state
 * @returns Object with all permissions
 */
export function getRolePermissions(
  role: UserRole,
  isBlindMode: boolean
): PermissionRules {
  const basePermissions: Record<UserRole, PermissionRules> = {
    manager: {
      canSeeOthers: !isBlindMode,
      canResolveConflicts: true,
      canManageBlindMode: true,
      canExport: true,
      canEditTemplate: true
    },
    consensus: {
      canSeeOthers: !isBlindMode,
      canResolveConflicts: true,
      canManageBlindMode: false,
      canExport: true,
      canEditTemplate: false
    },
    reviewer: {
        canSeeOthers: false,  // Never sees others (avoids bias)
      canResolveConflicts: false,
      canManageBlindMode: false,
      canExport: false,
      canEditTemplate: false
    },
    viewer: {
      canSeeOthers: false,
      canResolveConflicts: false,
      canManageBlindMode: false,
      canExport: false,
      canEditTemplate: false
    }
  };

  return basePermissions[role];
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

