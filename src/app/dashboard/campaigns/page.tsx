"use client";

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Megaphone, Plus } from 'lucide-react';
import { useCampaign } from '@/hooks/useCampaign';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableWrap,
} from '@/components/ui/table';
import {
  CampaignService,
  type Campaign,
  type CampaignStatusKey,
} from '@/services/campaign.service';
import { msg, type Dictionary } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';

interface CampaignForm {
  id?: string;
  name: string;
  description: string;
  startsOn: string;
  endsOn: string;
  status: CampaignStatusKey;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_OPTIONS: CampaignStatusKey[] = ['draft', 'scheduled', 'active', 'paused', 'completed', 'archived'];
const DESKTOP_QUERY = '(min-width: 768px)';

const STATUS_TONES: Record<CampaignStatusKey, BadgeTone> = {
  draft: 'neutral',
  scheduled: 'info',
  active: 'success',
  paused: 'warning',
  completed: 'brand',
  archived: 'neutral',
};

function dateValue(value: string): string {
  return value ? value.slice(0, 10) : '';
}

function campaignForm(campaign?: Campaign): CampaignForm {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...(campaign ? { id: campaign.id } : {}),
    name: campaign?.name ?? '',
    description: campaign?.description ?? '',
    startsOn: campaign ? dateValue(campaign.startsAt) : today,
    endsOn: campaign ? dateValue(campaign.endsAt) : new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10),
    status: campaign?.status ?? 'draft',
  };
}

function toStartIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function toEndIso(value: string): string {
  return `${value}T23:59:59.999Z`;
}

function displayDate(value: string, fallback: string): string {
  return value ? new Date(value).toLocaleDateString() : fallback;
}

function statusLabel(t: Dictionary, status: CampaignStatusKey): string {
  const labels: Record<CampaignStatusKey, string> = {
    draft: t.campaigns.statusDraft,
    scheduled: t.campaigns.statusScheduled,
    active: t.campaigns.statusActive,
    paused: t.campaigns.statusPaused,
    completed: t.campaigns.statusCompleted,
    archived: t.campaigns.statusArchived,
  };
  return labels[status] ?? status;
}

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

