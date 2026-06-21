import React from 'react';
import {describe, it, expect, beforeEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {SidebarProvider, useSidebar} from './SidebarContext';

const wrapper = ({children}: {children: React.ReactNode}) => <SidebarProvider>{children}</SidebarProvider>;

describe('SidebarContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads initial collapsed from localStorage', () => {
    localStorage.setItem('prumo:sidebar:collapsed', 'true');
    const {result} = renderHook(() => useSidebar(), {wrapper});
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('persists toggle to localStorage', () => {
    const {result} = renderHook(() => useSidebar(), {wrapper});
    act(() => result.current.toggleSidebar());
    expect(localStorage.getItem('prumo:sidebar:collapsed')).toBe('true');
    act(() => result.current.toggleSidebar());
    expect(localStorage.getItem('prumo:sidebar:collapsed')).toBe('false');
  });

  it('falls back to default when stored collapsed is invalid', () => {
    localStorage.setItem('prumo:sidebar:collapsed', 'garbage');
    const {result} = renderHook(() => useSidebar(), {wrapper});
    expect(result.current.sidebarCollapsed).toBe(false);
  });

  describe('view-scoped (persist=false)', () => {
    const viewScoped = ({children}: {children: React.ReactNode}) => (
      <SidebarProvider defaultCollapsed persist={false}>
        {children}
      </SidebarProvider>
    );

    it('ignores the stored baseline and starts at defaultCollapsed', () => {
      localStorage.setItem('prumo:sidebar:collapsed', 'false');
      const {result} = renderHook(() => useSidebar(), {wrapper: viewScoped});
      expect(result.current.sidebarCollapsed).toBe(true);
    });

    it('does not write the baseline key when toggled', () => {
      const {result} = renderHook(() => useSidebar(), {wrapper: viewScoped});
      act(() => result.current.toggleSidebar());
      expect(result.current.sidebarCollapsed).toBe(false);
      expect(localStorage.getItem('prumo:sidebar:collapsed')).toBeNull();
    });

    it('does not write the baseline key on mount', () => {
      renderHook(() => useSidebar(), {wrapper: viewScoped});
      expect(localStorage.getItem('prumo:sidebar:collapsed')).toBeNull();
    });
  });
});
