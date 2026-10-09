import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Check,
  Gift,
  LayoutDashboard,
  Workflow,
} from 'lucide-react';
import { getHomepagePlans, formatPlanInterval, formatPlanPrice } from '@/lib/plan-catalog';
import { DEMO_VIDEO_EMBED_URL } from '@/lib/demo-video';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { PartnerMarquee } from '@/components/marketing/partner-marquee';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useLocale, useT } from '@/hooks/use-t';

const weekBars = [38, 52, 46, 68, 74, 92, 64];

const weekDaysFr = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const weekDaysEn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const heroStatValues: Record<string, string> = {
  merchantRating: '4.9/5',
  avgUplift: '32%',
  campaignVisibility: '24/7',
};

export default function Home() {
  const t = useT();
  const locale = useLocale();
  const weekDays = locale === 'fr' ? weekDaysFr : weekDaysEn;

  // Arriving with a #demo hash (e.g. right after sign-out): the browser's own
  // fragment scroll fires before this SPA renders, so re-run it once the
  // section actually exists.
  useEffect(() => {
    if (window.location.hash !== '#demo') return;
    const target = document.getElementById('demo');
    if (!target) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const features = [
    { title: t.landing.featureOrchestrationTitle, description: t.landing.featureOrchestrationBody, icon: Workflow },
    { title: t.landing.featureIntelligenceTitle, description: t.landing.featureIntelligenceBody, icon: BarChart3 },
    { title: t.landing.featureAutomationTitle, description: t.landing.featureAutomationBody, icon: Gift },
  ];

  const steps = [
    t.landing.stepWorkspace,
    t.landing.stepFlow,
    t.landing.stepLaunch,
    t.landing.stepMeasure,
  ];

  const heroStats = (['merchantRating', 'avgUplift', 'campaignVisibility'] as const).map((key) => ({
    value: heroStatValues[key],
    label: t.landing[key],
  }));

  return (
    <main className="relative min-h-screen bg-surface text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] overflow-hidden">
        <div className="dw-grid-fade absolute inset-0" />
        <div className="absolute -top-56 left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="absolute -top-24 right-[6%] h-[22rem] w-[22rem] rounded-full bg-brand-500/15 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
          <DawerLogo className="h-8 w-auto" />

          <nav className="hidden items-center gap-7 md:flex">
            <a href="#features" className="text-[13.5px] font-medium text-ink-muted transition-colors duration-180 ease-swift hover:text-ink">
              {t.landing.navFeatures}
            </a>
            <a href="#workflow" className="text-[13.5px] font-medium text-ink-muted transition-colors duration-180 ease-swift hover:text-ink">
              {t.landing.navWorkflow}
            </a>
            <a href="#pricing" className="text-[13.5px] font-medium text-ink-muted transition-colors duration-180 ease-swift hover:text-ink">
              {t.landing.navPricing}
            </a>
            <Link to="/privacy" className="text-[13.5px] font-medium text-ink-muted transition-colors duration-180 ease-swift hover:text-ink">
              {t.landing.navPrivacy}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth/login">{t.auth.signIn}</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="animate-slide-up">
            <Badge tone="brand" size="sm">
              {t.landing.heroBadge}
            </Badge>

            <h1 className="mt-6 max-w-2xl text-balance text-[2.4rem] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-[3.3rem]">
              {t.landing.heroTitle}
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-[15px] leading-relaxed text-ink-muted sm:text-[17px]">
              {t.landing.heroSubtitle}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild variant="outline" size="lg">
                {/* In-page anchor: the global smooth scroll (globals.css) takes
                    the visitor straight to the demo video, same pattern as the
                    #features / #workflow / #pricing nav links. */}
                <a href="#demo">{t.landing.viewDemo}</a>
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-6">
              {heroStats.map((stat) => (
                <p key={stat.label} className="text-[13px] text-ink-muted">
                  <span className="numeric text-[15px] font-semibold tracking-[-0.02em] text-ink">{stat.value}</span>{' '}
                  {stat.label}
                </p>
              ))}
            </div>
          </div>

          <div className="relative animate-fade-in">
            <div aria-hidden className="pointer-events-none absolute -inset-5 rounded-[2.25rem] bg-brand-400/20 blur-3xl" />

            <Card className="relative overflow-hidden">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-24 h-44 bg-[radial-gradient(70%_100%_at_50%_0%,rgb(125_171_75/0.22),transparent_70%)]"
              />

              <div className="relative flex items-center gap-2.5 border-b border-line px-5 py-3.5">
                <LayoutDashboard aria-hidden className="h-4 w-4 text-brand-600 dark:text-accent-bright" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{t.landing.liveOverview}</p>
                <Badge tone="success" size="sm" dot className="ml-auto">
                  {t.common.active}
                </Badge>
              </div>

              <div className="relative space-y-4 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">{t.landing.sampleCampaign}</h2>
                  <p className="text-[12px] text-ink-subtle">{t.landing.sampleDates}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-elevated p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.customers}</p>
                    <p className="numeric mt-2 text-[26px] font-semibold tracking-[-0.03em] text-ink">1,247</p>
                    <p className="mt-1.5 text-[12.5px] font-medium text-success-600 dark:text-success-300">
                      {t.landing.monthDelta}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line bg-elevated p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.rewardsIssued}</p>
                    <p className="numeric mt-2 text-[26px] font-semibold tracking-[-0.03em] text-ink">284</p>
                    <p className="mt-1.5 text-[12.5px] font-medium text-brand-700 dark:text-accent-bright">
                      {t.landing.redemptionRate}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-elevated p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12.5px] font-medium text-ink-muted">{t.landing.scansThisWeek}</p>
                    <Badge tone="brand" size="sm">
                      +18.4%
                    </Badge>
                  </div>
                  <div aria-hidden className="mt-4 flex h-16 items-end gap-2">
                    {weekBars.map((value, index) => (
                      <span
                        key={value}
                        style={{ height: `${value}%`, animationDelay: `${index * 60}ms` }}
                        className="flex-1 animate-slide-up rounded-t-sm bg-brand-500/25 last:bg-brand-500 motion-reduce:animate-none"
                      />
                    ))}
                  </div>
                  <div aria-hidden className="mt-2 flex gap-2 text-[10px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
                    {weekDays.map((day, index) => (
                      <span key={`${day}-${index}`} className="flex-1 text-center">
                        {day}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-elevated p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[12.5px] font-medium text-ink-muted">{t.landing.campaignConversion}</p>
                    <span className="numeric text-[13px] font-semibold text-ink">68.5%</span>
                  </div>
                  <Progress value={68} label={t.landing.campaignConversion} />
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.qrScans}</p>
                      <p className="numeric mt-1 text-[14px] font-semibold text-ink">3.2k</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.starts}</p>
                      <p className="numeric mt-1 text-[14px] font-semibold text-ink">1.1k</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.redeems}</p>
                      <p className="numeric mt-1 text-[14px] font-semibold text-ink">420</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <PartnerMarquee />

      <section id="features" className="relative border-y border-line bg-surface-2 scroll-mt-20">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
              {t.landing.whyUs}
            </p>
            <h2 className="mt-3 text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              {t.landing.featuresTitle}
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {features.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="bg-elevated p-6">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-brand-700 dark:text-accent-bright">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <CardTitle className="mt-5">{title}</CardTitle>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="relative scroll-mt-20">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
              {t.landing.howItWorks}
            </p>
            <h2 className="mt-3 text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              {t.landing.workflowTitle}
            </h2>
          </div>

          <ol className="mt-12 grid gap-5 md:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step} className="h-full">
                <Card className="h-full p-6">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-brand-700 dark:text-accent-bright">
                    0{index + 1}
                  </span>
                  <p className="mt-4 text-[14.5px] font-medium leading-snug text-ink">{step}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="demo" className="relative border-t border-line scroll-mt-20">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
              {t.landing.demoEyebrow}
            </p>
            <h2 className="mt-3 text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              {t.landing.demoTitle}
            </h2>
          </div>

          <div className="relative mx-auto mt-10 w-full max-w-5xl">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-brand-400/15 blur-3xl"
            />
            <div className="relative overflow-hidden rounded-2xl border border-line bg-elevated shadow-card">
              <div className="relative aspect-video w-full">
                <iframe
                  className="absolute inset-0 h-full w-full border-0"
                  src={DEMO_VIDEO_EMBED_URL}
                  title={t.landing.demoVideoTitle}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="relative border-y border-line bg-surface-2 scroll-mt-20">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
                {t.landing.pricingEyebrow}
              </p>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
                {t.landing.pricingTitle}
              </h2>
            </div>
            <p className="max-w-md text-pretty text-[13.5px] leading-relaxed text-ink-muted">
              {t.landing.pricingSubtitle}
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {getHomepagePlans(locale).map((plan) => {
              const featured = plan.slug === 'growth';
              const badge = plan.badge;
              return (
                <div key={plan.slug} className="relative h-full">
                  {featured ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-2.5 rounded-2xl bg-brand-400/20 blur-2xl"
                    />
                  ) : null}

                  <Card
                    className={cn(
                      'relative flex h-full min-w-0 flex-col p-6',
                      featured && 'bg-elevated',
                    )}
                  >
                    <div className="flex min-h-[24px] items-start">
                      {badge ? (
                        <Badge tone={featured ? 'brand' : 'outline'} size="sm" uppercase>
                          {badge}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.landing.planLabel}</p>
                    <h3 className="mt-1.5 text-[17px] font-semibold tracking-[-0.02em] text-ink">{plan.name}</h3>

                    <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          'numeric text-[32px] font-semibold tracking-[-0.03em] text-ink',
                          featured && 'text-brand-700 dark:text-accent-bright',
                        )}
                      >
                        {formatPlanPrice(plan.priceCents)}
                      </span>
                      <span className="text-[13px] text-ink-subtle">/ {formatPlanInterval(plan.interval, locale)}</span>
                    </p>

                    <ul className="mt-6 flex-1 space-y-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-muted">
                          <Check
                            aria-hidden
                            className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-accent-bright"
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button asChild className="mt-7 w-full" variant={featured ? 'primary' : 'outline'}>
                      <Link to="/auth/register">
                        {t.landing.trialCta}
                        <ArrowRight aria-hidden className="h-4 w-4" />
                      </Link>
                    </Button>

                    <p className="mt-3 text-center text-[12px] text-ink-subtle">
                      {plan.slug === 'scale' ? t.landing.scaleNote : t.landing.cancelNote}
                    </p>
                  </Card>

                  {featured ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-xl border-2 border-brand-500"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="relative bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <DawerLogo className="h-8 w-auto" />
            <p className="text-[13px] text-ink-subtle">© 2026 dawer</p>
          </div>
          <Link
            to="/privacy"
            className="text-[13px] font-medium text-ink-muted transition-colors duration-180 ease-swift hover:text-ink"
          >
            {t.landing.privacyLink}
          </Link>
        </div>
      </footer>
    </main>
  );
}
