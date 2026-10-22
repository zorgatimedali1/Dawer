import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Plus, Send, Shuffle, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Label } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { selectWithinBatch } from '@/lib/recipients';
import { CustomerService, type Customer } from '@/services/customer.service';
import {
  WhatsAppService,
  type WhatsAppBroadcast,
  type WhatsAppPace,
  type WhatsAppStatus,
  type WhatsAppTemplate,
} from '@/services/whatsapp.service';
import { seededShuffle } from '@/lib/shuffle';

type Recipient = { name?: string; phone: string };

const STATUS_TONE = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
} as const;

const PACE_DELAY_MS: Record<WhatsAppPace, number> = { fast: 150, standard: 900, relaxed: 3000 };

function batchAllowsMessage(batchLimit: number): string {
  if (batchLimit === 100) return 'PRO plan allows 100 recipients per broadcast.';
  if (batchLimit === 250) return 'BUSINESS plan allows 250 recipients per broadcast.';
  return `Plan allows ${batchLimit} recipients per broadcast.`;
}

function estimateMinutes(count: number, pace: WhatsAppPace): number {
  return Math.max(1, Math.round((count * PACE_DELAY_MS[pace]) / 60_000));
}

function renderPreview(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (token, digit: string) => {
    const value = values[Number(digit) - 1]?.trim() ?? '';
    return value !== '' ? value : token;
  });
}

