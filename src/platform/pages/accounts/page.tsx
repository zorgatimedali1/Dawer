import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableWrap,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import {
  DEFAULT_WHEEL_THEME,
  WHEEL_MOTION_PRESETS,
  type WheelMotionPreset,
  type WheelTheme,
} from '@/lib/wheel-theme';
import {
  AccountsService,
  type PlatformAccount,
  type PlatformAccountDetail,
  type AccountPlayPolicy,
  type AccountStatus,
} from '@/platform/services/accounts.service';

type Tab = 'list' | 'detail';

export default function AccountsPage() {
  const [tab, setTab] = useState<Tab>('list');
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccountStatus | ''>('');
  const [detail, setDetail] = useState<PlatformAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [policyMode, setPolicyMode] = useState<AccountPlayPolicy['mode']>('off');
  const [policyPerDay, setPolicyPerDay] = useState(1);
  const [policyCooldown, setPolicyCooldown] = useState(0);
  const [wheelDraft, setWheelDraft] = useState<WheelTheme | null>(null);

  const closeSuspend = useCallback(() => {
    setSuspendTarget(null);
    setSuspendReason('');
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteReason('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await AccountsService.listAccounts({
        search: search || undefined,
        status: status || undefined,
        page,
        limit: 20,
      });
      setAccounts(result.accounts);
      setPagination(result.pagination);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load accounts.');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const openDetail = async (accountId: string) => {
    setError(null);
    try {
      const loaded = await AccountsService.getAccount(accountId);
      setDetail(loaded);
      setPolicyMode(loaded.playPolicy.mode);
      setPolicyPerDay(loaded.playPolicy.mode === 'windowed' ? loaded.playPolicy.perDay : 1);
      setPolicyCooldown(loaded.playPolicy.mode === 'windowed' ? loaded.playPolicy.cooldownMinutes : 0);
      // Seed the editor from what would be applied: an existing override
      // first, then the merchant's own theme, then the shipped default.
      setWheelDraft(loaded.wheelThemeOverride ?? loaded.wheelTheme ?? DEFAULT_WHEEL_THEME);
      setTab('detail');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the account.');
    }
  };

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(successMessage);
      await load();
      if (detail) setDetail(await AccountsService.getAccount(detail.account.id));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The action failed.');
    } finally {
      setBusy(false);
      closeSuspend();
    }
  };

  const confirmSuspend = () => {
    if (!suspendTarget || suspendReason.trim().length < 3) return;
    void run(() => AccountsService.suspend(suspendTarget, suspendReason.trim()), 'Account suspended.');
  };

  const toggleFeature = (
    key: 'whatsappEnabled' | 'emailEnabled' | 'wheelDesignEnabled' | 'rewardsEnabled',
    value: boolean,
  ) => {
    if (!detail) return;
    const label =
      key === 'whatsappEnabled'
        ? 'WhatsApp'
        : key === 'emailEnabled'
          ? 'Email marketing'
          : key === 'wheelDesignEnabled'
            ? 'Wheel design'
            : 'Rewards';
    void run(
      () => AccountsService.setFeatureAccess(detail.account.id, { [key]: value }),
      `${label} ${value ? 'enabled' : 'disabled'}.`,
    );
  };

  const savePolicy = () => {
    if (!detail) return;
    const clamp = (value: number, min: number, max: number) =>
      Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min;
    const policy: AccountPlayPolicy =
      policyMode === 'windowed'
        ? {
            mode: 'windowed',
            perDay: clamp(policyPerDay, 1, 20),
            cooldownMinutes: clamp(policyCooldown, 0, 10080),
          }
        : { mode: policyMode };
    void run(() => AccountsService.setPlayPolicy(detail.account.id, policy), 'Play policy updated.');
  };

  const setWheelColors = (patch: Partial<WheelTheme['colors']>) => {
    if (!wheelDraft) return;
    setWheelDraft({ ...wheelDraft, colors: { ...wheelDraft.colors, ...patch } });
  };

  const setSegmentColor = (index: number, color: string) => {
    if (!wheelDraft) return;
    const segments = wheelDraft.colors.segments.slice();
    segments[index] = color;
    setWheelColors({ segments });
  };

  const saveWheelDesign = () => {
    if (!detail || !wheelDraft) return;
    void run(() => AccountsService.setWheelTheme(detail.account.id, wheelDraft), 'Wheel design applied.');
  };

  const clearWheelDesign = () => {
    if (!detail) return;
    void run(() => AccountsService.clearWheelTheme(detail.account.id), 'Wheel design cleared.');
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteReason.trim().length < 3) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await AccountsService.remove(deleteTarget, deleteReason.trim());
      setNotice('Account deleted.');
      setDeleteTarget(null);
      setDeleteReason('');
      setDetail(null);
      setTab('list');
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Merchant accounts"
        description="Suspend or restore accounts and revoke their sessions across the platform"
        actions={
          tab === 'detail' ? (
            <Button variant="outline" onClick={() => setTab('list')}>
              Back to accounts
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <div
          role="status"
          className="rounded-lg border-l-4 border-success-400 bg-success-50 px-4 py-3 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      {tab === 'list' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-56 flex-1">
              <Field label={<span className="sr-only">Search accounts</span>} htmlFor="account-search">
                <Input
                  id="account-search"
                  type="search"
                  inputSize="sm"
                  placeholder="Search by email or name..."
                  value={search}
                  onChange={(event) => {
                    setPage(1);
                    setSearch(event.target.value);
                  }}
                />
              </Field>
            </div>
            <div>
              <Field label={<span className="sr-only">Filter by status</span>} htmlFor="account-status">
                <Select
                  id="account-status"
                  inputSize="sm"
                  value={status}
                  onChange={(event) => {
                    setPage(1);
                    setStatus(event.target.value as AccountStatus | '');
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              </Field>
            </div>
          </div>

          <Card>
            {loading ? (
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-600" />
                <p className="text-ink-muted">Loading accounts...</p>
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-ink-muted">No accounts match this filter.</p>
              </div>
            ) : (
              <>
                <TableWrap>
                  <Table density="compact">
                    <TableHead>
                      <TableRow>
                        <TableHeadCell>Account</TableHeadCell>
                        <TableHeadCell>Status</TableHeadCell>
                        <TableHeadCell className="text-right">Businesses</TableHeadCell>
                        <TableHeadCell className="text-right">Active sessions</TableHeadCell>
                        <TableHeadCell className="text-right">Last seen</TableHeadCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {accounts.map((account) => (
                        <TableRow
                          key={account.id}
                          interactive
                          role="button"
                          tabIndex={0}
                          onClick={() => void openDetail(account.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void openDetail(account.id);
                            }
                          }}
                          aria-label={`${account.firstName} ${account.lastName}`}
                        >
                          <TableCell>
                            <div className="flex w-full items-center gap-3 text-left">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright">
                                {(account.firstName || account.email).charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-ink">
                                  {account.firstName} {account.lastName}
                                </p>
                                <p className="truncate text-xs text-ink-muted">{account.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={account.status} />
                          </TableCell>
                          <TableCell numeric>{account.businessCount}</TableCell>
                          <TableCell numeric>{account.sessionCount}</TableCell>
                          <TableCell className="numeric text-right">
                            {account.lastSeenAt ? new Date(account.lastSeenAt).toLocaleDateString() : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>

                <div className="flex items-center justify-between border-t border-line px-5 py-3 sm:px-6">
                  <p className="text-sm text-ink-muted">
                    {pagination.total} account{pagination.total === 1 ? '' : 's'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2 text-sm text-ink-muted">
                      {pagination.page} / {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      ) : detail ? (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-medium text-ink">{detail.account.email}</h3>
                  <StatusBadge status={detail.account.status} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {detail.account.firstName} {detail.account.lastName} · joined{' '}
                  {new Date(detail.account.createdAt).toLocaleDateString()} ·{' '}
                  {detail.account.businessCount} business
                  {detail.account.businessCount === 1 ? '' : 'es'} · {detail.sessions.length} active session
                  {detail.sessions.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy || detail.account.status === 'SUSPENDED'}
                  onClick={() => setSuspendTarget(detail.account.id)}
                >
                  Suspend
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || detail.account.status === 'ACTIVE'}
                  onClick={() =>
                    void run(() => AccountsService.activate(detail.account.id), 'Account reactivated.')
                  }
                >
                  Reactivate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || detail.sessions.length === 0}
                  onClick={() =>
                    void run(() => AccountsService.revokeSessions(detail.account.id), 'All sessions revoked.')
                  }
                >
                  Revoke sessions
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDeleteTarget(detail.account.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>

          <DetailSection title="Businesses">
            {detail.businesses.length === 0 ? (
              <p className="text-sm text-ink-muted">No businesses on this account.</p>
            ) : (
              <ul className="divide-y divide-line">
                {detail.businesses.map((business) => (
                  <li key={business.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-ink">{business.name}</p>
                      <p className="text-xs text-ink-muted">/{business.slug}</p>
                    </div>
                    <Badge size="sm">{business.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection title="Play policy">
            <p className="mb-4 text-sm text-ink-muted">
              Hard override for every campaign on this account. When set, it replaces the merchant&apos;s own play
              rules; when off, each campaign uses its own rules.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Policy" htmlFor="play-policy-mode">
                <Select
                  id="play-policy-mode"
                  value={policyMode}
                  onChange={(event) => setPolicyMode(event.target.value as AccountPlayPolicy['mode'])}
                >
                  <option value="off">Off — merchant rules apply</option>
                  <option value="once">Once per visitor per campaign</option>
                  <option value="windowed">Limited — spins per 24 hours</option>
                </Select>
              </Field>
              {policyMode === 'windowed' && (
                <>
                  <Field label="Spins per day" htmlFor="play-policy-per-day">
                    <Input
                      id="play-policy-per-day"
                      type="number"
                      min={1}
                      max={20}
                      value={policyPerDay}
                      onChange={(event) => setPolicyPerDay(Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Cooldown (minutes)" htmlFor="play-policy-cooldown">
                    <Input
                      id="play-policy-cooldown"
                      type="number"
                      min={0}
                      max={10080}
                      value={policyCooldown}
                      onChange={(event) => setPolicyCooldown(Number(event.target.value))}
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="mt-4">
              <Button size="sm" disabled={busy || !detail} onClick={savePolicy}>
                {busy ? 'Saving...' : 'Save policy'}
              </Button>
            </div>
          </DetailSection>

          <DetailSection title="Wheel design">
            <p className="mb-4 text-sm text-ink-muted">
              Hard override for the wheel of every business on this account. When applied it beats the
              merchant&apos;s own design; clearing it hands control back. Merchants edit their own design
              when their plan carries the wheel criteria (design and hub logo = Pro and
              above), tuned from Plans. Accounts without the design flag always render the default design
              regardless of what is set here.
            </p>

            {!detail.designAllowed ? (
              <div
                className="mb-4 rounded-lg border-l-4 border-warning-400 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-900/60 dark:bg-warning-900/30 dark:text-warning-200"
                data-testid="wheel-design-starter"
              >
                This account is on the {detail.planSlug} plan — the wheel stays on the default design.
              </div>
            ) : null}

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge size="sm" tone={detail.wheelThemeOverride ? 'info' : 'outline'}>
                {detail.wheelThemeOverride ? 'Override active' : 'Merchant design in use'}
              </Badge>
              <Badge size="sm">{detail.planSlug}</Badge>
            </div>

            {wheelDraft ? (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink">Segment colors</span>
                  {wheelDraft.colors.segments.map((color, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <input
                        type="color"
                        aria-label={`Segment ${index + 1} color`}
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                        value={color}
                        disabled={busy}
                        onChange={(event) => setSegmentColor(index, event.target.value)}
                      />
                      <Input
                        aria-label={`Segment ${index + 1} hex value`}
                        className="numeric flex-1"
                        value={color}
                        disabled={busy}
                        onChange={(event) => setSegmentColor(index, event.target.value)}
                      />
                      {wheelDraft.colors.segments.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setWheelColors({
                              segments: wheelDraft.colors.segments.filter((_, position) => position !== index),
                            })
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {wheelDraft.colors.segments.length < 8 ? (
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setWheelColors({
                            segments: [
                              ...wheelDraft.colors.segments,
                              DEFAULT_WHEEL_THEME.colors.segments[
                                wheelDraft.colors.segments.length % DEFAULT_WHEEL_THEME.colors.segments.length
                              ] ?? '#2dd4bf',
                            ],
                          })
                        }
                      >
                        Add segment
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="Rim color" htmlFor="wheel-rim-color">
                    <div className="flex items-center gap-3">
                      <input
                        id="wheel-rim-color"
                        type="color"
                        aria-label="Rim color"
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                        value={wheelDraft.colors.rim}
                        disabled={busy}
                        onChange={(event) => setWheelColors({ rim: event.target.value })}
                      />
                      <Input
                        className="numeric flex-1"
                        value={wheelDraft.colors.rim}
                        disabled={busy}
                        onChange={(event) => setWheelColors({ rim: event.target.value })}
                      />
                    </div>
                  </Field>
                  <Field label="Pointer color" htmlFor="wheel-pointer-color">
                    <div className="flex items-center gap-3">
                      <input
                        id="wheel-pointer-color"
                        type="color"
                        aria-label="Pointer color"
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                        value={wheelDraft.colors.pointer}
                        disabled={busy}
                        onChange={(event) => setWheelColors({ pointer: event.target.value })}
                      />
                      <Input
                        className="numeric flex-1"
                        value={wheelDraft.colors.pointer}
                        disabled={busy}
                        onChange={(event) => setWheelColors({ pointer: event.target.value })}
                      />
                    </div>
                  </Field>
                  <Field label="Spin speed" htmlFor="wheel-motion">
                    <Select
                      id="wheel-motion"
                      value={wheelDraft.motion.preset}
                      disabled={busy}
                      onChange={(event) =>
                        setWheelDraft({ ...wheelDraft, motion: { preset: event.target.value as WheelMotionPreset } })
                      }
                    >
                      {WHEEL_MOTION_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset === 'fast' ? 'Fast (2s)' : preset === 'slow' ? 'Slow (6s)' : 'Standard (3.8s)'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <label className="mt-4 flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-600"
                    checked={wheelDraft.centerLogo}
                    disabled={busy}
                    onChange={(event) => setWheelDraft({ ...wheelDraft, centerLogo: event.target.checked })}
                  />
                  <span className="text-sm text-ink">Show the merchant&apos;s logo at the wheel center</span>
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={busy || !detail} onClick={saveWheelDesign}>
                    {busy ? 'Applying...' : 'Apply design'}
                  </Button>
                  {detail.wheelThemeOverride ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={clearWheelDesign}>
                      Clear override
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </DetailSection>

          <DetailSection title="Marketing access">
            <p className="mb-4 text-sm text-ink-muted">
              Control which marketing channels this account can use. These switches override the platform-wide
              controls for this account; existing history stays visible to the merchant.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FeatureSwitchRow
                id="account-whatsapp"
                label="WhatsApp marketing"
                description="Cloud API and gateway broadcasts"
                checked={detail.featureAccess?.whatsappEnabled ?? true}
                disabled={busy}
                onToggle={(value) => toggleFeature('whatsappEnabled', value)}
              />
              <FeatureSwitchRow
                id="account-email"
                label="Email marketing"
                description="Campaigns and newsletters"
                checked={detail.featureAccess?.emailEnabled ?? true}
                disabled={busy}
                onToggle={(value) => toggleFeature('emailEnabled', value)}
              />
            </div>
          </DetailSection>

          <DetailSection title="Wheel design access">
            <p className="mb-4 text-sm text-ink-muted">
              When off, no merchant of this account can edit wheel colours, motion, hub logo or step colours,
              regardless of plan. Existing designs keep rendering.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FeatureSwitchRow
                id="account-wheel-design"
                label="Wheel design editing"
                description="Colors, motion, hub logo and step colours"
                checked={detail.featureAccess?.wheelDesignEnabled ?? true}
                disabled={busy}
                onToggle={(value) => toggleFeature('wheelDesignEnabled', value)}
              />
            </div>
          </DetailSection>

          <DetailSection title="Rewards access">
            <p className="mb-4 text-sm text-ink-muted">
              When off, no merchant of this account can manage rewards or open the Récompenses page. Existing
              wheels keep paying out and the wheel&apos;s prize editing keeps working.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FeatureSwitchRow
                id="account-rewards"
                label="Rewards management"
                description="Prizes, stock and the Récompenses page"
                checked={detail.featureAccess?.rewardsEnabled ?? true}
                disabled={busy}
                onToggle={(value) => toggleFeature('rewardsEnabled', value)}
              />
            </div>
          </DetailSection>

          <div className="grid gap-6 md:grid-cols-2">
            <DetailSection title="Active sessions">
              {detail.sessions.length === 0 ? (
                <p className="text-sm text-ink-muted">No active sessions.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.sessions.map((session) => (
                    <li key={session.id} className="flex justify-between text-sm text-ink-muted">
                      <span>Started {new Date(session.createdAt).toLocaleString()}</span>
                      <span>expires {new Date(session.expiresAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection title="Sign-in methods">
              {detail.identities.length === 0 ? (
                <p className="text-sm text-ink-muted">Password sign-in only.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.identities.map((identity) => (
                    <li key={identity.providerAccountId} className="flex justify-between text-sm text-ink-muted">
                      <span className="capitalize">{identity.provider}</span>
                      <span>{identity.email ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>
          </div>

          <DetailSection title="Audit trail">
            {detail.auditTrail.length === 0 ? (
              <p className="text-sm text-ink-muted">No recorded actions for this account.</p>
            ) : (
              <ul className="space-y-2">
                {detail.auditTrail.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 text-sm text-ink-muted">
                    <span className="font-medium text-ink">{entry.action}</span>
                    <span className="text-xs text-ink-subtle">{new Date(entry.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        </div>
      ) : null}

      <Modal
        open={Boolean(suspendTarget)}
        onClose={closeSuspend}
        title="Suspend this account"
        description="The account is signed out everywhere and cannot sign in again until reactivated."
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={closeSuspend} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmSuspend}
              disabled={busy || suspendReason.trim().length < 3}
            >
              {busy ? 'Suspending...' : 'Suspend account'}
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="suspend-reason">
          <Textarea
            id="suspend-reason"
            rows={3}
            value={suspendReason}
            onChange={(event) => setSuspendReason(event.target.value)}
            placeholder="Why is this account being suspended?"
          />
        </Field>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={closeDelete}
        title="Delete this account"
        description="The account, its sessions, sign-in methods and memberships are removed permanently. Its businesses are kept."
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={closeDelete} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDelete()}
              disabled={busy || deleteReason.trim().length < 3}
            >
              {busy ? 'Deleting...' : 'Delete account'}
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="delete-reason">
          <Textarea
            id="delete-reason"
            rows={3}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Why is this account being deleted?"
          />
        </Field>
      </Modal>
    </div>
  );
}

function FeatureSwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/60 px-3.5 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        <p className="truncate text-xs text-ink-muted">{description}</p>
        <p className={checked ? 'mt-0.5 text-xs font-medium text-success-600 dark:text-success-300' : 'mt-0.5 text-xs font-medium text-danger-600 dark:text-danger-300'}>
          {checked ? 'Enabled' : 'Disabled'}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className={
          checked
            ? 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-brand-500 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60'
            : 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60'
        }
      >
        <span
          aria-hidden
          className={
            checked
              ? 'inline-block h-5 w-5 translate-x-[22px] rounded-full bg-white shadow transition-transform duration-200'
              : 'inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200'
          }
        />
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success" size="sm">
      Active
    </Badge>
  ) : (
    <Badge tone="danger" size="sm">
      Suspended
    </Badge>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="p-5 sm:p-6">
        <h3 className="mb-3 text-base font-medium text-ink">{title}</h3>
        {children}
      </div>
    </Card>
  );
}
