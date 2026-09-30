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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [locale, setLocaleState] = useState<Locale>('fr');
  const [user, setUser] = useState<UserSession | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('campaign-engage-theme') as ThemeMode | null;
    const savedLocale = window.localStorage.getItem('campaign-engage-locale') as Locale | null;
    const savedAuth = window.localStorage.getItem('campaign-engage-auth');

    if (savedTheme === 'light' || savedTheme === 'dark') {
      setThemeState(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeState(prefersDark ? 'dark' : 'light');
    }

    if (savedLocale === 'fr' || savedLocale === 'en') {
      setLocaleState(savedLocale);
    }

    if (savedAuth) {
      try {
        const parsedAuth = JSON.parse(savedAuth) as AuthResponse;
        setUser(parsedAuth.user);
      } catch {
        window.localStorage.removeItem('campaign-engage-auth');
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('campaign-engage-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem('campaign-engage-locale', locale);
  }, [locale]);

  const login = (response: AuthResponse) => {
    const nextUser = response.user;
    setUser(nextUser);
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify(response));
  };

  const logout = () => {
    const savedAuth = window.localStorage.getItem('campaign-engage-auth');
    if (savedAuth) {
      try {
        const { token } = JSON.parse(savedAuth) as AuthResponse;
        void AuthService.logout(token).catch(() => undefined);
      } catch {
        window.localStorage.removeItem('campaign-engage-auth');
      }
    }
    setUser(null);
    window.localStorage.removeItem('campaign-engage-auth');
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
