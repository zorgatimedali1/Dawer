export type PublicLocale = 'fr' | 'en';

const EN_PREFIX = '/en';

const PUBLIC_FR_PATHS = ['/', '/privacy', '/blog'];

export function localeFromPathname(pathname: string): PublicLocale {
  return pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`) ? 'en' : 'fr';
}

function isPublicFrPath(pathname: string): boolean {
  return PUBLIC_FR_PATHS.some(
    (path) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)),
  );
}

export function isPublicPathname(pathname: string): boolean {
  return localeFromPathname(pathname) === 'en' || isPublicFrPath(pathname);
}

export function withLocale(locale: PublicLocale, pathname: string): string {
  const stripped = pathname === EN_PREFIX ? '/' : pathname.startsWith(`${EN_PREFIX}/`) ? pathname.slice(EN_PREFIX.length) : pathname;
  if (!isPublicFrPath(stripped)) return locale === 'en' ? EN_PREFIX : '/';
  if (locale === 'en') return stripped === '/' ? EN_PREFIX : `${EN_PREFIX}${stripped}`;
  return stripped;
}
