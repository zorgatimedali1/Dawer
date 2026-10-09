import {
  CalendarDays,
  Clock3,
  Database,
  LockKeyhole,
  Network,
  Shield,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { useT } from '@/hooks/use-t';

interface PrivacySection {
  title: string;
  icon: LucideIcon;
  paragraphs?: string[];
  bullets?: string[];
  contact?: string;
}

export default function PrivacyPage() {
  const t = useT();
  const p = t.privacy;

  const sections: PrivacySection[] = [
    {
      title: p.introTitle,
      icon: Shield,
      paragraphs: [p.introP1],
    },
    {
      title: p.collectedTitle,
      icon: Database,
      bullets: [p.collectedB1, p.collectedB2, p.collectedB3, p.collectedB4],
    },
    {
      title: p.usageTitle,
      icon: Clock3,
      bullets: [p.usageB1, p.usageB2, p.usageB3, p.usageB4, p.usageB5],
    },
    {
      title: p.sharingTitle,
      icon: Network,
      paragraphs: [p.sharingP1],
    },
    {
      title: p.retentionTitle,
      icon: CalendarDays,
      paragraphs: [p.retentionP1],
    },
    {
      title: p.rightsTitle,
      icon: UserRound,
      paragraphs: [p.rightsP1],
      contact: p.contact,
    },
    {
      title: p.securityTitle,
      icon: LockKeyhole,
      paragraphs: [p.securityP1],
    },
  ];

  return (
    <main className="relative min-h-screen bg-surface text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="dw-grid-fade absolute inset-0" />
        <div className="absolute -top-48 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <header className="mb-10 border-b border-line pb-8">
          <DawerLogo className="h-8 w-auto" />
          <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
            {p.eyebrow}
          </p>
          <h1 className="mt-3 text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[38px]">
            {p.title}
          </h1>
          <p className="mt-4 text-[13px] text-ink-subtle">{p.updated}</p>
        </header>

        <div className="space-y-12">
          {sections.map(({ title, icon: Icon, paragraphs, bullets, contact }) => (
            <section key={title} className="scroll-mt-24">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-brand-700 dark:text-accent-bright">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
              </div>

              {paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-3.5 text-pretty text-[15px] leading-[1.75] text-ink-muted">
                  {paragraph}{' '}
                  {contact && (
                    <a
                      href={`mailto:${contact}`}
                      className="font-medium text-brand-700 underline decoration-brand-500/40 underline-offset-4 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
                    >
                      {contact}
                    </a>
                  )}
                </p>
              ))}

              {bullets && (
                <ul className="mt-3.5 space-y-2.5">
                  {bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-[15px] leading-[1.7] text-ink-muted">
                      <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-12 border-t border-line pt-6 text-[13px] text-ink-muted">
          <a
            href="mailto:contact@dawer.com"
            className="font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
          >
            {p.contact}
          </a>
        </footer>
      </div>
    </main>
  );
}
