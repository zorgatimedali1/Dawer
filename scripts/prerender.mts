import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import { createContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { blogArticles } from '../src/content/blog';
import { translations, type Locale } from '../src/lib/i18n';
import {
  articleSchema,
  faqPageSchema,
  hreflangLinks,
  localBusinessSchema,
  organizationSchema,
  SITE_NAME,
  softwareApplicationSchema,
} from '../src/lib/seo';
import { getHomepagePlans } from '../src/lib/plan-catalog';
import type { ComponentType, ReactElement } from 'react';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST_CLIENT = path.join(ROOT, 'dist', 'client');
const APP_CONTEXT_URL = pathToFileURL(path.join(ROOT, 'src', 'contexts', 'app-context.tsx')).href;

type GlobalBag = Record<string, unknown>;
const globals = globalThis as unknown as GlobalBag;

const memoryStorage = {
  length: 0,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
};
const mediaQuery = () => ({
  matches: false,
  media: '',
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});

class StubIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

globals.localStorage ??= memoryStorage;
globals.matchMedia ??= mediaQuery;
globals.requestAnimationFrame ??= (((cb: (time: number) => void) => {
  cb(0);
  return 1;
}) as unknown) as (callback: (time: number) => void) => number;
globals.cancelAnimationFrame ??= () => undefined;
globals.IntersectionObserver ??= StubIntersectionObserver;
globals.window ??= {
  localStorage: memoryStorage,
  history: { replaceState: () => undefined, scrollRestoration: 'manual' },
  location: { pathname: '/', search: '', hash: '' },
  matchMedia: mediaQuery,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  requestAnimationFrame: globals.requestAnimationFrame,
  cancelAnimationFrame: globals.cancelAnimationFrame,
};
globals.__DAWER_PRERENDER_ENV__ ??= { MODE: 'production', VITE_API_URL: '/api' };

type PrerenderAppValue = {
  theme: 'light' | 'dark';
  locale: Locale;
  user: null;
  isAuthenticated: boolean;
  sessionStatus: 'checking' | 'ready';
  setTheme: () => void;
  setLocale: () => void;
  login: () => void;
  logout: () => Promise<void>;
};

const prerenderAppContext = createContext<PrerenderAppValue | undefined>(undefined);
globals.__DAWER_PRERENDER_CONTEXT__ = prerenderAppContext;

const LOADER_SOURCE = `
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const TARGET = ${JSON.stringify(APP_CONTEXT_URL)};
const PUBLIC_DIR = ${JSON.stringify(path.join(ROOT, 'public'))};
const CODE_FILE = /\\.(?:tsx?|mts|cts)$/;
const ASSET_FILE = /\\.(?:png|jpe?g|webp|svg|gif|ico|css|woff2?|ttf)$/;
function toText(source) {
  if (typeof source === 'string') return source;
  return new TextDecoder().decode(source);
}
function publicAssetUrl(url) {
  try {
    const filePath = fileURLToPath(url);
    const base = path.basename(filePath);
    if (existsSync(path.join(PUBLIC_DIR, base))) return '/' + base;
  } catch {}
  return url;
}
export async function load(url, context, nextLoad) {
  const clean = url.split('?')[0].split('#')[0];
  if (ASSET_FILE.test(clean)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default ' + JSON.stringify(publicAssetUrl(clean)) + ';',
    };
  }
  const result = await nextLoad(url, context);
  if (!result || result.source === undefined || result.source === null) return result;
  const text = toText(result.source);
  if (clean === TARGET) {
    const patched = text.replace(
      /((?:const|var|let)\\s+AppContext\\s*=\\s*)([^;\\n]+);/,
      '$1(globalThis.__DAWER_PRERENDER_CONTEXT__ ?? $2);',
    );
    if (patched !== text) console.log('[prerender] src/contexts/app-context patched: AppContext bound to prerender context');
    return { ...result, source: patched, shortCircuit: true };
  }
  if (CODE_FILE.test(clean) && text.includes('import.meta.env')) {
    const patched = text.replaceAll('import.meta.env', '__DAWER_PRERENDER_ENV__');
    return { ...result, source: patched, shortCircuit: true };
  }
  return result;
}
`;

register(`data:text/javascript;charset=utf-8,${encodeURIComponent(LOADER_SOURCE)}`, {
  parentURL: pathToFileURL(import.meta.filename).href,
});

type PageKind = 'home' | 'privacy' | 'blog-list' | 'article';

interface RouteSpec {
  kind: PageKind;
  frPath: string;
  enPath: string;
  slug?: string;
}

type BlogLandingStrings = Readonly<Record<string, string | undefined>>;

function buildFaqs(locale: Locale): { question: string; answer: string }[] {
  const landing = translations[locale].landing as unknown as BlogLandingStrings;
  const faqs: { question: string; answer: string }[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const question = landing[`faqQ${index}`];
    const answer = landing[`faqA${index}`];
    if (typeof question === 'string' && typeof answer === 'string') {
      faqs.push({ question, answer });
    }
  }
  return faqs;
}

function homepageJsonLd(locale: Locale): unknown {
  const items: unknown[] = [
    organizationSchema(),
    localBusinessSchema(),
    softwareApplicationSchema(getHomepagePlans(locale)),
  ];
  const faqs = buildFaqs(locale);
  if (faqs.length > 0) items.push(faqPageSchema(faqs));
  return { '@context': 'https://schema.org', '@graph': items };
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/[.\u3002\uff61]+$/, '').trim();
}

