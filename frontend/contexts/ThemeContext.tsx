/**
 * App-wide theme: light / dark / system, persisted under `prumo:theme` and
 * applied as the `dark` class on <html> (Tailwind's `@custom-variant dark`).
 *
 * index.html carries an inline script that applies the same class before
 * first paint, so a reload never flashes the light theme; this provider owns
 * the class from then on (toggle, OS preference changes, other tabs).
 */
import {createContext, ReactNode, useContext, useEffect, useState} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'prumo:theme';
const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextType {
  theme: ThemeMode;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function isThemeMode(value: string | null): value is ThemeMode {
  return MODES.includes(value as ThemeMode);
}

function readInitialTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

function resolveDark(theme: ThemeMode): boolean {
  if (theme !== 'system') return theme === 'dark';
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

function applyTheme(theme: ThemeMode): void {
  const dark = resolveDark(theme);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Swap the theme with every CSS transition suppressed for one frame, so
 * elements with `transition-colors` don't each fade at their own pace.
 */
function applyThemeWithoutTransitions(theme: ThemeMode): void {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  applyTheme(theme);
  // Force a style flush so the rule takes effect before it is removed.
  window.getComputedStyle(document.body);
  setTimeout(() => style.remove(), 1);
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  // Re-applies on mount and after every change (idempotent); while on
  // `system`, follows the OS preference live.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && isThemeMode(e.newValue)) setTheme(e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const cycle = () => {
    const next = MODES[(MODES.indexOf(theme) + 1) % MODES.length];
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    applyThemeWithoutTransitions(next);
    setTheme(next);
  };

  return <ThemeContext.Provider value={{theme, cycle}}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
