'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BillingService, type BillingState } from '@/services/billing.service';
import { openWhatsApp } from '@/lib/whatsapp';
import { getPlanMarketing, formatPlanInterval, formatPlanPrice } from '@/lib/plan-catalog';
import { interpolate, msg } from '@/lib/i18n';
import { useLocale, useT } from '@/hooks/use-t';

function limitLabel(value: number, unlimited: string): string {
  return value < 0 ? unlimited : String(value);
}

export default function PricingPage() {
  const t = useT();
  const locale = useLocale();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBilling(await BillingService.get());
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to load the plans.'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async (slug: string) => {
    setBusy(slug);
    setError('');
    try {
      const request = await BillingService.subscribeRequest(slug);
      openWhatsApp(request.whatsappUrl);
      await load();
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to send the request.'));
    } finally {
      setBusy(null);
    }
  };

  if (error && !billing) {
    return (
      <div className="space-y-6">
        <p className="text-sm font-medium text-danger-600 dark:text-danger-300">{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            setError('');
            void load();
          }}
        >
          {t.common.retry}
        </Button>
      </div>
    );
  }

  if (!billing) {
    return <p className="text-sm text-ink-subtle">{t.pricing.loadingPlans}</p>;
  }

  const currentSlug = billing.subscription?.plan.slug ?? null;
  const pendingSlug = billing.pendingRequest?.plan.slug ?? null;
  const planMarketing = getPlanMarketing(locale);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-600 dark:text-accent-bright">{t.pricing.eyebrow}</p>
        <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.025em] text-ink sm:text-[26px]">
          {t.pricing.title}
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          {t.pricing.subtitle}
        </p>
        {error && <p className="mt-2 text-sm font-medium text-danger-600 dark:text-danger-300">{error}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        {billing.plans.map((plan) => {
          const isCurrent = plan.slug === currentSlug;
          const isPending = plan.slug === pendingSlug;
          const marketing = planMarketing[plan.slug];
          const isFeatured = plan.slug === 'growth';

          return (
            <div
              key={plan.slug}
              className={`rounded-3xl border p-6 shadow-soft ${
                isFeatured
                  ? 'border-accent/50 bg-accent-soft dark:border-accent/40 dark:bg-accent-soft'
                  : 'border-line bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-ink">{plan.name}</h3>
                {marketing?.badge && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      isFeatured ? 'bg-brand-500 text-accent-ink' : 'bg-ink/[0.06] text-ink-muted'
                    }`}
                  >
                    {marketing.badge}
                  </span>
                )}
              </div>

              <div className="mt-5 flex items-end gap-2">
                <span className="numeric text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {formatPlanPrice(plan.priceCents)}
                </span>
                <span className="pb-1 text-sm text-ink-subtle">
                  /{formatPlanInterval(plan.interval, locale)}
                </span>
              </div>

              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">
                {marketing?.description ?? t.pricing.planFallback}
              </p>

              <ul className="mt-5 space-y-3 text-[13.5px] text-ink">
                <li className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {interpolate(t.pricing.campaign, {
                    count: limitLabel(plan.features.limits.campaigns, t.pricing.unlimited),
                    s: plan.features.limits.campaigns === 1 ? '' : 's',
                  })}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {interpolate(t.pricing.customers, {
                    count: limitLabel(plan.features.limits.customers, t.pricing.unlimited),
                  })}
                </li>
                {plan.features.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                className="mt-6 w-full"
                variant={isCurrent ? 'outline' : 'default'}
                disabled={busy !== null || isCurrent || isPending}
                onClick={() => void buy(plan.slug)}
              >
                {isCurrent ? t.pricing.currentPlan : isPending ? t.pricing.requestSent : t.pricing.buy}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
