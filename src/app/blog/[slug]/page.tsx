import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3 } from 'lucide-react';
import { getArticle } from '@/content/blog';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { useLocale } from '@/hooks/use-t';

function formatDate(iso: string, locale: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}

export default function BlogArticlePage() {
  const locale = useLocale();
  const isEnglish = locale === 'en';
  const { slug } = useParams();
  const article = slug ? getArticle(slug) : undefined;

  if (!article) return <Navigate to={isEnglish ? '/en' : '/'} replace />;

  const body = isEnglish ? article.body.en : article.body.fr;
  const readMinutesLabel = isEnglish ? `${article.readMinutes} min read` : `${article.readMinutes} min de lecture`;

  return (
    <main className="relative min-h-screen bg-surface text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="dw-grid-fade absolute inset-0" />
        <div className="absolute -top-48 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl" />
      </div>

      <article className="relative mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <header className="border-b border-line pb-8">
          <Link to={isEnglish ? '/en' : '/'} className="inline-block">
            <DawerLogo className="h-8 w-auto" />
          </Link>
          <Link
            to={isEnglish ? '/en/blog' : '/blog'}
            className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {isEnglish ? 'Back to the blog' : 'Retour au blog'}
          </Link>
          <h1 className="mt-6 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[38px]">
            {isEnglish ? article.title.en : article.title.fr}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-subtle">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="h-4 w-4" />
              <time dateTime={article.published}>{formatDate(article.published, locale)}</time>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 aria-hidden className="h-4 w-4" />
              {readMinutesLabel}
            </span>
          </div>
        </header>

        <p className="mt-10 text-pretty text-[16.5px] leading-[1.75] text-ink">{body.intro}</p>

        {body.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.02em] text-ink">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-3.5 text-pretty text-[15px] leading-[1.75] text-ink-muted">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
