import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, MessageSquare, RefreshCw, Send, Smartphone, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { selectWithinBatch } from '@/lib/recipients';
import {
  SmsService,
  type SmsCampaign,
  type SmsGateway,
  type SmsStatus,
  type SmsWinner,
} from '@/services/sms.service';

type Recipient = { name?: string; phone: string };

const STATUS_TONE = {
  QUEUED: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'warning',
} as const;

/** GSM-7 multi-part payloads pack 153 chars per segment beyond the first. */
const OPT_OUT_FOOTER = ' Envoyez STOP pour vous désinscrire';

const DEFAULT_MESSAGE =
  'Bonjour {name} ! 🎉 Vous avez gagné : {prize}. Passez en boutique pour récupérer votre cadeau :';

function segmentsFor(length: number): number {
  if (length === 0) return 0;
  if (length <= 160) return 1;
  return Math.ceil(length / 153);
}

type GatewayBadge = { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string };

/** Honest gateway badge: ONLINE is the only state where sending can happen. */
function describeGatewayBadge(gateway: SmsGateway | null, t: ReturnType<typeof useT>): GatewayBadge {
  if (!gateway || gateway.state === 'UNKNOWN') return { tone: 'neutral', label: t.sms.gatewayUnknown };
  if (gateway.state === 'ONLINE') return { tone: 'success', label: t.sms.gatewayOnline };
  return { tone: 'danger', label: t.sms.gatewayOfflineShort };
}

