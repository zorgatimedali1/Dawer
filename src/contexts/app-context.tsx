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
  logout: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

// v2 invalidates legacy values: the old key was auto-written from the OS
// colour scheme on first load, which locked dark-OS users into dark mode
// without them ever choosing it. Fresh state is always light now — dark is
// only persisted once the user explicitly switches.
const THEME_KEY = 'campaign-engage-theme-v2';
const LOCALE_KEY = 'campaign-engage-locale';
const AUTH_KEY = 'campaign-engage-auth';

function readStoredTheme(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'light';
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

  // The cached profile in localStorage can outlive the server session (3-day
  // TTL): revalidate the HttpOnly cookie once on bootstrap so a logged-out
  // visitor never keeps seeing "open dashboard" or passing the route guards.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    AuthService.revalidateSession()
      .then((fresh) => {
        if (cancelled) return;
        if (fresh) {
          setUser(fresh.user);
          window.localStorage.setItem(AUTH_KEY, JSON.stringify({ user: fresh.user }));
        } else {
          setUser(null);
          window.localStorage.removeItem(AUTH_KEY);
        }
      })
      .catch(() => undefined); // offline or transient failure — keep cached state
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

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
    // Only the profile is cached for guards — the session token stays inside
    // the HttpOnly cookie and is never written to storage (P1-1).
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ user: response.user }));
  };

  const logout = async () => {
    // Local state clears immediately; the caller can await the server-side
    // session revocation before navigating away (e.g. after sign-out).
    setUser(null);
    window.localStorage.removeItem(AUTH_KEY);
    await AuthService.logout().catch(() => undefined);
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

export function useOptionalAppContext(): AppContextValue | undefined {
  return useContext(AppContext);
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }

  return context;
}
