"use client";

import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { BadgeCheck, Percent, Ticket } from 'lucide-react';
import { CouponService, type Coupon, type CouponStatus } from '@/services/coupon.service';
import { msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { invalidateCachedResource, readCachedResource, setCachedResource } from '@/hooks/useCachedResource';

type StatusFilter = 'ALL' | 'ISSUED' | 'REDEEMED' | 'EXPIRED';

const STATS_KEY = 'coupons:stats';

interface CouponsStats {
  total: number;
  redeemed: number;
}

const listKeyOf = (status: string, search: string): string => `coupons:list:${status}:${search}`;

const STATUS_TONES: Record<string, BadgeTone> = {
  issued: 'info',
  redeemed: 'success',
  expired: 'neutral',
};

export default function CouponsPage() {
  const t = useT();

  const STATUS_FILTERS = [
    { value: 'ALL', label: t.coupons.filterAll },
    { value: 'ISSUED', label: t.coupons.filterIssued },
    { value: 'REDEEMED', label: t.coupons.filterRedeemed },
    { value: 'EXPIRED', label: t.coupons.filterExpired },
  ] as const;

  const STATUS_LABELS: Record<CouponStatus, string> = {
    issued: t.coupons.statusIssued,
    redeemed: t.coupons.statusRedeemed,
    expired: t.coupons.statusExpired,
  };

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  // Seeded from the SWR cache so revisits paint instantly; fresh-skip within
  // the 60s TTL keeps filter changes off the network when data is still fresh.
  const [coupons, setCoupons] = useState<Coupon[]>(() => readCachedResource<Coupon[]>(listKeyOf('ALL', '')) ?? []);
  const [loading, setLoading] = useState(() => readCachedResource(listKeyOf('ALL', '')) === null);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  // Global counts (not the filtered page): two limit-1 queries read the exact
  // totals off the paginated endpoint without pulling any rows.
  const [stats, setStats] = useState<CouponsStats | null>(() => readCachedResource<CouponsStats>(STATS_KEY));

  useEffect(() => {
    let cancelled = false;
    const cached = readCachedResource<CouponsStats>(STATS_KEY);
    if (cached) {
      setStats(cached);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      CouponService.list({ status: 'ALL', limit: 1 }),
      CouponService.list({ status: 'REDEEMED', limit: 1 }),
    ])
      .then(([all, redeemed]) => {
        if (cancelled) return;
        const next = { total: all.total, redeemed: redeemed.total };
        setCachedResource(STATS_KEY, next);
        setStats(next);
      })
      .catch(() => {
        // Stats are decoration: the list below still works without them.
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = (force = false) => {
    const key = listKeyOf(status, search);
    if (!force) {
      const cached = readCachedResource<Coupon[]>(key);
      if (cached) {
        setCoupons(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    CouponService.list({ status, search: search || undefined, limit: 50 })
      .then((result) => {
        setCachedResource(key, result.coupons);
        setCoupons(result.coupons);
      })
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load coupons.')),
      )
      .finally(() => setLoading(false));
  };

  // The fresh-skip above must not swallow the results of a mutation: a force
  // reload re-runs the network request and rewrites the cache entry.
  const refreshStats = () => {
    invalidateCachedResource(STATS_KEY);
    void Promise.all([
      CouponService.list({ status: 'ALL', limit: 1 }),
      CouponService.list({ status: 'REDEEMED', limit: 1 }),
    ])
      .then(([all, redeemed]) => {
        const next = { total: all.total, redeemed: redeemed.total };
        setCachedResource(STATS_KEY, next);
        setStats(next);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  const handleRedeem = async (couponId: string) => {
    setRedeemingId(couponId);
    setError(null);

    try {
      await CouponService.redeem(couponId);
      load(true);
      refreshStats();
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to redeem the coupon.'));
    } finally {
      setRedeemingId(null);
    }
  };

  const redemptionRate =
    stats && stats.total > 0 ? Math.min(Math.round((stats.redeemed / stats.total) * 1000) / 10, 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.coupons.eyebrow}
        title={t.coupons.title}
        description={t.coupons.description}
      />

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label={t.coupons.statTotal} value={stats.total} icon={Ticket} />
          <StatCard label={t.coupons.statRedeemed} value={stats.redeemed} icon={BadgeCheck} />
          <StatCard
            label={t.coupons.statRedemptionRate}
            value={`${redemptionRate}%`}
            icon={Percent}
            featured
          />
        </div>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <Field label={t.coupons.searchLabel} htmlFor="coupon-search">
            <Input
              id="coupon-search"
              type="text"
              placeholder={t.coupons.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>

          <Field label={t.coupons.statusLabel} htmlFor="coupon-status">
            <Select
              id="coupon-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger-300/60 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger-500" aria-hidden />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-[13px] text-ink-subtle">{t.coupons.loading}</p>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Ticket}
              title={t.coupons.emptyTitle}
              description={t.coupons.emptyDescription}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {coupons.map((coupon) => (
            <Card key={coupon.id}>
              <CardContent>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[15px]" aria-hidden>
                        {coupon.status === 'issued' ? '🎫' : coupon.status === 'redeemed' ? '✅' : '⏰'}
                      </span>
                      <div className="min-w-0">
                        <h3 className="numeric truncate text-[15px] font-semibold text-ink">{coupon.code}</h3>
                        <p className="truncate text-[13px] text-ink-muted">{coupon.customerName}</p>
                      </div>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-muted">
                      <span className="font-medium text-ink">{coupon.rewardName}</span>
                      <span className="font-medium text-ink">{coupon.campaignName}</span>
                      <span>{new Date(coupon.issuedAt).toLocaleDateString()}</span>
                      <Badge size="sm" tone={STATUS_TONES[coupon.status] ?? 'neutral'}>
                        {STATUS_LABELS[coupon.status]}
                      </Badge>
                    </div>
                  </div>

                  {coupon.status === 'issued' && (
                    <Button
                      size="sm"
                      onClick={() => handleRedeem(coupon.id)}
                      disabled={redeemingId === coupon.id}
                      loading={redeemingId === coupon.id}
                    >
                      {redeemingId === coupon.id ? t.coupons.redeeming : t.coupons.redeem}
                    </Button>
                  )}
                </div>

                {(coupon.expiresAt || coupon.redeemedAt) && (
                  <div className="mt-4 space-y-1 border-t border-line pt-3 text-[13px] text-ink-subtle">
                    {coupon.expiresAt && (
                      <p>
                        <strong className="font-medium text-ink-muted">{t.coupons.expiresLabel}</strong>{' '}
                        {new Date(coupon.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                    {coupon.redeemedAt && (
                      <p>
                        <strong className="font-medium text-ink-muted">{t.coupons.redeemedLabel}</strong>{' '}
                        {new Date(coupon.redeemedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}