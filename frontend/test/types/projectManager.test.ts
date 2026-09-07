// frontend/test/types/projectManager.test.ts
/**
 * "Does the caller manage this project?" — one predicate, and it does not
 * trust the transport.
 *
 * The list read narrows the embed with `.eq('project_members.user_id', …)`,
 * but that narrowing is asserted only against a chain stub. So the predicate
 * re-checks the row's owner: even handed the whole roster it must answer for
 * the caller alone.
 */
import {describe, expect, it} from 'vitest';
import {isManagerRole, isProjectManager, type ProjectListItem} from '@/types/project';

function project(members: {user_id: string; role: string}[]): ProjectListItem {
  return {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
    project_members: members,
  } as ProjectListItem;
}

describe('isManagerRole', () => {
  it('is true only for manager', () => {
    expect(isManagerRole('manager')).toBe(true);
    expect(isManagerRole('reviewer')).toBe(false);
    expect(isManagerRole('viewer')).toBe(false);
    expect(isManagerRole('consensus')).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });
});

describe('isProjectManager', () => {
  it('is true when the caller\'s own row is a manager row', () => {
    expect(isProjectManager(project([{user_id: 'u1', role: 'manager'}]), 'u1')).toBe(true);
  });

  it('is false for the caller\'s own non-manager row', () => {
    expect(isProjectManager(project([{user_id: 'u1', role: 'reviewer'}]), 'u1')).toBe(false);
  });

  it('ignores OTHER members\' manager rows if the whole roster arrives', () => {
    // The failure mode this exists for: an unapplied embed filter would hand
    // back every member, and "some member is a manager" is true of nearly
    // every project.
    const roster = project([
      {user_id: 'someone-else', role: 'manager'},
      {user_id: 'u1', role: 'viewer'},
    ]);
    expect(isProjectManager(roster, 'u1')).toBe(false);
  });

  it('is false when the caller has no row at all', () => {
    expect(isProjectManager(project([]), 'u1')).toBe(false);
  });
});
