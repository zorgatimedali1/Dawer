'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { AuthService, type AuthResponse } from '@/services/auth.service';

type ThemeMode = 'light' | 'dark';
type UserSession = AuthResponse['user'];

type AppContextValue = {
  theme: ThemeMode;
  locale: Locale;
  user: UserSession | null;
  isAuthenticated: boolean;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  login: (response: AuthResponse) => void;
  logout: () => void;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

const THEME_KEY = 'campaign-engage-theme';
const LOCALE_KEY = 'campaign-engage-locale';
const AUTH_KEY = 'campaign-engage-auth';

function readStoredTheme(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredLocale(): Locale {
  const saved = window.localStorage.getItem(LOCALE_KEY);
  return saved === 'en' || saved === 'fr' ? saved : 'fr';
}

function readStoredUser(): UserSession | null {
  const saved = window.localStorage.getItem(AUTH_KEY);
  if (!saved) return null;

  try {
    const parsed = JSON.parse(saved) as AuthResponse;
    return parsed?.user ?? null;
  } catch {
    window.localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const [user, setUser] = useState<UserSession | null>(readStoredUser);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  const login = (response: AuthResponse) => {
    setUser(response.user);
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(response));
  };

  const logout = () => {
    const savedAuth = window.localStorage.getItem(AUTH_KEY);
    if (savedAuth) {
      try {
        const { token } = JSON.parse(savedAuth) as AuthResponse;
        if (token) void AuthService.logout(token).catch(() => undefined);
      } catch {
        // fall through and clear the stale payload
      }
    }
    setUser(null);
    window.localStorage.removeItem(AUTH_KEY);
  };

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      locale,
      user,
      isAuthenticated: !!user,
      setTheme: setThemeState,
      setLocale: setLocaleState,
      login,
      logout,
    }),
    [theme, locale, user],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }

  return context;
}
