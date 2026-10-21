import { Link } from 'react-router-dom';
import { ArrowRight, Clock3 } from 'lucide-react';
import { blogArticles, blogExcerpt } from '@/content/blog';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { useLocale } from '@/hooks/use-t';

function formatDate(iso: string, locale: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}

export default function BlogListPage() {
  const locale = useLocale();
  const articles = [...blogArticles].sort((a, b) => b.published.localeCompare(a.published));
  const hrefFor = (slug: string) => (locale === 'en' ? `/en/blog/${slug}` : `/blog/${slug}`);
  const readMinutesLabel = (minutes: number) => (locale === 'en' ? `${minutes} min read` : `${minutes} min de lecture`);

  return (
    <main className="relative min-h-screen bg-surface text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="dw-grid-fade absolute inset-0" />
        <div className="absolute -top-48 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <header className="mb-10 border-b border-line pb-8">
          <Link to={locale === 'en' ? '/en' : '/'} className="inline-block">
            <DawerLogo className="h-8 w-auto" />
          </Link>
          <h1 className="mt-8 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[38px]">
            Blog
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-ink-muted">
            {locale === 'en'
              ? 'Tips and field notes for merchants: in-store loyalty, contact acquisition and local marketing.'
              : 'Conseils et repères pour les commerçants : fidélisation en boutique, collecte de contacts et marketing de proximité.'}
          </p>
        </header>

        <div className="space-y-5">
          {articles.map((article) => (
            <Link
              key={article.slug}
              to={hrefFor(article.slug)}
              className="group block rounded-xl border border-line bg-card text-ink shadow-soft transition-[border-color,box-shadow,background-color,transform] duration-240 ease-swift hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:hover:translate-y-0"
            >
              <div className="p-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-subtle">
                  <time dateTime={article.published}>{formatDate(article.published, locale)}</time>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 aria-hidden className="h-3.5 w-3.5" />
                    {readMinutesLabel(article.readMinutes)}
                  </span>
                </div>
                <h2 className="mt-3 text-balance text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">
                  {locale === 'en' ? article.title.en : article.title.fr}
                </h2>
                <p className="mt-2.5 text-pretty text-[13.5px] leading-relaxed text-ink-muted">
                  {blogExcerpt(article, locale)}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 transition-colors duration-180 ease-swift group-hover:text-brand-800 dark:text-accent-bright dark:group-hover:text-brand-300">
                  {locale === 'en' ? 'Read the article' : 'Lire l’article'}
                  <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-180 ease-swift group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
