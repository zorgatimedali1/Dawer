import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, RefreshCw, Send, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { selectWithinBatch } from '@/lib/recipients';
import { CustomerService, type Customer } from '@/services/customer.service';
import {
  WhatsAppWebService,
  type WhatsAppWebCampaign,
  type WhatsAppWebGateway,
  type WhatsAppWebStatus,
  type WhatsAppWebWinner,
} from '@/services/whatsapp-web.service';

type Recipient = { name?: string; phone: string; prize?: string };

const STATUS_TONE = {
  QUEUED: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'warning',
} as const;

/** Average gateway drizzle is 12–25 s per message → ~18.5 s. */
const AVG_DELAY_SECONDS = 18.5;

const DEFAULT_MESSAGE =
  '🎁 *{greet} {name}!*\n\nThanks for spinning our wheel. You won a *{prize}*! Show this message to claim your reward on your next visit. 🥂';

function batchAllowsMessage(batchLimit: number): string {
  if (batchLimit === 100) return 'PRO plan allows 100 recipients per broadcast.';
  if (batchLimit === 250) return 'BUSINESS plan allows 250 recipients per broadcast.';
  return `Plan allows ${batchLimit} recipients per broadcast.`;
}

type GatewayBadge = { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string };

/** Honest gateway badge: READY is the only state where sending can happen. */
function describeGatewayBadge(
  gateway: WhatsAppWebGateway | null,
  t: ReturnType<typeof useT>,
): GatewayBadge {
  if (!gateway || !gateway.configured) return { tone: 'neutral', label: t.webBroadcast.gatewayOfflineShort };
  if (!gateway.reachable) return { tone: 'neutral', label: t.webBroadcast.gatewayOfflineShort };
  switch (gateway.state) {
    case 'READY':
      return { tone: 'success', label: t.webBroadcast.gatewayReady };
    case 'PAIRING':
      return { tone: 'warning', label: t.webBroadcast.gatewayPairing };
    case 'AUTH_FAILED':
      return { tone: 'danger', label: t.webBroadcast.gatewayAuthFailed };
    case 'DISCONNECTED':
      return { tone: 'warning', label: t.webBroadcast.gatewayDisconnected };
    default:
      return { tone: 'neutral', label: t.webBroadcast.gatewayStarting };
  }
}

