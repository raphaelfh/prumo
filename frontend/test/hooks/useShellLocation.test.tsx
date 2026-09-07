/**
 * The shell derives its state from the URL, never from ProjectContext:
 * ProjectProvider writes `?tab=` in a mount effect and its own source comment
 * warns that wrapping a redirecting component clobbers the redirect (spec
 * §3.1). These are the derivation's only rules, so they are asserted directly
 * rather than through a rendered shell.
 */
import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {MemoryRouter} from 'react-router';
import {DEFAULT_PROJECT_TAB, useShellLocation} from '@/hooks/useShellLocation';

function at(path: string) {
  return renderHook(() => useShellLocation(), {
    wrapper: ({children}) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  }).result.current;
}

describe('useShellLocation', () => {
  it('yields no project id on the hub', () => {
    expect(at('/')).toEqual({projectId: null, activeSection: null});
  });

  it('yields no project id on settings', () => {
    expect(at('/settings?tab=security')).toEqual({projectId: null, activeSection: null});
  });

  it('matches a bare project route', () => {
    expect(at('/projects/p1')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
  });

  it('reads the section from ?tab=', () => {
    expect(at('/projects/p1?tab=extraction')).toEqual({projectId: 'p1', activeSection: 'extraction'});
  });

  it('falls back to the default section for an unknown ?tab=', () => {
    expect(at('/projects/p1?tab=bogus')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
  });

  it('matches nested run routes at any depth', () => {
    expect(at('/projects/p1/extraction/a9')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
    expect(at('/projects/p1/articles/a9/quality-assessment/t3')).toMatchObject({projectId: 'p1'});
  });

  it('does not treat a settings ?tab= as a project section', () => {
    expect(at('/settings?tab=integrations').activeSection).toBeNull();
  });
});
