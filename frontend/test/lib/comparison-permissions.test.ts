/**
 * Tests for ``frontend/lib/comparison/permissions.ts``.
 *
 * Per-kind, setting-driven blind-review gate: managers are blind to other
 * reviewers by default and see peers only when the project's
 * ``managers_see_reviewers[kind]`` toggle is on. Consensus always sees (pure
 * adjudicator); reviewer/viewer never do. The extraction and QA toggles are
 * independent. This mirrors the server rule (``caller_can_see_peers``); the
 * peer data itself is server-blinded, so this gate decides only whether the
 * compare affordance is offered.
 */

import { describe, expect, it } from 'vitest';

import {
  canUserSeeOthers,
  getRolePermissions,
  isValidUserRole,
  type ManagerVisibilitySettings,
  type UserRole,
} from '@/lib/comparison/permissions';

const ext_on: ManagerVisibilitySettings = {
  managers_see_reviewers: { extraction: true, quality_assessment: false },
};
const all_off: ManagerVisibilitySettings = {
  managers_see_reviewers: { extraction: false, quality_assessment: false },
};

describe('canUserSeeOthers — per-kind, setting-driven', () => {
  it('manager follows the per-kind setting', () => {
    expect(canUserSeeOthers('manager', ext_on, 'extraction')).toBe(true);
    expect(canUserSeeOthers('manager', ext_on, 'quality_assessment')).toBe(false);
    expect(canUserSeeOthers('manager', all_off, 'extraction')).toBe(false);
  });

  it('consensus ALWAYS sees peers, regardless of the setting', () => {
    expect(canUserSeeOthers('consensus', all_off, 'extraction')).toBe(true);
    expect(canUserSeeOthers('consensus', all_off, 'quality_assessment')).toBe(true);
  });

  it('reviewer / viewer NEVER see peers, even when managers are revealed', () => {
    expect(canUserSeeOthers('reviewer', ext_on, 'extraction')).toBe(false);
    expect(canUserSeeOthers('viewer', ext_on, 'extraction')).toBe(false);
  });

  it('missing map / missing key / null settings = blind', () => {
    expect(canUserSeeOthers('manager', {}, 'extraction')).toBe(false);
    expect(canUserSeeOthers('manager', null, 'extraction')).toBe(false);
    expect(canUserSeeOthers('manager', { managers_see_reviewers: {} }, 'extraction')).toBe(false);
  });
});

describe('getRolePermissions — canSeeOthers per role x setting x kind', () => {
  it('manager canSeeOthers tracks the per-kind setting', () => {
    expect(getRolePermissions('manager', ext_on, 'extraction').canSeeOthers).toBe(true);
    expect(getRolePermissions('manager', ext_on, 'quality_assessment').canSeeOthers).toBe(false);
  });

  it('consensus canSeeOthers always true', () => {
    expect(getRolePermissions('consensus', all_off, 'extraction').canSeeOthers).toBe(true);
  });

  it('reviewer / viewer canSeeOthers always false', () => {
    expect(getRolePermissions('reviewer', ext_on, 'extraction').canSeeOthers).toBe(false);
    expect(getRolePermissions('viewer', ext_on, 'extraction').canSeeOthers).toBe(false);
  });

  it('manager retains resolve/manage/export/edit', () => {
    const p = getRolePermissions('manager', all_off, 'extraction');
    expect(p.canResolveConflicts).toBe(true);
    expect(p.canManageBlindMode).toBe(true);
    expect(p.canExport).toBe(true);
    expect(p.canEditTemplate).toBe(true);
  });

  it('consensus resolves + exports but cannot manage blind or edit template', () => {
    const p = getRolePermissions('consensus', all_off, 'extraction');
    expect(p.canResolveConflicts).toBe(true);
    expect(p.canManageBlindMode).toBe(false);
    expect(p.canExport).toBe(true);
    expect(p.canEditTemplate).toBe(false);
  });

  it('reviewer / viewer have no admin permissions', () => {
    for (const role of ['reviewer', 'viewer'] as const) {
      const p = getRolePermissions(role, all_off, 'extraction');
      expect(p.canResolveConflicts).toBe(false);
      expect(p.canManageBlindMode).toBe(false);
      expect(p.canExport).toBe(false);
      expect(p.canEditTemplate).toBe(false);
    }
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