export default function SmsBroadcastPanel({ reloadKey }: { reloadKey: number }) {
  const t = useT();
  const [status, setStatus] = useState<SmsStatus | null>(null);
  const [winners, setWinners] = useState<SmsWinner[]>([]);
  const [history, setHistory] = useState<SmsCampaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [sourceTab, setSourceTab] = useState('winners');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [optOut, setOptOut] = useState(true);
  const [active, setActive] = useState<SmsCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextStatus, broadcasts] = await Promise.all([SmsService.status(), SmsService.list()]);
      setStatus(nextStatus);
      setHistory(broadcasts);

      const running = broadcasts.find(
        (campaign) => campaign.status === 'QUEUED' || campaign.status === 'PROCESSING',
      );
      setActive(running ?? null);

      if (nextStatus.allowed) {
        try {
          setWinners(await SmsService.winners());
        } catch {
          // Winners are an optional convenience; the paste list stays usable.
        }
      }
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.sms.loadError));
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
          const [nextStatus, broadcasts] = await Promise.all([SmsService.status(), SmsService.list()]);
          setStatus(nextStatus);
          setHistory(broadcasts);
          setWinners(await SmsService.winners());
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
        const campaign = await SmsService.get(active.id);
        if (!cancelled) setActive(campaign); // new object → effect re-runs and re-arms
      } catch {
        // Transient failure: retry instead of stalling the panel.
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    timer = window.setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active]);

  const pastedRecipients = useMemo(() => {
    const out: Recipient[] = [];
    for (const rawLine of paste.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(',');
      const head = parts[0] ?? '';
      const tail = parts.slice(1);
      if (tail.length > 0) {
        const phone = tail.join(',').trim();
        if (phone) out.push(head.trim() ? { name: head.trim(), phone } : { phone });
      } else {
        out.push({ phone: line });
      }
    }
    return out;
  }, [paste]);

  const recipients = useMemo(() => {
    const chosen = winners
      .filter((winner) => selectedIds.includes(winner.id))
      .map((winner) => ({ name: winner.name ?? winner.phone, phone: winner.phone }));

    const seen = new Set<string>();
    const merged: Recipient[] = [];
    for (const recipient of [...chosen, ...pastedRecipients]) {
      const key = recipient.phone.replace(/[^0-9]/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(recipient);
    }
    return merged;
  }, [winners, selectedIds, pastedRecipients]);

  const count = recipients.length;
  const overBatch = status !== null && status.batchLimit > 0 && count > status.batchLimit;
  const gateway = status?.gateway ?? null;
  const gatewayOnline = gateway?.state === 'ONLINE';
  const gatewayBadge = describeGatewayBadge(gateway, t);
  const hasActive = active !== null && (active.status === 'QUEUED' || active.status === 'PROCESSING');

  const payloadLength = message.length + (optOut ? OPT_OUT_FOOTER.length : 0);
  const segments = segmentsFor(payloadLength);
  const counterText =
    payloadLength === 0
      ? ''
      : interpolate(t.sms.counter, { chars: payloadLength, segments });

  const firstSelected = winners.find((winner) => selectedIds.includes(winner.id)) ?? null;
  const previewText = useMemo(() => {
    if (firstSelected === null) return '';
    const rendered = message
      .replace(/\{name\}/g, firstSelected.name ?? firstSelected.phone)
      .replace(/\{prize\}/g, firstSelected.prize);
    return optOut ? `${rendered}${OPT_OUT_FOOTER}` : rendered;
  }, [firstSelected, message, optOut]);

  const canSend =
    count > 0 &&
    !sending &&
    !overBatch &&
    message.trim() !== '' &&
    status?.configured === true &&
    gatewayOnline &&
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
        ? interpolate(t.sms.randomCap, { picked: pick.ids.length, limit: status?.batchLimit ?? 0 })
        : '',
    );
  };

  const insertToken = (token: string) => {
    setMessage((current) => (current.trim() === '' ? token : `${current} ${token}`));
  };

  const startBroadcast = async () => {
    setSending(true);
    setError('');
    try {
      const payload = optOut ? `${message.trimEnd()}${OPT_OUT_FOOTER}` : message;
      const campaign = await SmsService.create({ recipients, message: payload });
      setActive(campaign);
      setConfirmOpen(false);
      setSelectedIds([]);
      setPaste('');
      setHistory((current) => [campaign, ...current]);
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.sms.startError));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const refreshHistory = async () => {
    const [nextStatus, broadcasts] = await Promise.all([SmsService.status(), SmsService.list()]);
    setStatus(nextStatus);
    setHistory(broadcasts);
    try {
      setWinners(await SmsService.winners());
    } catch {
      // Winners are optional; keep the previous list on failure.
    }
  };

  const cancelBroadcast = async (campaignId: string) => {
    setError('');
    try {
      await SmsService.cancel(campaignId);
      await refreshHistory();
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.sms.loadError));
    }
  };

  const resumeBroadcast = async (campaignId: string) => {
    setError('');
    try {
      await SmsService.resume(campaignId);
      const campaign = await SmsService.get(campaignId);
      setActive(campaign);
      await refreshHistory();
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.sms.loadError));
    }
  };

  const statusLabel = (value: string) =>
    value === 'COMPLETED'
      ? t.sms.statusCOMPLETED
      : value === 'FAILED'
        ? t.sms.statusFAILED
        : value === 'CANCELLED'
          ? t.sms.statusCANCELLED
          : value === 'PROCESSING'
            ? t.sms.statusPROCESSING
            : t.sms.statusQUEUED;

  if (loading && !status) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6">
          <Skeleton className="h-4 w-4 rounded-full" />
          <span className="text-[13.5px] text-ink-muted">{t.sms.loading}</span>
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
              {status.enabled === false ? t.sms.disabledTitle : t.sms.lockedTitle}
            </p>
            <p className="text-[13.5px] leading-relaxed text-warning-900/85 dark:text-warning-100/80">
              {status.enabled === false ? t.sms.disabledBody : t.sms.lockedBody}
            </p>
            {status.enabled === false ? null : (
              <Link to="/dashboard/billing" className="inline-block">
                <Button size="sm" variant="outline">
                  {t.sms.upgrade}
                </Button>
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {status && status.allowed ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.sms.usageCard}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={gatewayBadge.tone} size="sm">
                {gatewayBadge.label}
              </Badge>
              <Badge tone={status.remaining > 0 ? 'brand' : 'warning'} size="sm">
                {interpolate(t.sms.remaining, { count: status.remaining })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.sms.usageSent, {
                sent: status.sentThisMonth,
                limit: status.monthlyLimit,
              })}
            </p>
            <Progress
              className="mt-0"
              value={status.monthlyLimit > 0 ? (status.sentThisMonth / status.monthlyLimit) * 100 : 0}
              label={t.sms.usageSent}
            />
            <p className="text-[12.5px] text-ink-subtle">
              {interpolate(t.sms.batchLimit, { limit: status.batchLimit })}
            </p>
            {status.configured && gateway?.state === 'OFFLINE' ? (
              <div className="rounded-xl border border-warning-300/60 bg-warning-50 p-4 dark:border-warning-900/60 dark:bg-warning-900/25">
                <p className="text-[13.5px] text-warning-900 dark:text-warning-100">
                  {t.sms.gatewayOfflineBody}
                </p>
              </div>
            ) : null}
            {status.configured && gateway?.state === 'UNKNOWN' ? (
              <div className="rounded-xl border border-warning-300/60 bg-warning-50 p-4 dark:border-warning-900/60 dark:bg-warning-900/25">
                <p className="text-[13.5px] text-warning-900 dark:text-warning-100">
                  {t.sms.gatewayUnknownBody}
                </p>
              </div>
            ) : null}
            {!status.configured ? (
              <div className="rounded-xl border border-info-300/60 bg-info-50 p-4 dark:border-info-900/60 dark:bg-info-900/25">
                <p className="text-[13.5px] font-semibold text-info-900 dark:text-info-100">
                  {t.sms.unconfiguredTitle}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-info-900/85 dark:text-info-100/80">
                  {t.sms.unconfiguredBody}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.allowed && status.configured && !gatewayOnline ? (
        <Card data-testid="sms-gateway">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.sms.gatewayTitle}</CardTitle>
            <Badge tone={gatewayBadge.tone} size="sm">
              {gatewayBadge.label}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <p className="inline-flex items-center gap-1.5 text-[13.5px] leading-relaxed text-ink-muted">
              <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
              {t.sms.gatewaySteps}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t.sms.refresh}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {active ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.sms.activeTitle}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[active.status] ?? 'neutral'} size="sm">
                {statusLabel(active.status)}
              </Badge>
              {hasActive ? (
                <Button variant="outline" size="xs" onClick={() => void cancelBroadcast(active.id)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t.sms.cancelBroadcast}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.sms.activeBody, {
                sent: active.sentCount,
                total: active.totalRecipients,
                failed: active.failedCount,
              })}
            </p>
            <Progress
              value={
                active.totalRecipients > 0
                  ? ((active.sentCount + active.failedCount) / active.totalRecipients) * 100
                  : 0
              }
              label={t.sms.activeTitle}
            />
            {active.lastError ? (
              <p className="text-[13px] text-danger-600 dark:text-danger-300">{msg(t, active.lastError)}</p>
            ) : null}
            {active.status === 'FAILED' || active.status === 'CANCELLED' ? (
              <Button variant="outline" size="sm" onClick={() => void resumeBroadcast(active.id)}>
                {t.sms.resume}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.allowed && status.configured ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">{t.sms.recipientsSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-ink-muted">
                  {interpolate(t.sms.selectedCount, { count })}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={sourceTab !== 'winners' || winners.length === 0 || selectedIds.length === winners.length}
                    onClick={toggleAllWinners}
                  >
                    {t.sms.selectAll}
                  </Button>
                  {selectedIds.length > 0 || pastedRecipients.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setSelectedIds([]);
                        setPaste('');
                        setBatchNotice('');
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t.sms.clearSelection}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col">
                <Tabs
                  value={sourceTab}
                  onChange={setSourceTab}
                  items={[
                    { value: 'winners', label: t.sms.winnersTab },
                    { value: 'paste', label: t.sms.pasteTab },
                  ]}
                  aria-label={t.sms.recipientsSection}
                  idPrefix="sms-source"
                />
                <div className="pt-4">
                  <TabPanel value="winners" active={sourceTab} idPrefix="sms-source">
                    <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                      <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {t.sms.winnersSection}
                      </p>
                      {winners.length === 0 ? (
                        <p className="text-[13px] text-ink-subtle">{t.sms.winnersEmpty}</p>
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
                      <p className="mt-2.5 text-[12.5px] text-ink-subtle">{t.sms.winnersHint}</p>
                    </div>
                  </TabPanel>
                  <TabPanel value="paste" active={sourceTab} idPrefix="sms-source">
                    <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                      <Field label={t.sms.pasteLabel} htmlFor="sms-paste" hint={t.sms.pasteHint}>
                        <Textarea
                          id="sms-paste"
                          rows={5}
                          value={paste}
                          onChange={(event) => setPaste(event.target.value)}
                        />
                      </Field>
                      <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] text-ink-subtle">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                        {interpolate(t.sms.pasteCount, { count: pastedRecipients.length })}
                      </p>
                    </div>
                  </TabPanel>
                </div>
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
              <CardTitle className="text-[15px]">{t.sms.messageSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label={t.sms.messageLabel} htmlFor="sms-message" hint={t.sms.messageHint}>
                <Textarea
                  id="sms-message"
                  rows={6}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-1.5" aria-label={t.sms.messageSection}>
                <Button variant="outline" size="xs" onClick={() => insertToken('{name}')}>
                  {'{name}'}
                </Button>
                <Button variant="outline" size="xs" onClick={() => insertToken('{prize}')}>
                  {'{prize}'}
                </Button>
              </div>

              {counterText !== '' ? (
                <p className="text-[12.5px] text-ink-muted" data-testid="sms-counter">
                  {counterText}
                </p>
              ) : null}

              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={optOut}
                  onChange={(event) => setOptOut(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-600 accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <span>
                  {t.sms.optOutLabel}
                  <span className="block text-[12px] text-ink-subtle">{t.sms.optOutHint}</span>
                </span>
              </label>

              {previewText !== '' ? (
                <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                  <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                    {t.sms.previewLabel}
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{previewText}</p>
                </div>
              ) : null}

              {overBatch && status !== null ? (
                <p
                  role="status"
                  className="rounded-lg border border-danger-300/60 bg-danger-50 px-3.5 py-2.5 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
                >
                  {interpolate(t.sms.overBatch, { limit: status.batchLimit })}
                </p>
              ) : null}

              {hasActive ? <p className="text-[12.5px] text-ink-subtle">{t.sms.waitActive}</p> : null}

              <Button disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                <Send className="h-4 w-4" aria-hidden />
                {count > 0 ? interpolate(t.sms.sendTo, { count }) : t.sms.send}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">{t.sms.historySection}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-[13.5px] text-ink-subtle">{t.sms.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((campaign) => (
                <li
                  key={campaign.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3"
                >
                  <span className="numeric text-[13px] text-ink-muted">
                    {campaign.sentCount}/{campaign.totalRecipients}
                    {campaign.failedCount > 0 ? ` (${campaign.failedCount} failed)` : ''}
                  </span>
                  <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'} size="sm">
                    {statusLabel(campaign.status)}
                  </Badge>
                  <time dateTime={campaign.createdAt} className="text-[12.5px] text-ink-subtle">
                    {new Date(campaign.createdAt).toLocaleDateString()}
                  </time>
                  {campaign.status === 'QUEUED' || campaign.status === 'PROCESSING' ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void cancelBroadcast(campaign.id)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t.sms.cancelBroadcast}
                    </Button>
                  ) : null}
                  {(campaign.status === 'FAILED' || campaign.status === 'CANCELLED') && !hasActive ? (
                    <Button variant="outline" size="xs" onClick={() => void resumeBroadcast(campaign.id)}>
                      {t.sms.resume}
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
        title={t.sms.confirmTitle}
        description={`${interpolate(t.sms.confirmBody, { count })}${
          segments > 0 ? ` ${interpolate(t.sms.confirmSegments, { segments: segments * count })}` : ''
        }`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void startBroadcast()} disabled={sending}>
              <Send className="h-4 w-4" aria-hidden />
              {t.sms.send}
            </Button>
          </>
        }
      />
    </div>
  );
}
