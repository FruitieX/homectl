import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

const themeAtom = atomWithStorage<ThemeMode>('homectl-theme', 'auto');

const getSystemPrefersDark = (): boolean => {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const getEffectiveTheme = (mode: ThemeMode): 'light' | 'dark' => {
  if (mode === 'auto') {
    return getSystemPrefersDark() ? 'dark' : 'light';
  }
  return mode;
};

const applyTheme = (mode: ThemeMode) => {
  const effectiveTheme = getEffectiveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle('dark', effectiveTheme === 'dark');
};

export const useTheme = () => {
  const [themeMode, setThemeModeRaw] = useAtom(themeAtom);

  // Wrap setThemeMode to also apply theme immediately
  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeRaw(mode);
      applyTheme(mode);
    },
    [setThemeModeRaw],
  );

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (themeMode !== 'auto') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme('auto');

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  return [themeMode, setThemeMode] as const;
};

// Hook to apply theme early (used in providers)
export const useApplyTheme = () => {
  const [themeMode] = useAtom(themeAtom);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);
};
