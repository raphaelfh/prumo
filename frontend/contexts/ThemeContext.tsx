/**
 * Re-exports next-themes provider with prumo defaults and a cycle helper.
 */
import React from 'react';
import {ThemeProvider as NextThemesProvider, useTheme as useNextTheme} from 'next-themes';

const STORAGE_KEY = 'prumo:theme';

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    storageKey={STORAGE_KEY}
    disableTransitionOnChange
  >
    {children}
  </NextThemesProvider>
);

export type ThemeMode = 'light' | 'dark' | 'system';

export function useTheme(): {theme: ThemeMode; cycle: () => void} {
  const {theme, setTheme} = useNextTheme();
  const current = (theme ?? 'system') as ThemeMode;
  const cycle = React.useCallback(() => {
    const next: ThemeMode = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [current, setTheme]);
  return {theme: current, cycle};
}
