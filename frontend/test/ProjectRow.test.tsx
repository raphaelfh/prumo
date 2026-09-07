/**
 * Pins the three subtractions the spec mandated when `ProjectRow` replaced
 * the inline Dashboard row (spec §5) — the `is_active` dot, the `is_active`
 * fragment in the row's accessible name, and the "No additional description"
 * filler — plus the `Updated <relative>` substitution that replaced a
 * created-date read.
 *
 * Not in the task brief: added because `ProjectRow` (Task 12) shipped with
 * no component test, and a reviewer reintroducing the `is_active`
 * aria-label fragment left all existing tests green. See task-13-report.md
 * for the mutation-test proof that this file actually catches that
 * regression.
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';
import {ProjectRow} from '@/components/project/ProjectRow';
import type {ProjectListItem} from '@/types/project';

function project(over: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    is_active: true,
    review_title: null,
    project_members: [{user_id: 'u1', role: 'manager'}],
    ...over,
  };
}

function renderRow(p: ProjectListItem) {
  return render(
    <MemoryRouter>
      <ProjectRow project={p} userId="u1" onArchivedChange={vi.fn()}/>
    </MemoryRouter>,
  );
}

describe('ProjectRow', () => {
  it('gives the row link an accessible name with no is_active fragment', () => {
    renderRow(project({is_active: true}));
    // Exact-name match: a reintroduced " — active" suffix on the link's name
    // would make this lookup fail (the element would only be reachable
    // under the longer name).
    expect(screen.getByRole('link', {name: 'Alpha'})).toBeInTheDocument();
  });

  it('renders no decorative active-status dot', () => {
    const {container} = renderRow(project({is_active: true}));
    // The dot was a bare `aria-hidden` <span>; every icon in this row is an
    // `aria-hidden` <svg>, so this targets the specific decoration without
    // freezing the row's whole markup or className strings.
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it('does not fall back to the deleted "no description" filler', () => {
    renderRow(project({description: null, review_title: null}));
    expect(screen.queryByText('No additional description')).toBeNull();
  });

  it('shows relative update time instead of a created date', () => {
    renderRow(project({}));
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('5 min ago')).toBeInTheDocument();
    expect(screen.queryByText('Created')).toBeNull();
  });
});
