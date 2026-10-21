'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { isPublicPathname, localeFromPathname } from '@/lib/locale-url';
import { useLocation } from 'react-router-dom';
import { AuthService, type AuthResponse } from '@/services/auth.service';

type ThemeMode = 'light' | 'dark';
type UserSession = AuthResponse['user'];
export type SessionStatus = 'checking' | 'ready';

type AppContextValue = {
  theme: ThemeMode;
  locale: Locale;
  user: UserSession | null;
  isAuthenticated: boolean;
  /** 'checking' while the bootstrap session revalidation is still in flight. */
  sessionStatus: SessionStatus;
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
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(() => (readStoredUser() ? 'checking' : 'ready'));

  // Bumped by login()/logout() so a still-in-flight bootstrap revalidation
  // can never resurrect a session the user already signed out of (or
  // overwrite a fresh login with a stale response).
  const sessionEpoch = useRef(0);

  // The cached profile in localStorage can outlive the server session (3-day
  // TTL): revalidate the HttpOnly cookie once on bootstrap so a logged-out
  // visitor never keeps seeing "open dashboard" or passing the route guards.
  useEffect(() => {
    if (!user) return undefined;
    const epoch = sessionEpoch.current;
    let cancelled = false;
    AuthService.revalidateSession()
      .then((fresh) => {
        if (cancelled || epoch !== sessionEpoch.current) return;
        if (fresh) {
          setUser(fresh.user);
          window.localStorage.setItem(AUTH_KEY, JSON.stringify({ user: fresh.user }));
        } else {
          setUser(null);
          window.localStorage.removeItem(AUTH_KEY);
        }
      })
      .catch(() => undefined) // offline or transient failure — keep cached state
      .finally(() => {
        if (!cancelled && epoch === sessionEpoch.current) setSessionStatus('ready');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Any /api 401 (http.ts) means the HttpOnly cookie is gone: drop the React
  // state too so the route guards redirect on the next render instead of
  // leaving the merchant stuck in a dashboard full of failing calls.
  useEffect(() => {
    const onSessionExpired = () => {
      sessionEpoch.current += 1;
      setUser(null);
      setSessionStatus('ready');
      window.localStorage.removeItem(AUTH_KEY);
    };
    window.addEventListener('session-expired', onSessionExpired);
    return () => window.removeEventListener('session-expired', onSessionExpired);
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
    sessionEpoch.current += 1;
    setUser(response.user);
    setSessionStatus('ready');
    // Only the profile is cached for guards — the session token stays inside
    // the HttpOnly cookie and is never written to storage (P1-1).
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ user: response.user }));
  };

  const logout = async () => {
    // Local state clears immediately; the caller can await the server-side
    // session revocation before navigating away (e.g. after sign-out).
    sessionEpoch.current += 1;
    setUser(null);
    setSessionStatus('ready');
    window.localStorage.removeItem(AUTH_KEY);
    await AuthService.logout().catch(() => undefined);
  };

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      locale,
      user,
      isAuthenticated: !!user,
      sessionStatus,
      setTheme: setThemeState,
      setLocale: setLocaleState,
      login,
      logout,
    }),
    [theme, locale, user, sessionStatus],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useOptionalAppContext(): AppContextValue | undefined {
  return useContext(AppContext);
}

// Mounted inside the router: on public marketing pages the URL prefix wins
// over the stored locale, so /en/* always renders (and persists) EN while
// / and /privacy resolve FR. Dashboard/auth pages keep localStorage control.
export function LocaleSync() {
  const { locale, setLocale } = useAppContext();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isPublicPathname(pathname)) return undefined;
    const urlLocale = localeFromPathname(pathname);
    if (urlLocale === locale) return undefined;
    setLocale(urlLocale);
    return undefined;
  }, [pathname, locale, setLocale]);

  return null;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }

  return context;
}
