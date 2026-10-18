import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, Paperclip, RefreshCw, Send, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Label } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { CustomerService, type Customer } from '@/services/customer.service';
import {
  EmailService,
  type EmailAsset,
  type EmailCampaign,
  type EmailRecipient,
  type EmailStatus,
} from '@/services/email.service';
import { readCachedResource, setCachedResource } from '@/hooks/useCachedResource';

const STATUS_TONE = {
  PENDING: 'info',
  PROCESSING: 'brand',
  PAUSED: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
} as const;
const ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function renderVariables(
  template: string,
  values: { name: string; email: string; link: string },
): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/g, values.name)
    .replace(/\{\{\s*email\s*\}\}/g, values.email)
    .replace(/\{\{\s*link\s*\}\}/g, values.link);
}

export default function EmailPage() {
  const t = useT();
  // Seeded from the SWR cache so revisits paint instantly.
  const [status, setStatus] = useState<EmailStatus | null>(() => readCachedResource<EmailStatus>('email:status'));
  const [history, setHistory] = useState<EmailCampaign[]>(() => readCachedResource<EmailCampaign[]>('email:history') ?? []);
  const [senderName, setSenderName] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');
  const [asset, setAsset] = useState<EmailAsset | null>(null);
  const [assetError, setAssetError] = useState('');
  const [assetUploading, setAssetUploading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(
    () => readCachedResource('email:status') === null || readCachedResource('email:history') === null,
  );
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [success, setSuccess] = useState<{
    sent: number;
    failed: number;
    total: number;
    remaining: number;
    pending: boolean;
  } | null>(null);

  // `force` bypasses the fresh-skip: the 4s polling loop, the post-broadcast
  // refresh and the manual refresh buttons must always re-read from the API.
  const load = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    setError('');
    const cachedStatus = readCachedResource<EmailStatus>('email:status');
    const cachedHistory = readCachedResource<EmailCampaign[]>('email:history');
    if (!force && cachedStatus && cachedHistory) {
      setStatus(cachedStatus);
      setHistory(cachedHistory);
      setLoading(false);

      // The customer picker is optional — never let it fail the page.
      try {
        setCustomers((await CustomerService.list({ limit: 100 })).customers);
      } catch {
        // Customers stay empty; the page still works without a picker.
      }
      return;
    }

    try {
      const [nextStatus, campaigns] = await Promise.all([EmailService.status(), EmailService.list()]);
      setCachedResource('email:status', nextStatus);
      setCachedResource('email:history', campaigns);
      setStatus(nextStatus);
      setHistory(campaigns);

      // The customer picker is optional — never let it fail the page.
      try {
        setCustomers((await CustomerService.list({ limit: 100 })).customers);
      } catch {
        // Customers stay empty; the page still works without a picker.
      }
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.email.loadError));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sending) return undefined;
    const timer = window.setInterval(() => {
      setSendProgress((value) => Math.min(value + 7, 90));
    }, 150);
    return () => window.clearInterval(timer);
  }, [sending]);

  // Queued campaigns finish in the background — keep re-reading the history
  // while one is in flight so PENDING rows resolve into their final status.
  useEffect(() => {
    const active = history.some(
      (campaign) => campaign.status === 'PENDING' || campaign.status === 'PROCESSING' || campaign.status === 'PAUSED',
    );
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      void load({ force: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [history, load]);

  const customersWithEmail = useMemo(
    () => customers.filter((customer) => customer.email.trim() !== ''),
    [customers],
  );

  const recipients = useMemo(() => {
    const chosenCustomers = customersWithEmail
      .filter((customer) => selectedCustomerIds.includes(customer.id))
      .map((customer) => ({
        email: customer.email,
        ...(customer.firstName || customer.lastName ? { name: customer.name } : {}),
      }));

    const seen = new Set<string>();
    const merged: EmailRecipient[] = [];
    for (const recipient of chosenCustomers) {
      const key = recipient.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(recipient);
    }
    return merged;
  }, [customersWithEmail, selectedCustomerIds]);

  const count = recipients.length;
  const locked = status !== null && !status.allowed;
  const composerEnabled = status !== null && status.allowed && status.configured;
  const overBatch = status !== null && status.batchLimit > 0 && count > status.batchLimit;
  const broadcastInFlight = history.some((campaign) =>
    campaign.status === 'PENDING' || campaign.status === 'PROCESSING' || campaign.status === 'PAUSED',
  );
  const hasBody = content.trim() !== '' || asset !== null;
  const canSend =
    composerEnabled &&
    count > 0 &&
    senderName.trim() !== '' &&
    subject.trim() !== '' &&
    hasBody &&
    !overBatch &&
    (status?.remaining ?? 0) > 0 &&
    !sending &&
    !broadcastInFlight &&
    !assetUploading;

  const previewValues = {
    name: recipients[0]?.name || 'John Doe',
    email: recipients[0]?.email || 'ada@example.com',
    link: link.trim() || 'https://example.com',
  };
  const assetPreviewHtml = asset
    ? asset.mime.startsWith('image/')
      ? `<p style="margin:16px 0"><img src="${asset.url}" alt="${escapeHtml(asset.name)}" style="max-width:100%;border-radius:8px"></p>`
      : `<p style="margin:16px 0;color:#6b7280">📎 ${escapeHtml(asset.name)}</p>`
    : '';
  const previewHtml = renderVariables(content, previewValues) + assetPreviewHtml;

  const handleAssetFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAssetError('');
    if (!ASSET_MIME_TYPES.includes(file.type)) {
      setAssetError(t.email.assetInvalid);
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setAssetError(t.email.assetTooLarge);
      return;
    }
    setAssetUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error('Unable to read the file.'));
        reader.readAsDataURL(file);
      });
      setAsset(await EmailService.uploadAsset({ name: file.name, mimeType: file.type, dataBase64 }));
    } catch {
      setAssetError(t.email.assetInvalid);
    } finally {
      setAssetUploading(false);
    }
  };

  const clearAsset = () => {
    setAsset(null);
    setAssetError('');
  };

  const toggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((current) =>
      current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId],
    );
  };

  const startBroadcast = async () => {
    setSendProgress(0);
    setSending(true);
    setError('');
    try {
      const result = await EmailService.broadcast({
        senderName: senderName.trim(),
        subject: subject.trim(),
        content,
        link: link.trim() || undefined,
        asset: asset ? { id: asset.id } : undefined,
        recipients,
      });
      const pending = result.campaign.status === 'PENDING';
      setSuccess({
        sent: result.campaign.sent,
        failed: result.campaign.failed,
        total: result.campaign.totalRecipients,
        remaining: result.usage.remaining,
        pending,
      });
      setConfirmOpen(false);
      clearAsset();
      setSelectedCustomerIds([]);
      void load({ force: true });
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : t.email.startError));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const statusLabel = (value: string) => {
    const key = `status${value}` as keyof typeof t.email;
    const label = t.email[key];
    return typeof label === 'string' ? label : value;
  };

  if (loading && !status) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Skeleton className="h-4 w-4 rounded-full" />
            <span className="text-[13.5px] text-ink-muted">{t.email.loading}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow={t.email.eyebrow} title={t.email.title} description={t.email.description} />
        <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {error}
        </div>
        <Button variant="outline" onClick={() => void load({ force: true })}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  const usageCard =
    status && status.allowed ? (
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-[15px]">{t.billing.usage}</CardTitle>
          <Badge tone={status.remaining > 0 ? 'brand' : 'warning'} size="sm">
            {interpolate(t.email.remaining, { count: status.remaining })}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] text-ink-muted">
            {interpolate(t.email.usageSent, { sent: status.sentThisMonth, limit: status.monthlyLimit })}
          </p>
          <Progress
            className="mt-0"
            value={status.monthlyLimit > 0 ? (status.sentThisMonth / status.monthlyLimit) * 100 : 0}
            label={t.email.usageSent}
          />
          {status.quota && status.quota.dailyLimit > 0 ? (
            <p
              className={
                (status.quota.dailyUsed ?? 0) >= status.quota.dailyLimit * 0.8
                  ? 'text-[13px] font-semibold text-warning-800 dark:text-warning-200'
                  : 'text-[13px] text-ink-muted'
              }
            >
              {interpolate(t.email.usageToday, {
                used: status.quota.dailyUsed ?? 0,
                limit: status.quota.dailyLimit,
              })}
            </p>
          ) : null}
          {status.suppressed ? (
            <p className="text-[13px] text-ink-muted">
              {interpolate(t.email.suppressedCount, { count: status.suppressed })}
            </p>
          ) : null}
          {!status.configured ? (
            <div className="rounded-xl border border-info-300/60 bg-info-50 p-4 dark:border-info-900/60 dark:bg-info-900/25">
              <p className="text-[13.5px] font-semibold text-info-900 dark:text-info-100">
                {t.email.notConfiguredTitle}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-info-900/85 dark:text-info-100/80">
                {t.email.notConfiguredBody}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    ) : null;

  const composer = (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-[15px]">{t.email.recipientsSection}</CardTitle>
          <Badge tone="neutral" size="sm">
            {interpolate(t.email.selectedCount, { count })}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-2/60 p-4">
            <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t.email.customersSection}
            </p>
            {customersWithEmail.length === 0 ? (
              <p className="text-[13px] text-ink-subtle">{t.email.customersEmpty}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {customersWithEmail.map((customer) => {
                  const chosen = selectedCustomerIds.includes(customer.id);
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      aria-pressed={chosen}
                      disabled={!composerEnabled}
                      onClick={() => toggleCustomer(customer.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150 ${
                        chosen
                          ? 'border-accent bg-accent-soft text-brand-800 dark:text-accent-bright'
                          : 'border-line bg-elevated text-ink-muted hover:border-line-strong'
                      }`}
                    >
                      <span className="font-medium">{customer.name}</span>
                      <span className="text-ink-subtle">{customer.email}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2.5 text-[12.5px] text-ink-subtle">{t.email.customersHint}</p>
          </div>

          {overBatch ? (
            <p
              role="alert"
              className="rounded-xl border border-warning-300/60 bg-warning-50 px-4 py-3 text-[13px] font-medium text-warning-900 dark:border-warning-900/60 dark:bg-warning-900/25 dark:text-warning-100"
            >
              {interpolate(t.email.batchWarning, {
                plan: status?.planName ?? '',
                limit: status?.batchLimit ?? 0,
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-[15px]">{t.email.campaignSection}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t.email.senderNameLabel} htmlFor="email-sender">
            <Input
              id="email-sender"
              value={senderName}
              disabled={!composerEnabled}
              onChange={(event) => setSenderName(event.target.value)}
              placeholder={t.email.senderNamePlaceholder}
            />
          </Field>
          <Field label={t.email.subjectLabel} htmlFor="email-subject">
            <Input
              id="email-subject"
              value={subject}
              disabled={!composerEnabled}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t.email.subjectPlaceholder}
            />
          </Field>
          <Field label={t.email.linkLabel} htmlFor="email-link" hint={t.email.linkHint}>
            <Input
              id="email-link"
              value={link}
              disabled={!composerEnabled}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://promo.example.com"
            />
          </Field>

          <div className="space-y-1.5">
            <Label htmlFor="email-asset">{t.email.assetLabel}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="email-asset"
                type="file"
                accept="image/jpeg,image/png,image/gif,application/pdf"
                className="sr-only"
                disabled={!composerEnabled || assetUploading}
                onChange={(event) => void handleAssetFile(event)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!composerEnabled || assetUploading}
                onClick={() => document.getElementById('email-asset')?.click()}
              >
                <Paperclip className="h-3.5 w-3.5" aria-hidden />
                {assetUploading ? t.email.assetUploading : t.email.assetUpload}
              </Button>
              {asset ? (
                <span className="max-w-56 truncate text-[12.5px] text-ink-muted" title={asset.name}>
                  {asset.name}
                </span>
              ) : null}
              {asset ? (
                <Button type="button" variant="ghost" size="xs" onClick={clearAsset}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t.email.assetRemove}
                </Button>
              ) : null}
            </div>
            <p className="text-[12.5px] text-ink-subtle">{t.email.assetHint}</p>
            {assetError ? (
              <p role="alert" className="text-[12.5px] font-medium text-danger-600 dark:text-danger-300">
                {assetError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-content">{t.email.contentLabel}</Label>
            <Tabs
              value={mode}
              onChange={(next) => setMode(next === 'preview' ? 'preview' : 'edit')}
              aria-label={t.email.contentLabel}
              idPrefix="email-editor"
              items={[
                { value: 'edit', label: t.email.editTab },
                { value: 'preview', label: t.email.previewTab },
              ]}
            />
            <TabPanel value="edit" active={mode} idPrefix="email-editor" className="space-y-2">
              <Textarea
                id="email-content"
                rows={10}
                value={content}
                disabled={!composerEnabled}
                onChange={(event) => setContent(event.target.value)}
                placeholder="<h1>Bonjour {{name}}</h1>"
              />
              <p className="text-[12.5px] text-ink-subtle">{t.email.contentHint}</p>
            </TabPanel>
            <TabPanel value="preview" active={mode} idPrefix="email-editor" className="space-y-2">
              <div
                className="min-h-40 overflow-x-auto rounded-md border border-line bg-elevated p-4 text-[14px] leading-relaxed text-ink [&_a]:text-brand-600 [&_a]:underline [&_img]:max-w-full [&_table]:w-full"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
              <p className="text-[12.5px] text-ink-subtle">{t.email.previewSample}</p>
            </TabPanel>
          </div>

          <div className="flex justify-end pt-1">
            <Button disabled={!canSend} onClick={() => setConfirmOpen(true)}>
              <Send className="h-4 w-4" aria-hidden />
              {count > 0 ? interpolate(t.email.sendTo, { count }) : t.email.send}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const historyCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">{t.email.historySection}</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-[13.5px] text-ink-subtle">{t.email.historyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((campaign) => (
              <li
                key={campaign.id}
                className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="truncate text-[13.5px] font-medium text-ink">
                    {campaign.assetName ? (
                      <Paperclip className="mr-1 inline h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                    ) : null}
                    {campaign.subject}
                  </span>
                  <span className="numeric text-[13px] text-ink-muted">
                    {campaign.sent}/{campaign.totalRecipients}
                  </span>
                  <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'} size="sm">
                    {statusLabel(campaign.status)}
                  </Badge>
                  <time dateTime={campaign.createdAt} className="text-[12.5px] text-ink-subtle">
                    {new Date(campaign.createdAt).toLocaleDateString()}
                  </time>
                </div>
                {campaign.lastError ? (
                  <p role="alert" className="text-[12.5px] font-medium text-danger-600 dark:text-danger-300">
                    {interpolate(t.email.historyError, { message: campaign.lastError })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.email.eyebrow}
        title={t.email.title}
        description={t.email.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load({ force: true })}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t.email.refresh}
          </Button>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger-300/60 bg-danger-50 px-4 py-3 text-[13.5px] text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </p>
      ) : null}

      {success ? (
        <div
          role="status"
          className={
            success.pending
              ? 'flex items-start gap-3.5 rounded-xl border border-info-300/60 bg-info-50 p-5 dark:border-info-900/60 dark:bg-info-900/25'
              : 'flex items-start gap-3.5 rounded-xl border border-success-300/60 bg-success-50 p-5 dark:border-success-900/60 dark:bg-success-900/25'
          }
        >
          <span
            className={
              success.pending
                ? 'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-100 text-info-800 dark:bg-info-900/60 dark:text-info-200'
                : 'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-100 text-success-800 dark:bg-success-900/60 dark:text-success-200'
            }
          >
            {success.pending ? (
              <RefreshCw className="h-4 w-4" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p
              className={
                success.pending
                  ? 'text-[14px] font-semibold text-info-900 dark:text-info-100'
                  : 'text-[14px] font-semibold text-success-900 dark:text-success-100'
              }
            >
              {success.pending ? t.email.pendingTitle : t.email.successTitle}
            </p>
            <p
              className={
                success.pending
                  ? 'text-[13.5px] leading-relaxed text-info-900/85 dark:text-info-100/80'
                  : 'text-[13.5px] leading-relaxed text-success-900/85 dark:text-success-100/80'
              }
            >
              {success.pending
                ? interpolate(t.email.pendingBody, { total: success.total })
                : interpolate(t.email.successBody, { sent: success.sent, total: success.total })}
            </p>
            {!success.pending && success.failed > 0 ? (
              <p className="text-[13.5px] leading-relaxed text-success-900/85 dark:text-success-100/80">
                {interpolate(t.email.successFailed, { failed: success.failed })}
              </p>
            ) : null}
            <p
              className={
                success.pending
                  ? 'text-[13.5px] leading-relaxed text-info-900/85 dark:text-info-100/80'
                  : 'text-[13.5px] leading-relaxed text-success-900/85 dark:text-success-100/80'
              }
            >
              {interpolate(t.email.successRemaining, { remaining: success.remaining })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            aria-label={t.email.dismiss}
            className={
              success.pending
                ? 'rounded-md p-1 text-info-800/70 transition-colors hover:bg-info-100 hover:text-info-900 dark:text-info-200/70 dark:hover:bg-info-900/50'
                : 'rounded-md p-1 text-success-800/70 transition-colors hover:bg-success-100 hover:text-success-900 dark:text-success-200/70 dark:hover:bg-success-900/50'
            }
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {usageCard}

      {locked ? (
        <div className="relative">
          <div className="pointer-events-none select-none blur-[3px] opacity-60" aria-hidden="true">
            {composer}
          </div>
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 text-center shadow-soft">
              <span className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-warning-100 text-warning-800 dark:bg-warning-900/60 dark:text-warning-200">
                <Lock className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-[15px] font-semibold text-ink">
                {status?.enabled === false ? t.email.disabledTitle : t.email.lockedTitle}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
                {status?.enabled === false ? t.email.disabledBody : t.email.lockedBody}
              </p>
              {status?.enabled === false ? null : (
                <Link to="/dashboard/billing" className="mt-4 inline-block">
                  <Button>{t.email.upgrade}</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {composerEnabled ? composer : null}

      {!locked ? historyCard : null}

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!sending) setConfirmOpen(false);
        }}
        title={t.email.confirmTitle}
        description={interpolate(t.email.confirmBody, { count })}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void startBroadcast()} disabled={sending} loading={sending}>
              <Send className="h-4 w-4" aria-hidden />
              {t.email.send}
            </Button>
          </>
        }
      >
        {sending ? (
          <div className="space-y-3">
            <Progress value={sendProgress} label={t.email.sendingLabel} />
            <p className="text-[13px] text-ink-muted">{t.email.sendingLabel}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
