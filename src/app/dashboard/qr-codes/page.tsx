"use client";

import { useEffect, useState, type FormEvent } from 'react';import {
  Copy,
  Download,
  Link2,
  Plus,
  QrCode as QrCodeGlyph,
  Search,
  Users,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { EntityTile } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard, Spinner } from '@/components/ui/skeleton';
import { CampaignService, type Campaign } from '@/services/campaign.service';
import { QrCodeService, type QrCode } from '@/services/qr.service';
import { interpolate, msg } from '@/lib/i18n';
import { campaignStatsAllowedForPlan } from '@/lib/plan-catalog';
import { useDashboardBilling } from '@/contexts/billing-context';
import { useT } from '@/hooks/use-t';
import { readCachedResource, setCachedResource } from '@/hooks/useCachedResource';

function fileSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'qr-code';
}

// Archived campaigns refuse visitors, so a new QR must not point at one —
// their existing tiles already leave the list server-side.
function openCampaign(list: Campaign[]): Campaign | undefined {
  return list.find((campaign) => campaign.status !== 'archived');
}

function QrPreview({ qrCode }: { qrCode: QrCode }) {
  const t = useT();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    QRCode.toDataURL(qrCode.url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 512,
      color: { dark: '#173344', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [qrCode.url]);

  const handleDownload = () => {
    if (!dataUrl) return;

    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `${fileSlug(qrCode.name)}-qr-code.png`;
    anchor.click();
  };

  return (
    <div className="w-40 shrink-0">
      <div className="grid aspect-square w-40 place-items-center rounded-xl border border-line bg-white p-3 shadow-xs">
        {dataUrl ? (
          <img
            className="h-full w-full object-contain"
            src={dataUrl}
            alt={interpolate(t.qrcodes.qrAlt, { name: qrCode.name })}
          />
        ) : failed ? (
          <span className="px-2 text-center text-[12px] text-danger-700 dark:text-danger-300">
            {t.qrcodes.qrUnavailable}
          </span>
        ) : (
          <span role="status" aria-label={t.qrcodes.generatingAria} className="inline-flex">
            <Spinner className="h-6 w-6" />
          </span>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        onClick={handleDownload}
        disabled={!dataUrl}
        aria-label={interpolate(t.qrcodes.downloadAria, { name: qrCode.name })}
      >
        <Download className="h-4 w-4" aria-hidden />
        {dataUrl ? t.qrcodes.downloadPng : t.qrcodes.generating}
      </Button>
    </div>
  );
}

export default function QRCodesPage() {
  const t = useT();
  const { access } = useDashboardBilling();
  const showStats = campaignStatsAllowedForPlan(access?.plan.slug ?? null);
  const [search, setSearch] = useState('');
  // Seeded from the SWR cache so revisits paint instantly.
  const [qrCodes, setQrCodes] = useState<QrCode[]>(() => readCachedResource<QrCode[]>('qr:list') ?? []);
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => readCachedResource<Campaign[]>('qr:campaigns') ?? []);
  const [loading, setLoading] = useState(() => readCachedResource('qr:list') === null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formCampaignId, setFormCampaignId] = useState(() => openCampaign(readCachedResource<Campaign[]>('qr:campaigns') ?? [])?.id ?? '');
  const [formName, setFormName] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const cachedQr = readCachedResource<QrCode[]>('qr:list');
    const cachedCampaigns = readCachedResource<Campaign[]>('qr:campaigns');
    if (cachedQr) setQrCodes(cachedQr);
    if (cachedCampaigns) {
      setCampaigns(cachedCampaigns);
      setFormCampaignId((current) => current || openCampaign(cachedCampaigns)?.id || '');
    }
    // Every piece is cached and fresh: skip the network entirely.
    if (cachedQr && cachedCampaigns) return;

    Promise.all([
      cachedQr ? Promise.resolve(cachedQr) : QrCodeService.list(),
      cachedCampaigns ? Promise.resolve(cachedCampaigns) : CampaignService.getCampaigns({ limit: 100 }),
    ])
      .then(([qrList, campaignList]) => {
        if (!cachedQr) setCachedResource('qr:list', qrList);
        if (!cachedCampaigns) {
          setCachedResource('qr:campaigns', campaignList);
          setFormCampaignId(openCampaign(campaignList)?.id ?? '');
        }
        setQrCodes(qrList);
        setCampaigns(campaignList);
      })
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load QR codes.')),
      )
      .finally(() => setLoading(false));
  }, [t]);

  const filteredQRCodes = qrCodes.filter(
    (qrCode) =>
      qrCode.name.toLowerCase().includes(search.toLowerCase()) ||
      qrCode.campaignName.toLowerCase().includes(search.toLowerCase()) ||
      qrCode.location.toLowerCase().includes(search.toLowerCase()),
  );

  const formCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived');

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!formCampaignId) return;

    setSaving(true);
    setError(null);

    try {
      const created = await QrCodeService.create({
        campaignId: formCampaignId,
        name: formName,
        location: formLocation,
      });
      setQrCodes((current) => {
        const next = [created, ...current];
        setCachedResource('qr:list', next);
        return next;
      });
      setFormName('');
      setFormLocation('');
      setShowForm(false);
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to create the QR code.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (qrCode: QrCode) => {
    setError(null);

    try {
      const updated = await QrCodeService.update(qrCode.id, { active: !qrCode.active });
      setQrCodes((current) => {
        const next = current.map((item) => (item.id === updated.id ? updated : item));
        setCachedResource('qr:list', next);
        return next;
      });
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to update the QR code.'));
    }
  };

  const handleCopy = async (qrCode: QrCode) => {
    try {
      await navigator.clipboard.writeText(qrCode.url);
      setCopiedId(qrCode.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError(t.qrcodes.clipboardDenied);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.qrcodes.eyebrow}
        title={t.qrcodes.title}
        description={t.qrcodes.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowForm((value) => !value)}>
            {showForm ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {showForm ? t.common.close : t.qrcodes.createButton}
          </Button>
        }
        toolbar={
          <Field
            label={
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {t.qrcodes.searchLabel}
              </span>
            }
            htmlFor="qr-search"
            className="w-full max-w-md"
          >
            <Input
              id="qr-search"
              inputSize="sm"
              iconStart={<Search />}
              type="text"
              placeholder={t.qrcodes.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger-300/60 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t.qrcodes.campaignLabel} htmlFor="qr-campaign">
                <Select
                  id="qr-campaign"
                  value={formCampaignId}
                  onChange={(e) => setFormCampaignId(e.target.value)}
                  required
                >
                  <option value="">{t.qrcodes.selectCampaign}</option>
                  {formCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t.qrcodes.nameLabel} htmlFor="qr-name">
                <Input
                  id="qr-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t.qrcodes.namePlaceholder}
                />
              </Field>

              <Field label={t.qrcodes.locationLabel} htmlFor="qr-location">
                <Input
                  id="qr-location"
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder={t.qrcodes.locationPlaceholder}
                />
              </Field>
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button type="submit" disabled={saving || !formCampaignId} loading={saving}>
                {saving ? t.qrcodes.creating : t.common.create}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <p role="status" className="sr-only">{t.qrcodes.loading}</p>
        </div>
      ) : filteredQRCodes.length === 0 ? (
        <Card>
          <EmptyState
            icon={QrCodeGlyph}
            title={t.qrcodes.emptyTitle}
            description={t.qrcodes.emptyDescription}
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredQRCodes.map((qrCode) => (
            <Card key={qrCode.id} className="flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-5 sm:flex-row">
                  <QrPreview qrCode={qrCode} />

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start gap-3">
                      <EntityTile tone={qrCode.active ? 'brand' : 'neutral'}>
                        <QrCodeGlyph className="h-4 w-4" aria-hidden />
                      </EntityTile>
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold text-ink">{qrCode.name}</h3>
                        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                          {qrCode.campaignName}
                          {qrCode.location ? ` · ${qrCode.location}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge size="sm" tone={qrCode.active ? 'success' : 'neutral'} dot>
                        {qrCode.active ? t.common.active : t.common.inactive}
                      </Badge>
                      {showStats && (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                          <Users className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                          <span className="numeric font-medium text-ink">{qrCode.campaignParticipations}</span>
                          {t.qrcodes.participants}
                        </span>
                      )}
                    </div>

                    <p className="flex items-center gap-2 truncate rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink-muted">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
                      <span className="truncate">{qrCode.url}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleCopy(qrCode)}>
                    <Copy className="h-4 w-4" aria-hidden />
                    {copiedId === qrCode.id ? t.common.copied : t.qrcodes.copyLink}
                  </Button>
                  <Button
                    variant={qrCode.active ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => handleToggle(qrCode)}
                  >
                    {qrCode.active ? t.qrcodes.deactivate : t.qrcodes.activate}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12.5px] text-ink-subtle">
                <p>
                  <span className="font-medium text-ink-muted">{t.qrcodes.createdLabel}</span>{' '}
                  {new Date(qrCode.createdAt).toLocaleDateString()}
                </p>
                <span className="font-mono text-[12px]">{qrCode.publicCode}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}