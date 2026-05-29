/**
 * Tests for ``frontend/lib/comparison/permissions.ts``.
 *
 * Layer 3 of the multi-reviewer blind fix: ``blind_mode`` is a
 * methodological flag for the *team-wide* visibility during PROPOSAL /
 * REVIEW (no reviewer sees another). Manager and Consensus roles need
 * unblinded access to do their arbitration job — gating those roles on
 * ``blind_mode`` left projects with no way to reach consensus when the
 * flag was on (the prior behaviour, before this layer). The new
 * semantics treat the role as the source of truth for read access:
 *
 *   - Manager / Consensus: ALWAYS see other reviewers' values. The
 *     blind_mode flag is informational for these roles.
 *   - Reviewer / Viewer: NEVER see other reviewers' values. The flag
 *     is also moot for them — they never had visibility.
 *
 * Net effect: ``blind_mode`` ON or OFF no longer changes who can see
 * what; the role does. The flag remains as an audit / future-policy
 * marker (e.g. surfacing a "blind methodology in effect" banner).
 */

import { describe, expect, it } from 'vitest';

import {
  canUserSeeOthers,
  getRolePermissions,
  isValidUserRole,
  type UserRole,
} from '@/lib/comparison/permissions';

describe('canUserSeeOthers — Layer 3 (role-based, not flag-based)', () => {
  it('manager sees others when blind_mode=OFF', () => {
    expect(canUserSeeOthers('manager', false)).toBe(true);
  });

  it('manager STILL sees others when blind_mode=ON (role bypass)', () => {
    // Pre-Layer-3 behaviour returned false here, blocking the
    // arbitrator from reaching consensus in any blinded project.
    expect(canUserSeeOthers('manager', true)).toBe(true);
  });

  it('consensus sees others when blind_mode=OFF', () => {
    expect(canUserSeeOthers('consensus', false)).toBe(true);
  });

  it('consensus STILL sees others when blind_mode=ON (role bypass)', () => {
    expect(canUserSeeOthers('consensus', true)).toBe(true);
  });

  it('reviewer never sees others, regardless of blind_mode', () => {
    expect(canUserSeeOthers('reviewer', false)).toBe(false);
    expect(canUserSeeOthers('reviewer', true)).toBe(false);
  });

  it('viewer never sees others, regardless of blind_mode', () => {
    expect(canUserSeeOthers('viewer', false)).toBe(false);
    expect(canUserSeeOthers('viewer', true)).toBe(false);
  });
});

describe('getRolePermissions — Layer 3 canSeeOthers semantics', () => {
  it('manager canSeeOthers is true with blind_mode ON or OFF', () => {
    expect(getRolePermissions('manager', false).canSeeOthers).toBe(true);
    expect(getRolePermissions('manager', true).canSeeOthers).toBe(true);
  });

  it('consensus canSeeOthers is true with blind_mode ON or OFF', () => {
    expect(getRolePermissions('consensus', false).canSeeOthers).toBe(true);
    expect(getRolePermissions('consensus', true).canSeeOthers).toBe(true);
  });

  it('reviewer canSeeOthers is always false', () => {
    expect(getRolePermissions('reviewer', false).canSeeOthers).toBe(false);
    expect(getRolePermissions('reviewer', true).canSeeOthers).toBe(false);
  });

  it('viewer canSeeOthers is always false', () => {
    expect(getRolePermissions('viewer', false).canSeeOthers).toBe(false);
    expect(getRolePermissions('viewer', true).canSeeOthers).toBe(false);
  });

  it('manager retains canResolveConflicts, canManageBlindMode, canExport, canEditTemplate', () => {
    const p = getRolePermissions('manager', false);
    expect(p.canResolveConflicts).toBe(true);
    expect(p.canManageBlindMode).toBe(true);
    expect(p.canExport).toBe(true);
    expect(p.canEditTemplate).toBe(true);
  });

  it('consensus retains canResolveConflicts + canExport but cannot manage blind_mode or edit template', () => {
    const p = getRolePermissions('consensus', true);
    expect(p.canResolveConflicts).toBe(true);
    expect(p.canManageBlindMode).toBe(false);
    expect(p.canExport).toBe(true);
    expect(p.canEditTemplate).toBe(false);
  });

  it('reviewer has no admin permissions, only their own editing scope', () => {
    const p = getRolePermissions('reviewer', false);
    expect(p.canResolveConflicts).toBe(false);
    expect(p.canManageBlindMode).toBe(false);
    expect(p.canExport).toBe(false);
    expect(p.canEditTemplate).toBe(false);
  });

  it('viewer has no permissions', () => {
    const p = getRolePermissions('viewer', false);
    expect(p.canResolveConflicts).toBe(false);
    expect(p.canManageBlindMode).toBe(false);
    expect(p.canExport).toBe(false);
    expect(p.canEditTemplate).toBe(false);
  });
});

describe('isValidUserRole', () => {
  it('accepts known roles', () => {
    const roles: UserRole[] = ['manager', 'consensus', 'reviewer', 'viewer'];
    for (const r of roles) {
      expect(isValidUserRole(r)).toBe(true);
    }
  });

  it('rejects unknown roles', () => {
    expect(isValidUserRole('admin')).toBe(false);
    expect(isValidUserRole('')).toBe(false);
    expect(isValidUserRole('Manager')).toBe(false); // case-sensitive
  });
});
