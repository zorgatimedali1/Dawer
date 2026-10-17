import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
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
  APPROVE_DURATION_DAYS,
  DURATION_LABELS,
  SubscriptionsService,
  type ApproveDurationDays,
  type SubscriptionRequest,
  type SubscriptionRequestStatus,
} from '@/platform/services/subscriptions.service';

// Product currency is TND (DT) everywhere else in the console; the legal
// intervals are 3_months/year/2_years/3_years — never "month".
const INTERVAL_LABELS: Record<string, string> = {
  '3_months': '3 months',
  year: '1 year',
  '2_years': '2 years',
  '3_years': '3 years',
};

function formatRequestPrice(cents: number, interval: string): string {
  return `${(cents / 100).toFixed(2)} DT/${INTERVAL_LABELS[interval] ?? interval}`;
}

export default function SubscriptionsPage() {
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SubscriptionRequestStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approveTarget, setApproveTarget] = useState<SubscriptionRequest | null>(null);
  const [duration, setDuration] = useState<ApproveDurationDays>(30);
  const [periodEndLabel, setPeriodEndLabel] = useState('');
  const [rejectTarget, setRejectTarget] = useState<SubscriptionRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const closeApprove = useCallback(() => {
    setApproveTarget(null);
    setDuration(30);
    setPeriodEndLabel('');
  }, []);

  const closeReject = useCallback(() => {
    setRejectTarget(null);
    setRejectReason('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await SubscriptionsService.listRequests({
        search: search || undefined,
        status: status || undefined,
        page,
        limit: 20,
      });
      setRequests(result.requests);
      setPagination(result.pagination);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load subscription requests.');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The action failed.');
    } finally {
      setBusy(false);
      closeApprove();
      closeReject();
    }
  };

  const confirmApprove = () => {
    if (!approveTarget) return;
    const target = approveTarget;
    void run(() => SubscriptionsService.approve(target.id, duration), 'Subscription activated.');
  };

  const confirmReject = () => {
    if (!rejectTarget || rejectReason.trim().length < 3) return;
    const target = rejectTarget;
    void run(() => SubscriptionsService.reject(target.id, rejectReason.trim()), 'Request rejected.');
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Subscription requests"
        description="Merchants pay by WhatsApp; activate a plan and pick how long it runs"
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

      <div className="flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <Field label={<span className="sr-only">Search requests</span>} htmlFor="subscription-search">
            <Input
              id="subscription-search"
              type="search"
              inputSize="sm"
              placeholder="Search by email or business..."
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </Field>
        </div>
        <div>
          <Field label={<span className="sr-only">Filter by status</span>} htmlFor="subscription-status">
            <Select
              id="subscription-status"
              inputSize="sm"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as SubscriptionRequestStatus | '');
              }}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </Field>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-600" />
            <p className="text-ink-muted">Loading requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-ink-muted">No subscription requests yet.</p>
          </div>
        ) : (
          <>
            <TableWrap>
              <Table density="compact">
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Merchant</TableHeadCell>
                    <TableHeadCell>Plan</TableHeadCell>
                    <TableHeadCell>Requested</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell className="text-right">Actions</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <p className="truncate text-sm font-medium text-ink">{request.email}</p>
                        <p className="truncate text-xs text-ink-muted">{request.businessName ?? '—'}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-ink">{request.plan.name}</p>
                        <p className="text-xs text-ink-muted">
                          {formatRequestPrice(request.priceCents, request.interval)}
                        </p>
                      </TableCell>
                      <TableCell>{new Date(request.requestedAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <StatusBadge status={request.status} />
                        {request.status === 'APPROVED' && request.durationDays && (
                          <p className="mt-1 text-xs text-ink-muted">
                            {DURATION_LABELS[request.durationDays as ApproveDurationDays] ?? `${request.durationDays} j`}
                          </p>
                        )}
                        {request.status === 'REJECTED' && request.rejectReason && (
                          <p className="mt-1 truncate text-xs text-ink-subtle" title={request.rejectReason}>
                            {request.rejectReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {request.status === 'PENDING' ? (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  setDuration(30);
                                  setPeriodEndLabel(new Date(Date.now() + 30 * 86_400_000).toLocaleDateString());
                                  setApproveTarget(request);
                                }}
                              >
                                Activate
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={busy}
                                onClick={() => setRejectTarget(request)}
                              >
                                Reject
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-ink-subtle">
                              {request.resolvedAt ? new Date(request.resolvedAt).toLocaleDateString() : '—'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>

            <div className="flex items-center justify-between border-t border-line px-5 py-3 sm:px-6">
              <p className="text-sm text-ink-muted">
                {pagination.total} request{pagination.total === 1 ? '' : 's'}
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

      <Modal
        open={Boolean(approveTarget)}
        onClose={closeApprove}
        title={approveTarget ? `Activate ${approveTarget.plan.name}` : 'Activate subscription'}
        description={approveTarget ? `${approveTarget.email} · ${approveTarget.businessName ?? '—'}` : undefined}
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={closeApprove} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirmApprove} disabled={busy}>
              {busy ? 'Activating...' : 'Activate subscription'}
            </Button>
          </>
        }
      >
        <p className="text-sm font-medium text-ink">Duration</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {APPROVE_DURATION_DAYS.map((days) => (
            <Button
              key={days}
              type="button"
              variant={duration === days ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setDuration(days);
                setPeriodEndLabel(new Date(Date.now() + days * 86_400_000).toLocaleDateString());
              }}
              className="h-9 px-0"
            >
              {DURATION_LABELS[days]}
            </Button>
          ))}
        </div>

        <p className="mt-4 text-xs text-ink-muted">
          The merchant's subscription starts now and ends {periodEndLabel}.
        </p>
      </Modal>

      <Modal
        open={Boolean(rejectTarget)}
        onClose={closeReject}
        title="Reject this request"
        description={rejectTarget ? `${rejectTarget.email} · ${rejectTarget.plan.name}` : undefined}
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={closeReject} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmReject}
              disabled={busy || rejectReason.trim().length < 3}
            >
              {busy ? 'Rejecting...' : 'Reject request'}
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="reject-reason">
          <Textarea
            id="reject-reason"
            rows={3}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Why is this request being rejected?"
          />
        </Field>
      </Modal>
    </div>
  );
}

function StatusBadge({ status }: { status: SubscriptionRequestStatus }) {
  const tone = status === 'PENDING' ? 'warning' : status === 'APPROVED' ? 'success' : 'danger';

  return (
    <Badge tone={tone} size="sm">
      {status === 'PENDING' ? 'Pending' : status === 'APPROVED' ? 'Approved' : 'Rejected'}
    </Badge>
  );
}