export default function CloudBroadcastPanel({ reloadKey }: { reloadKey: number }) {
  const t = useT();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [history, setHistory] = useState<WhatsAppBroadcast[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [variables, setVariables] = useState<string[]>(['']);
  const [pace, setPace] = useState<WhatsAppPace>('standard');
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [active, setActive] = useState<WhatsAppBroadcast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextStatus, broadcasts] = await Promise.all([WhatsAppService.status(), WhatsAppService.list()]);
      setStatus(nextStatus);
      setHistory(broadcasts);

      if (nextStatus.allowed && nextStatus.configured) {
        const templateResult = await Promise.allSettled([WhatsAppService.templates()]);
        if (templateResult[0].status === 'fulfilled') setTemplates(templateResult[0].value);
      }

      // Customers must appear even when the Meta Cloud API is not configured
      // (WhatsApp Web setups still pick recipients from the customer list).
      const customerResult = await Promise.allSettled([CustomerService.list({ limit: 100 })]);
      if (customerResult[0].status === 'fulfilled') setCustomers(customerResult[0].value.customers);
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.whatsapp.loadError));
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
    if (active.status === 'COMPLETED' || active.status === 'FAILED') {
      void (async () => {
        try {
          const [nextStatus, broadcasts] = await Promise.all([WhatsAppService.status(), WhatsAppService.list()]);
          setStatus(nextStatus);
          setHistory(broadcasts);
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
        const campaign = await WhatsAppService.get(active.id);
        if (!cancelled) setActive(campaign); // new object → effect re-runs and re-arms
      } catch {
        // Transient failure: retry instead of stalling the panel.
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active]);

  const customersWithPhone = useMemo(
    () => customers.filter((customer) => customer.phone.trim() !== ''),
    [customers],
  );

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
    const chosen = customersWithPhone
      .filter((customer) => selectedIds.includes(customer.id))
      .map((customer) => ({ name: customer.name, phone: customer.phone }));

    const seen = new Set<string>();
    const merged: Recipient[] = [];
    for (const recipient of [...chosen, ...pastedRecipients]) {
      const key = recipient.phone.replace(/[^0-9]/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(recipient);
    }
    // Reshuffle every time a number is added or removed while shuffled, so the
    // send order never drops a recipient or repeats one.
    return shuffleSeed === null ? merged : seededShuffle(merged, shuffleSeed);
  }, [customersWithPhone, selectedIds, pastedRecipients, shuffleSeed]);

  const variableValues = variables.map((value) => value.trim()).filter((value) => value !== '');
  const count = recipients.length;
  const selectedTemplate = templates.find((template) => template.name === templateName) ?? null;
  const overBatch = status !== null && status.batchLimit > 0 && count > status.batchLimit;
  const estimateText =
    count === 0
      ? ''
      : count * PACE_DELAY_MS[pace] < 60_000
        ? msg(t, t.whatsapp.estimateUnderMinute)
        : interpolate(msg(t, t.whatsapp.estimate), { minutes: estimateMinutes(count, pace) });
  const canSend = count > 0 && templateName !== '' && !sending && !overBatch;

  const toggleCustomer = (customerId: string) => {
    setSelectedIds((current) =>
      current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId],
    );
    setBatchNotice('');
  };

  const toggleAllCustomers = () => {
    const pick = selectWithinBatch(customersWithPhone, status?.batchLimit ?? 0);
    setSelectedIds(pick.ids);
    setBatchNotice(
      pick.capped
        ? interpolate(t.whatsapp.randomCap, { picked: pick.ids.length, limit: status?.batchLimit ?? 0 })
        : '',
    );
  };

  const startBroadcast = async () => {
    setSending(true);
    setError('');
    try {
      const campaign = await WhatsAppService.create({
        recipients,
        templateName,
        language: selectedTemplate?.language ?? 'fr',
        variables: variableValues,
        pace,
      });
      setActive(campaign);
      setConfirmOpen(false);
      setPaste('');
      setSelectedIds([]);
      setShuffleSeed(null);
      setBatchNotice('');
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.whatsapp.startError));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const statusLabel = (value: string) =>
    value === 'COMPLETED'
      ? t.whatsapp.statusCOMPLETED
      : value === 'FAILED'
        ? t.whatsapp.statusFAILED
        : value === 'PROCESSING'
          ? t.whatsapp.statusPROCESSING
          : t.whatsapp.statusPENDING;

  if (loading && !status) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6">
          <Skeleton className="h-4 w-4 rounded-full" />
          <span className="text-[13.5px] text-ink-muted">{t.whatsapp.loading}</span>
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
              {status.enabled === false ? t.whatsapp.disabledTitle : t.whatsapp.lockedTitle}
            </p>
            <p className="text-[13.5px] leading-relaxed text-warning-900/85 dark:text-warning-100/80">
              {status.enabled === false ? t.whatsapp.disabledBody : t.whatsapp.lockedBody}
            </p>
            {status.enabled === false ? null : (
              <Link to="/dashboard/billing" className="inline-block">
                <Button size="sm" variant="outline">
                  {t.whatsapp.upgrade}
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
            <Badge tone={status.remaining > 0 ? 'brand' : 'warning'} size="sm">
              {interpolate(t.whatsapp.remaining, { count: status.remaining })}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.whatsapp.usageSent, { sent: status.sentThisMonth, limit: status.monthlyLimit })}
            </p>
            <Progress
              className="mt-0"
              value={status.monthlyLimit > 0 ? (status.sentThisMonth / status.monthlyLimit) * 100 : 0}
              label={t.whatsapp.usageSent}
            />
            {!status.configured ? (
              <div className="rounded-xl border border-info-300/60 bg-info-50 p-4 dark:border-info-900/60 dark:bg-info-900/25">
                <p className="text-[13.5px] font-semibold text-info-900 dark:text-info-100">
                  {t.whatsapp.notConfiguredTitle}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-info-900/85 dark:text-info-100/80">
                  {t.whatsapp.notConfiguredBody}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {active ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-[15px]">{t.whatsapp.activeTitle}</CardTitle>
            <Badge tone={STATUS_TONE[active.status] ?? 'neutral'} size="sm">
              {statusLabel(active.status)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.whatsapp.activeBody, { sent: active.sent, total: active.totalRecipients })}
            </p>
            <Progress
              value={
                active.totalRecipients > 0 ? ((active.sent + active.failed) / active.totalRecipients) * 100 : 0
              }
              label={t.whatsapp.activeTitle}
            />
            {active.status === 'FAILED' && active.lastError ? (
              <p className="text-[13px] text-danger-600 dark:text-danger-300">{msg(t, active.lastError)}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {status?.allowed && status.configured ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">{t.whatsapp.recipientsSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-ink-muted">
                  {interpolate(t.whatsapp.selectedCount, { count })}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={customersWithPhone.length === 0 || (selectedIds.length === customersWithPhone.length && pastedRecipients.length === 0)}
                    onClick={toggleAllCustomers}
                  >
                    {t.whatsapp.selectAll}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={count < 2}
                    title={t.whatsapp.randomizeHint}
                    onClick={() => setShuffleSeed(Date.now())}
                  >
                    <Shuffle className="h-3.5 w-3.5" aria-hidden />
                    {t.whatsapp.randomize}
                  </Button>
                  {selectedIds.length > 0 || pastedRecipients.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setSelectedIds([]);
                        setPaste('');
                        setShuffleSeed(null);
                        setBatchNotice('');
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t.whatsapp.clearSelection}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {t.whatsapp.customersSection}
                </p>
                {customersWithPhone.length === 0 ? (
                  <p className="text-[13px] text-ink-subtle">{t.whatsapp.customersEmpty}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {customersWithPhone.map((customer) => {
                      const chosen = selectedIds.includes(customer.id);
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

              <Field label={t.whatsapp.recipientsLabel} htmlFor="wa-paste" hint={t.whatsapp.recipientsHint}>
                <Textarea
                  id="wa-paste"
                  rows={5}
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder="Ada, 22345678"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">{t.whatsapp.templateSection}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label={t.whatsapp.templateLabel} htmlFor="wa-template">
                <Select id="wa-template" value={templateName} onChange={(event) => setTemplateName(event.target.value)}>
                  <option value="">{t.whatsapp.templatePlaceholder}</option>
                  {templates.map((template) => (
                    <option key={`${template.name}-${template.language}`} value={template.name}>
                      {template.name} ({template.language})
                    </option>
                  ))}
                </Select>
              </Field>
              {templates.length === 0 ? <p className="text-[13px] text-ink-subtle">{t.whatsapp.templatesEmpty}</p> : null}

              {selectedTemplate?.body ? (
                <div className="space-y-1.5">
                  <Label>{t.whatsapp.messagePreview}</Label>
                  <div
                    data-testid="wa-preview"
                    className="rounded-2xl rounded-tl-sm border border-line bg-surface-2/70 px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink"
                  >
                    {renderPreview(selectedTemplate.body, variables)}
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-subtle">
                  {templateName !== '' ? t.whatsapp.previewUnavailable : t.whatsapp.previewMissing}
                </p>
              )}
              <p className="text-[12.5px] text-ink-subtle">{t.whatsapp.metaHint}</p>
              <a
                href="https://developers.facebook.com/docs/whatsapp/message-templates"
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                {t.whatsapp.metaHelp}
              </a>

              <div className="space-y-2.5">
                <Label>{t.whatsapp.variablesSection}</Label>
                <p className="text-[12.5px] text-ink-subtle">{t.whatsapp.variablesHint}</p>
                {variables.map((value, index) => (
                  <Input
                    key={index}
                    value={value}
                    aria-label={interpolate(t.whatsapp.variableLabel, { index: index + 1 })}
                    placeholder={`{{${index + 1}}}`}
                    onChange={(event) =>
                      setVariables((current) =>
                        current.map((entry, entryIndex) => (entryIndex === index ? event.target.value : entry)),
                      )
                    }
                  />
                ))}
                {variables.length < 10 ? (
                  <Button variant="ghost" size="xs" onClick={() => setVariables((current) => [...current, ''])}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t.whatsapp.addVariable}
                  </Button>
                ) : null}
              </div>

              <Field label={t.whatsapp.paceLabel} htmlFor="wa-pace" hint={t.whatsapp.paceHint}>
                <Select
                  id="wa-pace"
                  value={pace}
                  onChange={(event) => setPace(event.target.value as WhatsAppPace)}
                >
                  <option value="fast">{t.whatsapp.paceFast}</option>
                  <option value="standard">{t.whatsapp.paceStandard}</option>
                  <option value="relaxed">{t.whatsapp.paceRelaxed}</option>
                </Select>
              </Field>
              {estimateText !== '' ? (
                <p className="text-[12.5px] text-ink-muted" data-testid="wa-estimate">
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

              <Button disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                <Send className="h-4 w-4" aria-hidden />
                {count > 0 ? interpolate(t.whatsapp.sendTo, { count }) : t.whatsapp.send}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">{t.whatsapp.historySection}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-[13.5px] text-ink-subtle">{t.whatsapp.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((campaign) => (
                <li
                  key={campaign.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3"
                >
                  <span className="text-[13.5px] font-medium text-ink">{campaign.templateName}</span>
                  <span className="numeric text-[13px] text-ink-muted">
                    {campaign.sent}/{campaign.totalRecipients}
                  </span>
                  <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'} size="sm">
                    {statusLabel(campaign.status)}
                  </Badge>
                  <time dateTime={campaign.createdAt} className="text-[12.5px] text-ink-subtle">
                    {new Date(campaign.createdAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t.whatsapp.confirmTitle}
        description={`${interpolate(t.whatsapp.confirmBody, { count })}${
          estimateText !== '' ? ` ${estimateText}` : ''
        }`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void startBroadcast()} disabled={sending}>
              <Send className="h-4 w-4" aria-hidden />
              {t.whatsapp.send}
            </Button>
          </>
        }
      />
    </div>
  );
}
