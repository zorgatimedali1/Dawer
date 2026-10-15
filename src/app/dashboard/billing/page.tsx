import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { BillingService, type BillingState } from '@/services/billing.service';
import { openWhatsApp } from '@/lib/whatsapp';
import { getPlanMarketing, formatPlanInterval, formatPlanPrice } from '@/lib/plan-catalog';
import { interpolate, msg } from '@/lib/i18n';
import { useLocale, useT } from '@/hooks/use-t';

function limitLabel(value: number, unlimited: string): string {
  return value < 0 ? unlimited : String(value);
}

export default function BillingPage() {
  const t = useT();
  const locale = useLocale();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setBilling(await BillingService.get());
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to load billing.'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buyPlan = async (slug: string) => {
    setPending(true);
    setStatus('');
    setError('');
    try {
      const request = await BillingService.subscribeRequest(slug);
      openWhatsApp(request.whatsappUrl);
      setStatus(interpolate(t.billing.requestSentFor, { plan: request.plan.name }));
      await load();
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to send the request.'));
    } finally {
      setPending(false);
    }
  };

  if (error && !billing) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow={t.billing.eyebrow} title={t.billing.title} />
        <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {error}
        </div>
        <div>
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
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Skeleton className="h-4 w-4 rounded-full" />
            <span className="text-[13.5px] text-ink-muted">{t.billing.loading}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pendingSlug = billing.pendingRequest?.plan.slug ?? null;
  const accessMessage = billing.access.state === 'trial'
    ? t.billing.accessTrial
    : billing.access.state === 'expired' || billing.access.state === 'inactive'
      ? t.billing.accessExpired
      : billing.access.state === 'none'
        ? t.billing.accessNone
        : '';

  const stateLabel =
    billing.access.state === 'active'
      ? t.billing.stateActive
      : billing.access.state === 'trial'
        ? t.billing.stateTrial
        : billing.access.state === 'none'
          ? t.billing.stateNone
          : t.billing.stateExpired;

  const isReadOnly =
    billing.access.state === 'trial' ||
    billing.access.state === 'expired' ||
    billing.access.state === 'inactive';

  const currentPlan = billing.plans.find((plan) => plan.slug === billing.access.plan.slug);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.billing.eyebrow}
        title={t.billing.title}
        description={t.billing.description}
      />

      {(status || error || pending) && (
        <div className="flex flex-col items-start gap-1.5 text-[13px] sm:items-end">
          {status ? (
            <p className="inline-flex items-center gap-1.5 font-medium text-success-700 dark:text-success-300">
              <Check className="h-3.5 w-3.5" aria-hidden />
              {status}
            </p>
          ) : null}
          {error ? <p className="text-danger-600 dark:text-danger-300">{error}</p> : null}
          {pending ? <p className="text-ink-subtle">{t.billing.updating}</p> : null}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-5 space-y-0">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.billing.currentAccess}
            </p>
            <p className="inline-flex items-center gap-2 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              <span
                aria-hidden
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  isReadOnly
                    ? 'bg-warning-100 text-warning-800 dark:bg-warning-900/60 dark:text-warning-200'
                    : 'bg-success-100 text-success-700 dark:bg-success-900/50 dark:text-success-300',
                )}
              >
                {isReadOnly ? <Lock className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              </span>
              {billing.access.plan.name} · {stateLabel}
            </p>
            <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
              {accessMessage || t.billing.accessActive}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <p className="text-[12.5px] text-ink-muted">
              {t.billing.startsLabel}{' '}
              {billing.access.startsAt ? (
                <time dateTime={billing.access.startsAt}>{new Date(billing.access.startsAt).toLocaleDateString()}</time>
              ) : '—'}
            </p>
            <p className="text-[12.5px] text-ink-muted">
              {billing.access.state === 'trial' ? t.billing.trialEndsLabel : t.billing.endsLabel}{' '}
              {billing.access.endsAt ? (
                <time dateTime={billing.access.endsAt}>{new Date(billing.access.endsAt).toLocaleDateString()}</time>
              ) : '—'}
            </p>
          </div>
        </CardHeader>
      </Card>

      {isReadOnly && (
        <div className="flex items-start gap-3.5 rounded-xl border border-warning-300/60 bg-warning-50 p-5 dark:border-warning-900/60 dark:bg-warning-900/25">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-100 text-warning-800 dark:bg-warning-900/60 dark:text-warning-200">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[14px] font-semibold text-warning-900 dark:text-warning-100">
              {t.billing.readOnlyTitle}
            </p>
            <p className="text-[13.5px] leading-relaxed text-warning-900/85 dark:text-warning-100/80">
              {billing.access.state === 'trial' && billing.access.endsAt ? (
                <>
                  {t.billing.trialPreviewUntil}{' '}
                  <time className="font-semibold" dateTime={billing.access.endsAt}>
                    {new Date(billing.access.endsAt).toLocaleDateString()}
                  </time>
                  {t.billing.trialPreviewAfter}
                </>
              ) : (
                <>{t.billing.readOnlyBody}</>
              )}
            </p>
          </div>
        </div>
      )}

      {billing.pendingRequest && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning-300/60 bg-warning-50 px-4 py-3 text-[13.5px] leading-relaxed text-warning-900 dark:border-warning-900/60 dark:bg-warning-900/25 dark:text-warning-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {interpolate(t.billing.pendingRequest, { plan: billing.pendingRequest.plan.name })}
          </span>
        </div>
      )}

      {currentPlan ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {t.billing.usage}
              </p>
              <CardTitle className="text-lg">{t.billing.planAllowances}</CardTitle>
            </div>
            <p className="text-[12.5px] text-ink-subtle">
              {currentPlan.name} · {formatPlanPrice(currentPlan.priceCents)} / {formatPlanInterval(currentPlan.interval, locale)}
            </p>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <UsageRow
              label={interpolate(t.billing.usageCampaigns, {
                used: billing.usage.campaigns,
                limit: limitLabel(currentPlan.features.limits.campaigns, t.billing.unlimited),
              })}
              value={billing.usage.campaigns}
              limit={currentPlan.features.limits.campaigns}
            />
            <UsageRow
              label={interpolate(t.billing.usageCustomers, {
                used: billing.usage.customers,
                limit: limitLabel(currentPlan.features.limits.customers, t.billing.unlimited),
              })}
              value={billing.usage.customers}
              limit={currentPlan.features.limits.customers}
            />
          </CardContent>
        </Card>
      ) : null}

      <div>
        <p className="mb-3.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">{t.billing.comparePlans}</p>
        <div className="flex flex-wrap justify-center gap-4">
          {billing.plans.map((plan) => {
            const isCurrent = billing.access.canManage && plan.slug === billing.access.plan.slug;
            const isPending = plan.slug === pendingSlug;
            const dimmed = isCurrent || isPending;
            const marketing = getPlanMarketing(locale)[plan.slug];
            return (
              <div
                key={plan.slug}
                className={cn(
                  'relative flex w-full flex-col rounded-lg border bg-card p-5 text-ink shadow-soft sm:w-[19.5rem]',
                  'transition-[border-color,box-shadow,opacity] duration-240 ease-swift motion-reduce:transition-none',
                  isCurrent
                    ? 'border-accent/60 ring-1 ring-accent/45'
                    : 'border-line hover:border-line-strong hover:shadow-card',
                  (isReadOnly || dimmed) && 'opacity-80',
                  dimmed && 'pointer-events-none',
                )}
              >
                {isCurrent ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-5 top-0 h-0.5 -translate-y-px rounded-full bg-accent"
                  />
                ) : null}

                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                    {plan.name}
                  </h3>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {isCurrent ? (
                      <Badge tone="brand" size="sm">
                        {t.billing.current}
                      </Badge>
                    ) : null}
                    {marketing?.badge ? (
                      <Badge tone="warning" size="sm">
                        {marketing.badge}
                      </Badge>
                    ) : null}
                    {isReadOnly && !isCurrent && !marketing?.badge ? (
                      <Badge tone="neutral" size="sm">
                        <Lock className="h-3 w-3" aria-hidden />
                        {t.billing.locked}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {marketing?.description ? (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{marketing.description}</p>
                ) : null}

                <p className="numeric mt-4 text-[24px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {formatPlanPrice(plan.priceCents)}
                  <span className="ml-1.5 text-[13px] font-normal text-ink-subtle">
                    / {formatPlanInterval(plan.interval, locale)}
                  </span>
                </p>

                <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px] leading-relaxed text-ink-muted">
                  {plan.features.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{`• ${feature}`}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="mt-5 w-full"
                  size="sm"
                  variant={isCurrent ? 'outline' : 'primary'}
                  disabled={pending || isCurrent || isPending}
                  onClick={() => void buyPlan(plan.slug)}
                >
                  {isCurrent ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      {t.billing.currentPlan}
                    </>
                  ) : isPending ? (
                    <>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      {t.billing.requestSent}
                    </>
                  ) : (
                    t.billing.buy
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UsageRow({ label, value, limit }: { label: string; value: number; limit: number }) {
  const percent = limit < 0 ? 0 : (value / limit) * 100;

  return (
    <div className="rounded-xl border border-line bg-surface-2/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
      <Progress className="mt-3" value={percent} label={label} />
    </div>
  );
}