function metaFor(kind: PageKind, locale: Locale, slug: string | undefined): { title: string; description: string } | null {
  const t = translations[locale];
  switch (kind) {
    case 'home':
      return {
        title: stripTrailingPeriod(t.landing.heroTitle),
        description: t.landing.heroSubtitle,
      };
    case 'privacy':
      return {
        title: `${t.privacy.title} | ${SITE_NAME}`,
        description: t.privacy.introP1,
      };
    case 'blog-list':
      return {
        title: `Blog | ${SITE_NAME}`,
        description:
          locale === 'en'
            ? 'Tips and field notes for merchants: in-store loyalty, contact acquisition and local marketing.'
            : 'Conseils et repères pour les commerçants : fidélisation en boutique, collecte de contacts et marketing de proximité.',
      };
    case 'article': {
      const article = blogArticles.find((entry) => entry.slug === slug);
      if (!article) return null;
      return {
        title: `${article.title[locale]} | ${SITE_NAME}`,
        description: article.metaDescription[locale],
      };
    }
  }
}

function jsonLdFor(kind: PageKind, locale: Locale, slug: string | undefined): unknown {
  switch (kind) {
    case 'home':
      return homepageJsonLd(locale);
    case 'article': {
      const article = blogArticles.find((entry) => entry.slug === slug);
      if (!article) return organizationSchema();
      return articleSchema({
        slug: article.slug,
        title: article.title[locale],
        description: article.metaDescription[locale],
        published: article.published,
        locale,
      });
    }
    default:
      return organizationSchema();
  }
}

const AMP_ENTITY = '&' + 'amp;';
const LT_ENTITY = '&' + 'lt;';
const GT_ENTITY = '&' + 'gt;';
const QUOTE_ENTITY = '&' + 'quot;';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, AMP_ENTITY)
    .replace(/</g, LT_ENTITY)
    .replace(/>/g, GT_ENTITY)
    .replace(/"/g, QUOTE_ENTITY);
}

function headBlock(
  locale: Locale,
  frPath: string,
  enPath: string,
  kind: PageKind,
  slug: string | undefined,
): string {
  const meta = metaFor(kind, locale, slug);
  if (!meta) throw new Error(`no metadata resolved for ${kind} ${slug ?? frPath}`);
  const links = hreflangLinks(frPath, enPath);
  const canonical = locale === 'en' ? links[1]?.href : links[0]?.href;
  if (!canonical) throw new Error(`hreflang links missing for ${frPath}`);
  const jsonText = JSON.stringify(jsonLdFor(kind, locale, slug)).replace(/<\//g, '<\\/');
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    ...links.map(
      (link) => `<link rel="alternate" hreflang="${link.hreflang}" href="${escapeHtml(link.href)}" />`,
    ),
    `<script type="application/ld+json">${jsonText}</script>`,
  ].join('\n    ');
}

function outputPathFor(urlPath: string): string {
  const segments = urlPath === '/' ? [] : urlPath.replace(/^\/+/, '').split('/');
  return path.join(DIST_CLIENT, ...segments, 'index.html');
}

