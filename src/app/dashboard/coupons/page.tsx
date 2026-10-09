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
import { Ticket } from 'lucide-react';
import { CouponService, type Coupon, type CouponStatus } from '@/services/coupon.service';
import { msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';

type StatusFilter = 'ALL' | 'ISSUED' | 'REDEEMED' | 'EXPIRED';

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
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);

    CouponService.list({ status, search: search || undefined, limit: 50 })
      .then((result) => setCoupons(result.coupons))
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load coupons.')),
      )
      .finally(() => setLoading(false));
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
      load();
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to redeem the coupon.'));
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.coupons.eyebrow}
        title={t.coupons.title}
        description={t.coupons.description}
      />

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