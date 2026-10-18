"use client";

import { Fragment, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Gift,
  Save,
  Search,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard, Spinner } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableWrap,
} from '@/components/ui/table';
import { CustomerService, type Customer, type CustomerDetail } from '@/services/customer.service';
import { CouponService } from '@/services/coupon.service';
import { useT } from '@/hooks/use-t';
import { readCachedResource, setCachedResource } from '@/hooks/useCachedResource';

const DESKTOP_QUERY = '(min-width: 1024px)';
const COLUMN_COUNT = 7;

function readDesktop(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(readDesktop);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

const listKeyOf = (search: string): string => `customers:list:${search}`;
const detailKeyOf = (id: string): string => `customers:detail:${id}`;

export default function CustomersPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  // Seeded from the SWR cache at mount so revisits paint the table instantly.
  const [customers, setCustomers] = useState<Customer[]>(() => readCachedResource<Customer[]>(listKeyOf('')) ?? []);
  const [loading, setLoading] = useState(() => readCachedResource(listKeyOf('')) === null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [couponStatus, setCouponStatus] = useState<Record<string, 'ISSUED' | 'REDEEMED'>>({});
  const [couponDeadline, setCouponDeadline] = useState<Record<string, string>>({});
  const [savingCouponId, setSavingCouponId] = useState<string | null>(null);
  const [confirmDeleteCouponId, setConfirmDeleteCouponId] = useState<string | null>(null);
  const [deletingCouponId, setDeletingCouponId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const key = listKeyOf(search);
      const cached = readCachedResource<Customer[]>(key);
      if (cached) {
        setCustomers(cached);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      CustomerService.list({ search: search || undefined, limit: 50 })
        .then((result) => {
          if (cancelled) return;
          setCachedResource(key, result.customers);
          setCustomers(result.customers);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : t.customers.loading);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, t]);

  const applyDetail = (detail: CustomerDetail) => {
    setCustomerDetail(detail);
    setCouponStatus(Object.fromEntries(detail.coupons.map((coupon) => [
      coupon.id,
      coupon.status === 'REDEEMED' ? 'REDEEMED' : 'ISSUED',
    ])));
    setCouponDeadline(Object.fromEntries(detail.coupons.map((coupon) => [coupon.id, coupon.expires_at?.slice(0, 10) ?? ''])));
  };

  const toggleCustomer = async (customerId: string) => {
    if (expandedCustomerId === customerId) {
      setExpandedCustomerId(null);
      setCustomerDetail(null);
      return;
    }

    setExpandedCustomerId(customerId);
    setCustomerDetail(null);
    setDetailError(null);

    try {
      const key = detailKeyOf(customerId);
      const cached = readCachedResource<CustomerDetail>(key);
      // Fresh cache hit: paint without the skeleton at all.
      if (cached) {
        applyDetail(cached);
        return;
      }
      setDetailLoading(true);
      const detail = await CustomerService.get(customerId);
      setCachedResource(key, detail);
      applyDetail(detail);
    } catch (cause: unknown) {
      setDetailError(cause instanceof Error ? cause.message : t.customers.loadingPrizes);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveCoupon = async (couponId: string) => {
    if (!customerDetail) return;
    const coupon = customerDetail.coupons.find((entry) => entry.id === couponId);
    if (!coupon) return;

    const selectedDeadline = couponDeadline[couponId] ?? coupon.expires_at?.slice(0, 10) ?? '';
    const previousDeadline = coupon.expires_at?.slice(0, 10) ?? '';
    setSavingCouponId(couponId);
    setDetailError(null);

    try {
      // A changed deadline is either a new date or an explicit clear (`null`);
      // an untouched field sends nothing so the backend keeps the old value.
      const deadlineChanged = selectedDeadline !== previousDeadline;
      await CouponService.update(couponId, {
        ...(deadlineChanged
          ? {
              expiresAt: selectedDeadline
                ? new Date(`${selectedDeadline}T23:59:59.999Z`).toISOString()
                : null,
            }
          : {}),
      });
      const refreshed = await CustomerService.get(customerDetail.customer.id);
      setCachedResource(detailKeyOf(customerDetail.customer.id), refreshed);
      applyDetail(refreshed);
      CustomerService.list({ search: search || undefined, limit: 50 })
        .then((result) => {
          setCustomers(result.customers);
          setCachedResource(listKeyOf(search), result.customers);
        })
        .catch(() => undefined);
    } catch (cause: unknown) {
      setDetailError(cause instanceof Error ? cause.message : t.customers.prizeHistory);
    } finally {
      setSavingCouponId(null);
    }
  };

  const updateCouponStatus = async (couponId: string, status: 'ISSUED' | 'REDEEMED') => {
    if (!customerDetail) return;
    const coupon = customerDetail.coupons.find((entry) => entry.id === couponId);
    if (!coupon || coupon.status === status) return;

    const previousStatus = coupon.status === 'REDEEMED' ? 'REDEEMED' : 'ISSUED';
    setCouponStatus((current) => ({ ...current, [couponId]: status }));
    setUpdatingStatusId(couponId);
    setConfirmDeleteCouponId(null);
    setDetailError(null);

    try {
      await CouponService.update(couponId, { status });
      const refreshed = await CustomerService.get(customerDetail.customer.id);
      setCachedResource(detailKeyOf(customerDetail.customer.id), refreshed);
      applyDetail(refreshed);
      CustomerService.list({ search: search || undefined, limit: 50 })
        .then((result) => {
          setCustomers(result.customers);
          setCachedResource(listKeyOf(search), result.customers);
        })
        .catch(() => undefined);
    } catch (cause: unknown) {
      setCouponStatus((current) => ({ ...current, [couponId]: previousStatus }));
      setDetailError(cause instanceof Error ? cause.message : t.customers.prizeStatus);
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const deleteCoupon = async (couponId: string) => {
    if (!customerDetail) return;

    setDeletingCouponId(couponId);
    setDetailError(null);

    try {
      await CouponService.delete(couponId);
      const refreshed = await CustomerService.get(customerDetail.customer.id);
      setCachedResource(detailKeyOf(customerDetail.customer.id), refreshed);
      applyDetail(refreshed);
      setConfirmDeleteCouponId(null);
      CustomerService.list({ search: search || undefined, limit: 50 })
        .then((result) => {
          setCustomers(result.customers);
          setCachedResource(listKeyOf(search), result.customers);
        })
        .catch(() => undefined);
    } catch (cause: unknown) {
      setDetailError(cause instanceof Error ? cause.message : t.customers.deletePrizeError);
    } finally {
      setDeletingCouponId(null);
    }
  };

  const prizeHistory = () => {
    if (detailLoading) {
      return (
        <p className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Spinner />
          {t.customers.loadingPrizes}
        </p>
      );
    }

    if (detailError) {
      return (
        <p className="rounded-lg border border-danger-300/60 bg-danger-50 px-3.5 py-2.5 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {detailError}
        </p>
      );
    }

    if (!customerDetail) return null;

    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          {t.customers.prizeHistory}
        </h3>

        {customerDetail.coupons.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Gift}
            title={t.customers.emptyPrizesTitle}
          />
        ) : (
          <div className="grid gap-3">
            {customerDetail.coupons.map((coupon) => {
              const statusValue = couponStatus[coupon.id] ?? coupon.status;
              const deadlineValue = couponDeadline[coupon.id] ?? coupon.expires_at?.slice(0, 10) ?? '';
              const dirty = deadlineValue !== (coupon.expires_at?.slice(0, 10) ?? '');
              const canDelete = coupon.status === 'REDEEMED' && statusValue === 'REDEEMED';
              const saving = savingCouponId === coupon.id;

              return (
                <div
                  key={coupon.id}
                  className="grid gap-3 rounded-lg border border-line bg-elevated p-4 xl:grid-cols-[minmax(0,1fr)_236px_176px_auto] xl:items-end"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-ink">
                      {coupon.reward_name ?? t.customers.prizeFallback}
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                      {(coupon.campaign_name ?? t.customers.campaignFallback)} · {coupon.code}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-subtle">
                      {t.customers.wonOn.replace('{date}', new Date(coupon.issued_at).toLocaleDateString())}
                    </p>
                  </div>

                  <div className="flex items-end gap-2">
                    <Field
                      label={t.customers.prizeStatus}
                      htmlFor={`coupon-status-${coupon.id}`}
                      className="min-w-0 flex-1"
                    >
                      <Select
                        id={`coupon-status-${coupon.id}`}
                        inputSize="sm"
                        value={statusValue}
                        disabled={updatingStatusId === coupon.id}
                        onChange={(event) => void updateCouponStatus(coupon.id, event.target.value as 'ISSUED' | 'REDEEMED')}
                      >
                        <option value="ISSUED">{t.customers.statusOwed}</option>
                        <option value="REDEEMED">{t.customers.statusGiven}</option>
                      </Select>
                    </Field>

                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t.customers.deletePrizeAria.replace('{name}', coupon.reward_name ?? t.customers.prizeFallback)}
                        title={t.customers.deleteGivenPrize}
                        onClick={() => setConfirmDeleteCouponId(coupon.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {t.common.delete}
                      </Button>
                    )}
                  </div>

                  <Field label={t.customers.deadline} htmlFor={`coupon-deadline-${coupon.id}`}>
                    <Input
                      id={`coupon-deadline-${coupon.id}`}
                      inputSize="sm"
                      type="date"
                      value={deadlineValue}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(event) => setCouponDeadline((current) => ({ ...current, [coupon.id]: event.target.value }))}
                    />
                  </Field>

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!dirty || saving}
                    loading={saving}
                    onClick={() => void saveCoupon(coupon.id)}
                  >
                    {!saving ? <Save className="h-4 w-4" aria-hidden /> : null}
                    {t.common.save}
                  </Button>

                  {canDelete && confirmDeleteCouponId === coupon.id && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger-300/60 bg-danger-50 px-3 py-2.5 xl:col-span-4 dark:border-danger-900/60 dark:bg-danger-900/30">
                      <span className="text-[13px] text-danger-800 dark:text-danger-200">
                        {t.customers.confirmDeletePrize}
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deletingCouponId === coupon.id}
                        onClick={() => void deleteCoupon(coupon.id)}
                      >
                        {deletingCouponId !== coupon.id ? (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        ) : null}
                        {t.common.confirm}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDeleteCouponId(null)}
                      >
                        {t.common.cancel}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const prizesButton = (customer: Customer) => {
    const expanded = expandedCustomerId === customer.id;

    return (
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onClick={() => void toggleCustomer(customer.id)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
        {t.customers.viewPrizes}
      </Button>
    );
  };

  const engagement = (customer: Customer) => (
    <span className="inline-flex items-center gap-3 text-[12.5px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5">
        <Gift className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
        <span className="numeric">{customer.participationCount}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Ticket className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
        <span className="numeric">{customer.redeemedCount}</span>
      </span>
    </span>
  );

  const statusBadge = (customer: Customer) => (
    <Badge size="sm" tone={customer.status === 'active' ? 'success' : 'info'} dot>
      {customer.status === 'active' ? t.customers.statusActive : t.customers.statusNew}
    </Badge>
  );

  const list =
    error ? (
      <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
        <p className="font-medium">{error}</p>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => setSearch('')}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    ) : loading ? (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <p role="status" className="sr-only">{t.customers.loading}</p>
      </div>
    ) : customers.length === 0 ? (
      <EmptyState
        icon={Users}
        title={t.customers.emptyTitle}
        description={t.customers.emptyDescription}
      />
    ) : isDesktop ? (
      <Card>
        <TableWrap>
          <Table density="compact">
            <TableHead>
              <TableRow>
                <TableHeadCell>{t.customers.columnCustomer}</TableHeadCell>
                <TableHeadCell>{t.customers.columnContact}</TableHeadCell>
                <TableHeadCell>{t.customers.joined}</TableHeadCell>
                <TableHeadCell>{t.customers.lastActivity}</TableHeadCell>
                <TableHeadCell>{t.customers.columnEngagement}</TableHeadCell>
                <TableHeadCell>{t.customers.columnPrizes}</TableHeadCell>
                <TableHeadCell>{t.customers.columnStatus}</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.map((customer) => (
                <Fragment key={customer.id}>
                  <TableRow interactive>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <Avatar name={customer.name} size="sm" />
                        <span className="truncate font-semibold text-ink">{customer.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <p className="text-[12.5px] text-ink">{customer.email || '—'}</p>
                      <p className="text-[12.5px] text-ink-subtle">{customer.phone || '—'}</p>
                    </TableCell>
                    <TableCell className="text-[12.5px] text-ink-muted">
                      {displayDate(customer.createdAt)}
                    </TableCell>
                    <TableCell className="text-[12.5px] text-ink-muted">
                      {displayDate(customer.lastActivityAt ?? customer.createdAt)}
                    </TableCell>
                    <TableCell>{engagement(customer)}</TableCell>
                    <TableCell>{prizesButton(customer)}</TableCell>
                    <TableCell>{statusBadge(customer)}</TableCell>
                  </TableRow>

                  {expandedCustomerId === customer.id && (
                    <TableRow>
                      <TableCell colSpan={COLUMN_COUNT} className="bg-surface-2/60">
                        {prizeHistory()}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </Card>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        {customers.map((customer) => (
          <Card key={customer.id} className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={customer.name} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">{customer.name}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                    {customer.email || '—'}
                  </p>
                </div>
              </div>
              {statusBadge(customer)}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.customers.joined}</dt>
                <dd className="mt-1 text-[13px] text-ink">{displayDate(customer.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.customers.lastActivity}</dt>
                <dd className="mt-1 text-[13px] text-ink">
                  {displayDate(customer.lastActivityAt ?? customer.createdAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.customers.contact}</dt>
                <dd className="mt-1 text-[13px] text-ink">
                  {customer.phone || '—'}
                  {customer.email && customer.phone ? ` · ${customer.email}` : customer.email || ''}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-3">
              {engagement(customer)}
              {prizesButton(customer)}
            </div>

            {expandedCustomerId === customer.id && prizeHistory()}
          </Card>
        ))}
      </div>
    );

  const exportCsv = () => {
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = [
      t.customers.csvClient,
      t.customers.csvEmail,
      t.customers.csvPhone,
      t.customers.csvJoined,
      t.customers.csvLastActivity,
      t.customers.csvStatus,
    ];
    const rows = customers.map((customer) =>
      [
        customer.name,
        customer.email,
        customer.phone,
        displayDate(customer.createdAt),
        displayDate(customer.lastActivityAt),
        customer.status === 'active' ? t.customers.statusActive : t.customers.statusNew,
      ]
        .map(escapeCell)
        .join(';'),
    );
    const csv = '﻿' + [header.map(escapeCell).join(';'), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.nav.workspace}
        title={t.customers.title}
        description={t.customers.description}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Field
              label={
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.customers.searchLabel}
                </span>
              }
              htmlFor="customer-search"
              className="w-full max-w-md"
            >
              <Input
                id="customer-search"
                inputSize="sm"
                iconStart={<Search />}
                placeholder={t.customers.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Button variant="outline" size="sm" type="button" onClick={exportCsv}>
              <Download className="h-4 w-4" aria-hidden />
              {t.customers.exportCsv}
            </Button>
          </div>
        }
      />

      {list}
    </div>
  );
}