import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = 'https://dawer.tn';
const OUTPUT_PATH = path.resolve(process.cwd(), 'dist', 'client', 'sitemap.xml');

interface PageEntry {
  frPath: string;
  enPath: string;
  lastmod: string;
}

interface ArticleMeta {
  slug: string;
  lastmod: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toUrl(pathname: string): string {
  return `${SITE}${pathname}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function toIsoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return today();
  return parsed.toISOString().slice(0, 10);
}

async function loadArticles(): Promise<ArticleMeta[]> {
  const modulePath = process.env.BLOG_MODULE ?? 'src/content/blog.ts';
  try {
    const mod = await import(pathToFileURL(path.resolve(process.cwd(), modulePath)).href);
    const modRecord = toRecord(mod);
    const candidates = [modRecord?.['blogArticles'], modRecord?.['default']];
    for (const candidate of candidates) {
      const rawArticles = Array.isArray(candidate) ? candidate : toRecord(candidate)?.['blogArticles'];
      if (!Array.isArray(rawArticles)) continue;
      const articles: ArticleMeta[] = [];
      for (const rawArticle of rawArticles) {
        const record = toRecord(rawArticle);
        if (record === null) continue;
        const slug = readString(record, ['slug', 'id']);
        if (slug === null || !/^[a-z0-9-]+$/.test(slug)) continue;
        const published = readString(record, ['published', 'publishedAt', 'date']);
        articles.push({ slug, lastmod: published !== null ? toIsoDate(published) : today() });
      }
      return articles;
    }
    return [];
  } catch {
    return [];
  }
}

function renderUrl(loc: string, lastmod: string, frUrl: string, enUrl: string): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <xhtml:link rel="alternate" hreflang="fr" href="${escapeXml(frUrl)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enUrl)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(frUrl)}"/>`,
    '  </url>',
  ].join('\n');
}

async function main(): Promise<void> {
  const articles = await loadArticles();
  const fallback = articles.length === 0;

  const pages: PageEntry[] = [
    { frPath: '/', enPath: '/en', lastmod: today() },
    { frPath: '/privacy', enPath: '/en/privacy', lastmod: today() },
    { frPath: '/blog', enPath: '/en/blog', lastmod: today() },
    ...articles.map((article) => ({
      frPath: `/blog/${article.slug}`,
      enPath: `/en/blog/${article.slug}`,
      lastmod: article.lastmod,
    })),
  ];

  const urlEntries = pages.flatMap((page) => {
    const frUrl = toUrl(page.frPath);
    const enUrl = toUrl(page.enPath);
    return [renderUrl(frUrl, page.lastmod, frUrl, enUrl), renderUrl(enUrl, page.lastmod, frUrl, enUrl)];
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n');

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, xml, 'utf8');

  console.log(
    `sitemap.xml written to ${OUTPUT_PATH} ` +
      `(${urlEntries.length} URLs: ${pages.length} pages x 2 locales, ` +
      `${articles.length} blog articles${fallback ? ', blog module missing or empty -> static pages only' : ''})`,
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