export default function CampaignsPage() {
  const t = useT();
  const { campaigns, loading, error, refetch } = useCampaign();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDesktop = useIsDesktop();
  const closeForm = useCallback(() => setForm(null), []);

  const run = async (id: string | null, action: () => Promise<unknown>) => {
    setBusyId(id ?? 'new-campaign');
    setActionError(null);
    setActionMessage(null);

    try {
      await action();
      await refetch();
    } catch (cause) {
      setActionError(msg(t, cause instanceof Error ? cause.message : 'The action failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = (campaign: Campaign) => {
    const next: CampaignStatusKey = campaign.status === 'active' ? 'paused' : 'active';
    void run(campaign.id, () => CampaignService.updateCampaign(campaign.id, { status: next }));
  };

  const saveCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    if (form.endsOn < form.startsOn) {
      setActionError(t.campaigns.endDateError);
      return;
    }

    setBusyId(form.id ?? 'new-campaign');
    setActionError(null);
    setActionMessage(null);

    try {
      const dates = { startsAt: toStartIso(form.startsOn), endsAt: toEndIso(form.endsOn) };
      if (form.id) {
        await CampaignService.updateCampaign(form.id, {
          name: form.name,
          description: form.description,
          status: form.status,
          ...dates,
        });
        setActionMessage(t.campaigns.updated);
      } else {
        await CampaignService.createCampaign({
          name: form.name,
          description: form.description,
          status: form.status,
          ...dates,
        });
        setActionMessage(t.campaigns.created);
      }
      await refetch();
      setForm(null);
    } catch (cause) {
      setActionError(msg(t, cause instanceof Error ? cause.message : 'Unable to save the campaign.'));
    } finally {
      setBusyId(null);
    }
  };

  const deleteCampaign = async () => {
    if (!form?.id) return;
    setBusyId(form.id);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await CampaignService.deleteCampaign(form.id);
      await refetch();
      setActionMessage(result.archived
        ? t.campaigns.archivedNotice
        : t.campaigns.deleted);
      setForm(null);
      setConfirmDelete(false);
    } catch (cause) {
      setActionError(msg(t, cause instanceof Error ? cause.message : 'Unable to delete the campaign.'));
    } finally {
      setBusyId(null);
    }
  };

  const campaignActions = (campaign: Campaign, size: 'xs' | 'sm') => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="outline"
        size={size}
        disabled={busyId === campaign.id}
        onClick={() => { setForm(campaignForm(campaign)); setConfirmDelete(false); }}
      >
        {t.common.edit}
      </Button>
      <Button asChild variant="outline" size={size}>
        <Link to={`/dashboard/wheel?campaign=${encodeURIComponent(campaign.id)}`}>
          {t.campaigns.configureWheel}
        </Link>
      </Button>
      <Button asChild variant="outline" size={size}>
        <Link to={`/dashboard/analytics?campaign=${encodeURIComponent(campaign.id)}`}>
          {t.campaigns.viewAnalytics}
        </Link>
      </Button>
      <Button
        variant="outline"
        size={size}
        disabled={busyId === campaign.id}
        onClick={() => run(campaign.id, () => CampaignService.duplicateCampaign(campaign.id))}
      >
        {t.campaigns.duplicate}
      </Button>
      {!['completed', 'archived'].includes(campaign.status) && (
        <Button
          variant="outline"
          size={size}
          disabled={busyId === campaign.id}
          onClick={() => handleToggleStatus(campaign)}
        >
          {campaign.status === 'active' ? t.campaigns.deactivate : t.campaigns.activate}
        </Button>
      )}
    </div>
  );

  const list =
    campaigns.length === 0 ? (
      <EmptyState
        icon={Megaphone}
        title={t.campaigns.emptyTitle}
        description={t.campaigns.emptyDescription}
      />
    ) : isDesktop ? (
      <Card>
        <TableWrap>
          <Table density="compact">
            <TableHead>
              <TableRow>
                <TableHeadCell>{t.campaigns.columnCampaign}</TableHeadCell>
                <TableHeadCell>{t.campaigns.columnStatus}</TableHeadCell>
                <TableHeadCell>{t.campaigns.columnSchedule}</TableHeadCell>
                <TableHeadCell className="text-right">{t.campaigns.columnParticipants}</TableHeadCell>
                <TableHeadCell className="text-right">{t.campaigns.columnConversion}</TableHeadCell>
                <TableHeadCell className="text-right">{t.campaigns.columnActions}</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} interactive>
                  <TableCell className="max-w-[18rem]">
                    <p className="truncate font-semibold text-ink">{campaign.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-muted">
                      {campaign.description || t.campaigns.noDescription}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" tone={STATUS_TONES[campaign.status]} dot>
                      {statusLabel(t, campaign.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-[12.5px] text-ink-muted">
                      <span className="text-ink-subtle">{t.campaigns.starts} </span>
                      {displayDate(campaign.startsAt, t.campaigns.notSet)}
                    </p>
                    <p className="text-[12.5px] text-ink-muted">
                      <span className="text-ink-subtle">{t.campaigns.ends} </span>
                      {displayDate(campaign.endsAt, t.campaigns.notSet)}
                    </p>
                  </TableCell>
                  <TableCell numeric>{campaign.participantCount}</TableCell>
                  <TableCell numeric>{campaign.conversionRate}%</TableCell>
                  <TableCell>{campaignActions(campaign, 'xs')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </Card>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        {campaigns.map((campaign) => (
          <Card key={campaign.id} className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-semibold text-ink">{campaign.name}</h3>
                <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">
                  {campaign.description || t.campaigns.noDescription}
                </p>
              </div>
              <Badge size="sm" tone={STATUS_TONES[campaign.status]} dot>
                {statusLabel(t, campaign.status)}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.campaigns.starts}
                </dt>
                <dd className="mt-1 text-[13px] text-ink">
                  {displayDate(campaign.startsAt, t.campaigns.notSet)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.campaigns.ends}
                </dt>
                <dd className="mt-1 text-[13px] text-ink">
                  {displayDate(campaign.endsAt, t.campaigns.notSet)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.campaigns.columnParticipants}
                </dt>
                <dd className="numeric mt-1 text-[13px] text-ink">{campaign.participantCount}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.campaigns.columnConversion}
                </dt>
                <dd className="numeric mt-1 text-[13px] font-medium text-brand-700 dark:text-accent-bright">
                  {campaign.conversionRate}%
                </dd>
              </div>
            </dl>

            {campaignActions(campaign, 'sm')}
          </Card>
        ))}
      </div>
    );

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow={t.nav.workspace}
          title={t.campaigns.title}
          description={t.campaigns.description}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <p role="status" className="sr-only">{t.campaigns.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow={t.nav.workspace}
          title={t.campaigns.title}
          description={t.campaigns.description}
        />
        <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          <h3 className="text-sm font-semibold">{t.campaigns.errorTitle}</h3>
          <p className="mt-1.5 leading-relaxed">{error.message}</p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={refetch}>{t.common.retry}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.nav.workspace}
        title={t.campaigns.title}
        description={t.campaigns.description}
        actions={
          <Button
            size="sm"
            onClick={() => { setForm(campaignForm()); setConfirmDelete(false); }}
            disabled={busyId !== null}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t.campaigns.newCampaign}
          </Button>
        }
      />

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-danger-300/60 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div
          role="status"
          className="rounded-xl border border-success-300/60 bg-success-50 p-4 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
        >
          {actionMessage}
        </div>
      )}

      {list}

      <Modal
        open={form !== null}
        onClose={closeForm}
        title={form?.id ? t.campaigns.editCampaign : t.campaigns.newCampaignTitle}
        description={t.campaigns.campaignDetails}
        size="md"
        closeOnBackdrop={busyId === null}
      >
        {form && (
          <form className="flex flex-col gap-5" onSubmit={(event) => void saveCampaign(event)}>
            <Field label={t.campaigns.campaignName} htmlFor="campaign-name">
              <Input
                id="campaign-name"
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>

            <Field label={t.campaigns.descriptionLabel} htmlFor="campaign-description">
              <Textarea
                id="campaign-description"
                maxLength={1000}
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>

            <fieldset className="min-w-0">
              <legend className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <CalendarDays className="h-4 w-4 text-ink-subtle" aria-hidden />
                {t.campaigns.duration}
              </legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label={t.campaigns.from} htmlFor="campaign-starts-on">
                  <Input
                    id="campaign-starts-on"
                    required
                    type="date"
                    value={form.startsOn}
                    onChange={(event) => setForm({ ...form, startsOn: event.target.value })}
                  />
                </Field>
                <Field label={t.campaigns.until} htmlFor="campaign-ends-on">
                  <Input
                    id="campaign-ends-on"
                    required
                    type="date"
                    min={form.startsOn}
                    value={form.endsOn}
                    onChange={(event) => setForm({ ...form, endsOn: event.target.value })}
                  />
                </Field>
              </div>
            </fieldset>

            <Field label={t.campaigns.statusField} htmlFor="campaign-status">
              <Select
                id="campaign-status"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as CampaignStatusKey })}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{statusLabel(t, status)}</option>
                ))}
              </Select>
            </Field>

            {actionError && (
              <p
                role="alert"
                className="rounded-lg border border-danger-300/60 bg-danger-50 px-3.5 py-2.5 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
              >
                {actionError}
              </p>
            )}

            {confirmDelete && (
              <div
                role="alertdialog"
                aria-label={t.campaigns.confirmDeleteAria}
                className="rounded-lg border border-danger-300/60 bg-danger-50 p-4 dark:border-danger-900/60 dark:bg-danger-900/30"
              >
                <p className="text-[13px] leading-relaxed text-danger-800 dark:text-danger-200">
                  {t.campaigns.confirmDeleteText}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={busyId !== null}>{t.common.cancel}</Button>
                  <Button type="button" variant="danger" onClick={() => void deleteCampaign()} disabled={busyId !== null}>{t.campaigns.confirmDelete}</Button>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
              {form.id ? (
                <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)} disabled={busyId !== null}>{t.campaigns.deleteCampaign}</Button>
              ) : <span />}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={busyId !== null}>{t.common.cancel}</Button>
                <Button
                  type="submit"
                  disabled={busyId !== null || !form.name.trim() || !form.startsOn || !form.endsOn || form.endsOn < form.startsOn}
                >
                  {busyId ? t.common.saving : form.id ? t.campaigns.saveChanges : t.campaigns.createCampaign}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}