export default function WebBroadcastPanel({ reloadKey }: { reloadKey: number }) {
  const t = useT();
  const [status, setStatus] = useState<WhatsAppWebStatus | null>(null);
  const [winners, setWinners] = useState<WhatsAppWebWinner[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [history, setHistory] = useState<WhatsAppWebCampaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [active, setActive] = useState<WhatsAppWebCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextStatus, broadcasts] = await Promise.all([
        WhatsAppWebService.status(),
        WhatsAppWebService.list(),
      ]);
      setStatus(nextStatus);
      setHistory(broadcasts);

      const running = broadcasts.find(
        (campaign) => campaign.status === 'QUEUED' || campaign.status === 'PROCESSING',
      );
      setActive(running ?? null);

      if (nextStatus.allowed) {
        try {
          setWinners(await WhatsAppWebService.winners());
        } catch {
          // Winners are an optional convenience; the composer stays usable.
        }
      }

      // Customers are offered as recipients regardless of the winners source.
      try {
        setCustomers((await CustomerService.list({ limit: 100 })).customers);
      } catch {
        // The customer picker is optional; sending from winners still works.
      }
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.webBroadcast.loadError));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Poll the active broadcast until it settles, then refresh usage and history.
  useEffect(() => {
    if (!active) return undefined;
    if (active.status !== 'QUEUED' && active.status !== 'PROCESSING') {
      void (async () => {
        try {
          const [nextStatus, broadcasts] = await Promise.all([
            WhatsAppWebService.status(),
            WhatsAppWebService.list(),
          ]);
          setStatus(nextStatus);
          setHistory(broadcasts);
          setWinners(await WhatsAppWebService.winners());
        } catch {
          // The panel already shows the final state; a refresh can wait.
        }
      })();
      return undefined;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const campaign = await WhatsAppWebService.get(active.id);
        if (!cancelled) setActive(campaign); // new object → effect re-runs and re-arms
      } catch {
        // Transient failure: retry instead of stalling the panel.
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active]);

  const customersWithPhone = useMemo(
    () => customers.filter((customer) => customer.phone.trim() !== ''),
    [customers],
  );

  const recipients = useMemo(() => {
    const chosen = winners
      .filter((winner) => selectedIds.includes(winner.id))
      .map((winner) => ({
        ...(winner.name ? { name: winner.name } : {}),
        ...(winner.prize ? { prize: winner.prize } : {}),
        phone: winner.phone,
      }));

    const chosenCustomers = customersWithPhone
      .filter((customer) => selectedCustomerIds.includes(customer.id))
      .map((customer) => ({ name: customer.name, phone: customer.phone }));

    const seen = new Set<string>();
    const merged: Recipient[] = [];
    for (const recipient of [...chosen, ...chosenCustomers]) {
      const key = recipient.phone.replace(/[^0-9]/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(recipient);
    }
    return merged;
  }, [winners, selectedIds, customersWithPhone, selectedCustomerIds]);

  const count = recipients.length;
  const overBatch = status !== null && status.batchLimit > 0 && count > status.batchLimit;
  const gateway = status?.gateway ?? null;
  const sessionReady = gateway?.state === 'READY';
  const pairingNeeded =
    gateway !== null &&
    gateway.configured &&
    (gateway.state === 'STARTING' || gateway.state === 'PAIRING' || gateway.state === 'AUTH_FAILED');
  const gatewayBadge = describeGatewayBadge(gateway, t);
  const hasActive = active !== null && (active.status === 'QUEUED' || active.status === 'PROCESSING');
  const estimateText =
    count === 0
      ? ''
      : count * AVG_DELAY_SECONDS < 60
        ? msg(t, t.webBroadcast.estimateUnderMinute)
        : interpolate(msg(t, t.webBroadcast.estimate), {
            minutes: Math.ceil((count * AVG_DELAY_SECONDS) / 60),
          });
  const canSend =
    count > 0 &&
    !sending &&
    !overBatch &&
    message.trim() !== '' &&
    sessionReady === true &&
    !hasActive;

  const toggleWinner = (winnerId: string) => {
    setSelectedIds((current) =>
      current.includes(winnerId) ? current.filter((id) => id !== winnerId) : [...current, winnerId],
    );
    setBatchNotice('');
  };

  const toggleAllWinners = () => {
    const pick = selectWithinBatch(winners, status?.batchLimit ?? 0);
    setSelectedIds(pick.ids);
    setBatchNotice(
      pick.capped
        ? interpolate(t.webBroadcast.randomCap, { picked: pick.ids.length, limit: status?.batchLimit ?? 0 })
        : '',
    );
  };

  const toggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((current) =>
      current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId],
    );
    setBatchNotice('');
  };

  const toggleAllCustomers = () => {
    const pick = selectWithinBatch(customersWithPhone, status?.batchLimit ?? 0);
    setSelectedCustomerIds(pick.ids);
    setBatchNotice(
      pick.capped
        ? interpolate(t.webBroadcast.randomCap, { picked: pick.ids.length, limit: status?.batchLimit ?? 0 })
        : '',
    );
  };

  const startBroadcast = async () => {
    setSending(true);
    setError('');
    try {
      const campaign = await WhatsAppWebService.create({ recipients, message });
      setActive(campaign);
      setConfirmOpen(false);
      setSelectedIds([]);
      setSelectedCustomerIds([]);
      setBatchNotice('');
      setHistory((current) => [campaign, ...current]);
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.webBroadcast.startError));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const cancelBroadcast = async () => {
    if (!active) return;
    setError('');
    try {
      const campaign = await WhatsAppWebService.cancel(active.id);
      if (campaign) setActive(campaign);
      const broadcasts = await WhatsAppWebService.list();
      setHistory(broadcasts);
      setStatus(await WhatsAppWebService.status());
      setWinners(await WhatsAppWebService.winners());
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.webBroadcast.loadError));
    }
  };

  const resumeBroadcast = async (campaignId: string) => {
    setError('');
    try {
      const campaign = await WhatsAppWebService.resume(campaignId);
      if (campaign) setActive(campaign);
      setHistory(await WhatsAppWebService.list());
      setStatus(await WhatsAppWebService.status());
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.webBroadcast.loadError));
    }
  };

  const statusLabel = (value: string) =>
    value === 'COMPLETED'
      ? t.webBroadcast.statusCOMPLETED
      : value === 'FAILED'
        ? t.webBroadcast.statusFAILED
        : value === 'CANCELLED'
          ? t.webBroadcast.statusCANCELLED
          : value === 'PROCESSING'
            ? t.webBroadcast.statusPROCESSING
            : t.webBroadcast.statusQUEUED;

  if (loading && !status) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6">
          <Skeleton className="h-4 w-4 rounded-full" />
          <span className="text-[13.5px] text-ink-muted">{t.webBroadcast.loading}</span>
        </CardContent>
      </Card>
    );
  }

  if (error && !status) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {error}
        </div>
        <div>
          <Button variant="outline" onClick={() => void load()}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-xl border border-danger-300/60 bg-danger-50 px-4 py-3 text-[13.5px] text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {error}
        </p>
      ) : null}

      {status && !status.allowed ? (
        <div className="flex items-start gap-3.5 rounded-xl border border-warning-300/60 bg-warning-50 p-5 dark:border-warning-900/60 dark:bg-warning-900/25">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-100 text-warning-800 dark:bg-warning-900/60 dark:text-warning-200">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-2">
            <p className="text-[14px] font-semibold text-warning-900 dark:text-warning-100">
              {status.enabled === false ? t.webBroadcast.disabledTitle : t.webBroadcast.lockedTitle}
            </p>
            <p className="text-[13.5px] leading-relaxed text-warning-900/85 dark:text-warning-100/80">
              {status.enabled === false ? t.webBroadcast.disabledBody : t.webBroadcast.lockedBody}
            </p>
            {status.enabled === false ? null : (
              <Link to="/dashboard/billing" className="inline-block">
                <Button size="sm" variant="outline">
                  {t.webBroadcast.upgrade}
                </Button>
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {status && status.allowed ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.billing.usage}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={gatewayBadge.tone} size="sm">
                {gatewayBadge.label}
              </Badge>
              <Badge tone={status.remaining > 0 ? 'brand' : 'warning'} size="sm">
                {interpolate(t.webBroadcast.remaining, { count: status.remaining })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.webBroadcast.usageSent, {
                sent: status.sentThisMonth,
                limit: status.monthlyLimit,
              })}
            </p>
            <Progress
              className="mt-0"
              value={status.monthlyLimit > 0 ? (status.sentThisMonth / status.monthlyLimit) * 100 : 0}
              label={t.webBroadcast.usageSent}
            />
            {status.gateway.configured && !status.gateway.reachable ? (
              <div className="rounded-xl border border-warning-300/60 bg-warning-50 p-4 dark:border-warning-900/60 dark:bg-warning-900/25">
                <p className="text-[13.5px] text-warning-900 dark:text-warning-100">
                  {t.webBroadcast.gatewayOffline}
                </p>
              </div>
            ) : null}
            {!status.gateway.configured ? (
              <div className="rounded-xl border border-info-300/60 bg-info-50 p-4 dark:border-info-900/60 dark:bg-info-900/25">
                <p className="text-[13.5px] font-semibold text-info-900 dark:text-info-100">
                  {t.webBroadcast.gatewayUnconfiguredTitle}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-info-900/85 dark:text-info-100/80">
                  {t.webBroadcast.gatewayUnconfiguredBody}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.allowed && pairingNeeded ? (
        <Card data-testid="ww-pairing">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.webBroadcast.pairTitle}</CardTitle>
            <Badge tone={gatewayBadge.tone} size="sm">
              {gatewayBadge.label}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 md:flex-row md:items-start">
            {gateway?.qr ? (
              <img
                src={gateway.qr}
                alt={t.webBroadcast.pairQrAlt}
                className="h-52 w-52 shrink-0 rounded-xl border border-line bg-white p-2"
              />
            ) : (
              <div className="flex h-52 w-52 shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/60 px-4 text-center text-[13px] text-ink-subtle">
                {t.webBroadcast.pairMissing}
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-2.5">
              <p className="text-[13.5px] leading-relaxed text-ink-muted">{t.webBroadcast.pairSteps}</p>
              <p className="text-[12.5px] text-ink-subtle">{t.webBroadcast.pairQrHint}</p>
              {gateway?.pairUrl ? (
                <a
                  href={gateway.pairUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  {t.webBroadcast.pairLinkLabel}
                </a>
              ) : null}
              <div>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {t.webBroadcast.pairRefresh}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {active ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.webBroadcast.activeTitle}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[active.status] ?? 'neutral'} size="sm">
                {statusLabel(active.status)}
              </Badge>
              {hasActive ? (
                <Button variant="outline" size="xs" onClick={() => void cancelBroadcast()}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t.webBroadcast.cancelBroadcast}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.webBroadcast.activeBody, {
                sent: active.sent,
                total: active.totalRecipients,
                failed: active.failed,
              })}
            </p>
            <Progress
              value={
                active.totalRecipients > 0
                  ? ((active.sent + active.failed) / active.totalRecipients) * 100
                  : 0
              }
              label={t.webBroadcast.activeTitle}
            />
            {active.lastError ? (
              <p className="text-[13px] text-danger-600 dark:text-danger-300">{msg(t, active.lastError)}</p>
            ) : null}
            {active.status === 'FAILED' || active.status === 'CANCELLED' ? (
              <Button variant="outline" size="sm" onClick={() => void resumeBroadcast(active.id)}>
                {t.webBroadcast.resume}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.allowed && status.gateway.configured ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">{t.webBroadcast.winnersSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-ink-muted">
                  {interpolate(t.webBroadcast.selectedCount, { count })}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={winners.length === 0 || selectedIds.length === winners.length}
                    onClick={toggleAllWinners}
                  >
                    {t.webBroadcast.selectAll}
                  </Button>
                  {selectedIds.length > 0 || selectedCustomerIds.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setSelectedIds([]);
                        setSelectedCustomerIds([]);
                        setBatchNotice('');
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t.webBroadcast.clearSelection}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {t.webBroadcast.winnersSection}
                </p>
                {winners.length === 0 ? (
                  <p className="text-[13px] text-ink-subtle">{t.webBroadcast.winnersEmpty}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {winners.map((winner) => {
                      const chosen = selectedIds.includes(winner.id);
                      return (
                        <button
                          key={winner.id}
                          type="button"
                          aria-pressed={chosen}
                          onClick={() => toggleWinner(winner.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150 ${
                            chosen
                              ? 'border-accent bg-accent-soft text-brand-800 dark:text-accent-bright'
                              : 'border-line bg-elevated text-ink-muted hover:border-line-strong'
                          }`}
                        >
                          <span className="font-medium">{winner.name ?? winner.phone}</span>
                          <span className="text-ink-subtle">{winner.prize ?? winner.phone}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2.5 text-[12.5px] text-ink-subtle">{t.webBroadcast.winnersHint}</p>
              </div>

              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {t.whatsapp.customersSection}
                  </p>
                  {customersWithPhone.length > 0 ? (
                    <button
                      type="button"
                      aria-pressed={selectedCustomerIds.length > 0 && selectedCustomerIds.length >= customersWithPhone.length}
                      onClick={toggleAllCustomers}
                      className="text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-800 dark:text-accent-bright dark:hover:text-accent-bright/90"
                    >
                      {t.webBroadcast.selectAll}
                    </button>
                  ) : null}
                </div>
                {customersWithPhone.length === 0 ? (
                  <p className="text-[13px] text-ink-subtle">{t.whatsapp.customersEmpty}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {customersWithPhone.map((customer) => {
                      const chosen = selectedCustomerIds.includes(customer.id);
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          aria-pressed={chosen}
                          onClick={() => toggleCustomer(customer.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150 ${
                            chosen
                              ? 'border-accent bg-accent-soft text-brand-800 dark:text-accent-bright'
                              : 'border-line bg-elevated text-ink-muted hover:border-line-strong'
                          }`}
                        >
                          <span className="font-medium">{customer.name}</span>
                          <span className="text-ink-subtle">{customer.phone}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2.5 text-[12.5px] text-ink-subtle">{t.whatsapp.customersHint}</p>
              </div>

              {batchNotice ? (
                <p
                  role="status"
                  className="rounded-xl border border-info-300/60 bg-info-50 px-4 py-3 text-[13px] font-medium text-info-900 dark:border-info-900/60 dark:bg-info-900/25 dark:text-info-100"
                >
                  {batchNotice}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">{t.webBroadcast.messageSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label={t.webBroadcast.messageLabel} htmlFor="ww-message" hint={t.webBroadcast.messageHint}>
                <Textarea
                  id="ww-message"
                  rows={8}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </Field>
              {estimateText !== '' ? (
                <p className="text-[12.5px] text-ink-muted" data-testid="ww-estimate">
                  {estimateText}
                </p>
              ) : null}

              {overBatch && status !== null ? (
                <p
                  role="status"
                  className="rounded-lg border border-danger-300/60 bg-danger-50 px-3.5 py-2.5 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
                >
                  {msg(t, batchAllowsMessage(status.batchLimit))}
                </p>
              ) : null}

              {hasActive ? <p className="text-[12.5px] text-ink-subtle">{t.webBroadcast.waitActive}</p> : null}

              <Button disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                <Send className="h-4 w-4" aria-hidden />
                {count > 0 ? interpolate(t.webBroadcast.sendTo, { count }) : t.webBroadcast.send}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">{t.webBroadcast.historySection}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-[13.5px] text-ink-subtle">{t.webBroadcast.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((campaign) => (
                <li
                  key={campaign.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3"
                >
                  <span className="numeric text-[13px] text-ink-muted">
                    {campaign.sent}/{campaign.totalRecipients}
                    {campaign.failed > 0 ? ` (${campaign.failed} failed)` : ''}
                  </span>
                  <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'} size="sm">
                    {statusLabel(campaign.status)}
                  </Badge>
                  <time dateTime={campaign.createdAt} className="text-[12.5px] text-ink-subtle">
                    {new Date(campaign.createdAt).toLocaleDateString()}
                  </time>
                  {(campaign.status === 'FAILED' || campaign.status === 'CANCELLED') && !hasActive ? (
                    <Button variant="outline" size="xs" onClick={() => void resumeBroadcast(campaign.id)}>
                      {t.webBroadcast.resume}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t.webBroadcast.confirmTitle}
        description={`${interpolate(t.webBroadcast.confirmBody, { count })}${
          estimateText !== '' ? ` ${estimateText}` : ''
        }`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void startBroadcast()} disabled={sending}>
              <Send className="h-4 w-4" aria-hidden />
              {t.webBroadcast.send}
            </Button>
          </>
        }
      />
    </div>
  );
}