async function main(): Promise<void> {
  const templatePath = path.join(DIST_CLIENT, 'index.html');
  const templateRaw = await readFile(templatePath, 'utf8');

  const shell = templateRaw
    .replace(/<title[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']alternate["'][^>]*>/gi, '')
    .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');

  const [{ default: Home }, { default: PrivacyPage }, { default: BlogListPage }, { default: BlogArticlePage }] =
    await Promise.all([
      import('../src/app/page'),
      import('../src/app/privacy/page'),
      import('../src/app/blog/page'),
      import('../src/app/blog/[slug]/page'),
    ]);

  const homeRoute: RouteSpec = { kind: 'home', frPath: '/', enPath: '/en' };
  const privacyRoute: RouteSpec = { kind: 'privacy', frPath: '/privacy', enPath: '/en/privacy' };
  const blogRoute: RouteSpec = { kind: 'blog-list', frPath: '/blog', enPath: '/en/blog' };
  const articleRoutes: RouteSpec[] = blogArticles.map((article) => ({
    kind: 'article',
    frPath: `/blog/${article.slug}`,
    enPath: `/en/blog/${article.slug}`,
    slug: article.slug,
  }));

  const jobs: { spec: RouteSpec; locale: Locale; pattern: string; component: ComponentType }[] = [
    { spec: homeRoute, locale: 'fr', pattern: '/', component: Home },
    { spec: homeRoute, locale: 'en', pattern: '/en', component: Home },
    { spec: privacyRoute, locale: 'fr', pattern: '/privacy', component: PrivacyPage },
    { spec: privacyRoute, locale: 'en', pattern: '/en/privacy', component: PrivacyPage },
    { spec: blogRoute, locale: 'fr', pattern: '/blog', component: BlogListPage },
    { spec: blogRoute, locale: 'en', pattern: '/en/blog', component: BlogListPage },
    ...articleRoutes.flatMap((spec) => [
      { spec, locale: 'fr' as Locale, pattern: '/blog/:slug', component: BlogArticlePage as ComponentType },
      { spec, locale: 'en' as Locale, pattern: '/en/blog/:slug', component: BlogArticlePage as unknown as ComponentType },
    ]),
  ];

  let written = 0;
  const failures: string[] = [];

  for (const job of jobs) {
    const { spec, locale, pattern, component } = job;
    const urlPath = locale === 'en' ? spec.enPath : spec.frPath;
    try {
      const value: PrerenderAppValue = {
        theme: 'light',
        locale,
        user: null,
        isAuthenticated: false,
        sessionStatus: 'ready',
        setTheme: () => undefined,
        setLocale: () => undefined,
        login: () => undefined,
        logout: async () => undefined,
      };

      const markup = renderToStaticMarkup(
        h(
          MemoryRouter,
          { initialEntries: [urlPath] },
          h(
            prerenderAppContext.Provider,
            { value },
            h(Routes, null, h(Route, { path: pattern, element: h(component) as ReactElement })),
          ),
        ),
      );

      const head = headBlock(locale, spec.frPath, spec.enPath, spec.kind, spec.slug);

      let html = shell.replace(/<html([^>]*)>/i, `<html lang="${locale}" dir="ltr">`);
      html = html.replace(/(<head[^>]*>)/i, `$1\n    ${head}`);
      if (/<div\s+id="root"[^>]*>\s*<\/div>/i.test(html)) {
        html = html.replace(/<div\s+id="root"[^>]*>\s*<\/div>/i, `<div id="root">${markup}</div>`);
      } else {
        const replaced = html.replace(/(<div\s+id="root"[^>]*>)[\s\S]*?(<\/div>\s*)/i, `$1${markup}$2`);
        if (replaced === html) throw new Error('root div not found in emitted index.html');
        html = replaced;
      }

      const outPath = outputPathFor(urlPath);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, html, 'utf8');
      written += 1;
      console.log(`[prerender] ${urlPath} (${locale}) -> ${path.relative(ROOT, outPath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${urlPath}: ${message}`);
      console.warn(`[prerender] SKIPPED ${urlPath}: ${message}`);
    }
  }

  console.log(`[prerender] finished: ${written}/${jobs.length} pages written, ${failures.length} skipped`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
