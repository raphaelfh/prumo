import React from 'react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it, expect, beforeEach} from 'vitest';
import {act, render, renderHook} from '@testing-library/react';
import {ThemeProvider, useTheme} from './ThemeContext';

const wrapper = ({children}: {children: React.ReactNode}) => <ThemeProvider>{children}</ThemeProvider>;
const html = () => document.documentElement;

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    html().classList.remove('dark');
    html().style.colorScheme = '';
  });

  it('defaults to system when nothing is stored', () => {
    const {result} = renderHook(() => useTheme(), {wrapper});
    expect(result.current.theme).toBe('system');
    expect(html().classList.contains('dark')).toBe(false);
  });

  it('reads the stored mode and applies it to <html> on mount', () => {
    localStorage.setItem('prumo:theme', 'dark');
    const {result} = renderHook(() => useTheme(), {wrapper});
    expect(result.current.theme).toBe('dark');
    expect(html().classList.contains('dark')).toBe(true);
    expect(html().style.colorScheme).toBe('dark');
  });

  it('falls back to system when the stored value is invalid', () => {
    localStorage.setItem('prumo:theme', 'garbage');
    const {result} = renderHook(() => useTheme(), {wrapper});
    expect(result.current.theme).toBe('system');
  });

  it('cycles light → dark → system → light, persisting and applying each step', () => {
    localStorage.setItem('prumo:theme', 'light');
    const {result} = renderHook(() => useTheme(), {wrapper});

    act(() => result.current.cycle());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('prumo:theme')).toBe('dark');
    expect(html().classList.contains('dark')).toBe(true);

    act(() => result.current.cycle());
    expect(result.current.theme).toBe('system');
    expect(localStorage.getItem('prumo:theme')).toBe('system');
    // The test setup's matchMedia mock never matches, so system resolves light.
    expect(html().classList.contains('dark')).toBe(false);

    act(() => result.current.cycle());
    expect(result.current.theme).toBe('light');
  });

  it('follows a change made in another tab', () => {
    const {result} = renderHook(() => useTheme(), {wrapper});
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {key: 'prumo:theme', newValue: 'dark'}));
    });
    expect(result.current.theme).toBe('dark');
    expect(html().classList.contains('dark')).toBe(true);
  });

  it('renders no <script> (React 19.3 reports a client-rendered script as a console error)', () => {
    render(
      <ThemeProvider>
        <span>content</span>
      </ThemeProvider>,
    );
    expect(document.querySelector('script')).toBeNull();
  });

  it('index.html applies the same storage key before first paint', () => {
    // vitest runs from the repo root (vitest.config.ts lives there).
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(indexHtml).toContain("localStorage.getItem('prumo:theme')");
    expect(indexHtml).toContain("classList.add('dark')");
  });
});
