import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { PlansService, type PlanPayload, type PlatformPlan } from '@/platform/services/plans.service';

const INTERVAL_LABELS: Record<string, string> = {
  '3_months': '3 months',
  year: '1 year',
  '2_years': '2 years',
  '3_years': '3 years',
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,29}$/;

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2)} DT`;
}

function toCount(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The edit/create form, every number kept as a string while typing. */
type PlanForm = {
  name: string;
  slug: string;
  price: string;
  interval: string;
  active: boolean;
  campaigns: string;
  customers: string;
  whatsappMonthly: string;
  whatsappBatch: string;
  emailMonthly: string;
  emailBatch: string;
  wheelDesign: boolean;
  wheelCenterLogo: boolean;
  wheelStepsColor: boolean;
  criteria: string;
};

function emptyForm(): PlanForm {
  return {
    name: '',
    slug: '',
    price: '',
    interval: 'year',
    active: true,
    campaigns: '-1',
    customers: '100',
    whatsappMonthly: '0',
    whatsappBatch: '0',
    emailMonthly: '0',
    emailBatch: '0',
    wheelDesign: false,
    wheelCenterLogo: false,
    wheelStepsColor: false,
    criteria: '',
  };
}

function formFromPlan(plan: PlatformPlan): PlanForm {
  const limits = plan.features.limits;
  return {
    name: plan.name,
    slug: plan.slug,
    price: (plan.priceCents / 100).toString(),
    interval: plan.interval,
    active: plan.active,
    campaigns: String(limits.campaigns),
    customers: String(limits.customers),
    whatsappMonthly: String(limits.whatsappMonthly),
    whatsappBatch: String(limits.whatsappBatch),
    emailMonthly: String(limits.emailMonthly),
    emailBatch: String(limits.emailBatch),
    wheelDesign: limits.wheelDesign === 1,
    wheelCenterLogo: limits.wheelCenterLogo === 1,
    wheelStepsColor: limits.wheelStepsColor === 1,
    criteria: plan.features.features.join('\n'),
  };
}

function buildPayload(form: PlanForm): PlanPayload {
  const price = Number(form.price.replace(',', '.'));
  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    priceCents: Math.round(price * 100),
    interval: form.interval,
    active: form.active,
    features: {
      limits: {
        campaigns: toCount(form.campaigns, -1),
        customers: toCount(form.customers, 100),
        whatsappMonthly: toCount(form.whatsappMonthly, 0),
        whatsappBatch: toCount(form.whatsappBatch, 0),
        emailMonthly: toCount(form.emailMonthly, 0),
        emailBatch: toCount(form.emailBatch, 0),
        wheelDesign: form.wheelDesign ? 1 : 0,
        wheelCenterLogo: form.wheelCenterLogo ? 1 : 0,
        wheelStepsColor: form.wheelStepsColor ? 1 : 0,
      },
      features: form.criteria
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    },
  };
}

type Editor = { mode: 'create' } | { mode: 'edit'; plan: PlatformPlan };

/**
 * Operator controls for pricing plans: create plans, edit every criterion
 * (price, interval, quota limits, feature bullets) and delete plans that no
 * subscription references. Mutations apply the server response immediately.
 */
export default function AdminPlansManager() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<PlatformPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    void PlansService.list()
      .then((rows) => {
        if (!cancelled) setPlans(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load plans.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openCreate = () => {
    setError(null);
    setForm(emptyForm());
    setEditor({ mode: 'create' });
  };

  const openEdit = (plan: PlatformPlan) => {
    setError(null);
    setForm(formFromPlan(plan));
    setEditor({ mode: 'edit', plan });
  };

  // Memoized: the Modal re-focuses its panel whenever onClose changes identity,
  // which would steal focus from the inputs on every keystroke.
  const closeEditor = useCallback(() => {
    if (busy) return;
    setEditor(null);
    setError(null);
  }, [busy]);

  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  const validate = (payload: PlanPayload, priceInput: string): string | null => {
    if (!payload.name) return 'Plan name is required.';
    if (!SLUG_PATTERN.test(payload.slug)) {
      return 'Slug must be 2-30 lowercase letters, digits or dashes.';
    }
    // An empty price field parses to 0 and silently creates a free plan.
    if (!priceInput.trim()) return 'Enter a price (0 makes the plan free).';
    if (payload.priceCents < 0 || !Number.isFinite(payload.priceCents)) return 'Enter a valid price.';
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || busy) return;

    const payload = buildPayload(form);
    const problem = validate(payload, form.price);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (editor.mode === 'create') {
        const plan = await PlansService.create(payload);
        setPlans((current) => [...current, plan]);
        setNotice(`Plan "${plan.name}" created.`);
      } else {
        const plan = await PlansService.update(editor.plan.id, payload);
        setPlans((current) => current.map((row) => (row.id === plan.id ? plan : row)));
        setNotice(`Plan "${plan.name}" saved.`);
      }
      setEditor(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the plan.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    const target = deleteTarget;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await PlansService.remove(target.id);
      setPlans((current) => current.filter((plan) => plan.id !== target.id));
      setNotice(`Plan "${target.name}" deleted.`);
      setDeleteTarget(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete the plan.');
    } finally {
      setBusy(false);
    }
  };

  const numberField = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    hint?: string,
  ) => (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Pricing plans"
        description="Create plans and tune every criterion merchants see: price, billing interval, quotas and feature bullets. Changes apply to new subscriptions immediately."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            Add plan
          </Button>
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

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Current plans</h2>
          <span className="text-xs text-ink-muted">
            {plans.length} plan{plans.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-600" />
            <p className="text-ink-muted">Loading plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No plans yet"
            description="Create the first pricing plan — merchants will see it on the Billing page."
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-5 sm:p-6">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-elevated px-4 py-3.5"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink">
                    {plan.name}
                    <span className="font-mono text-[11.5px] font-medium text-ink-subtle">{plan.slug}</span>
                    {!plan.active && (
                      <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-700 dark:bg-danger-900/40 dark:text-danger-300">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {plan.features.limits.customers < 0
                      ? 'Unlimited customers'
                      : `${plan.features.limits.customers} customers`}
                    {' · '}
                    {plan.features.limits.campaigns < 0
                      ? 'Unlimited campaigns'
                      : `${plan.features.limits.campaigns} campaigns`}
                    {' · '}
                    {plan.features.limits.whatsappMonthly} WhatsApp/mo · {plan.features.limits.emailMonthly} emails/mo
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-[15px] font-semibold text-ink">{formatPrice(plan.priceCents)}</p>
                  <p className="text-xs text-ink-muted">{INTERVAL_LABELS[plan.interval] ?? plan.interval}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Edit ${plan.name}`}
                    onClick={() => openEdit(plan)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Delete ${plan.name}`}
                    title={`Delete ${plan.name}`}
                    onClick={() => setDeleteTarget(plan)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.mode === 'edit' ? `Edit ${editor.plan.name}` : 'Create a plan'}
        description="Every criterion is stored on the plan row; broadcast quotas with no stored value fall back to the legacy defaults."
        size="lg"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={closeEditor} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={(event) => void submit(event)} disabled={busy}>
              {busy ? 'Saving...' : editor?.mode === 'edit' ? 'Save changes' : 'Create plan'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name" htmlFor="plan-name">
              <Input
                id="plan-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Enterprise"
              />
            </Field>
            <Field label="Slug" htmlFor="plan-slug">
              <Input
                id="plan-slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                placeholder="enterprise"
              />
            </Field>
            <Field label="Price (DT)" htmlFor="plan-price">
              <Input
                id="plan-price"
                type="number"
                min={0}
                step="0.1"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                placeholder="49.9"
              />
            </Field>
            <Field label="Billing interval" htmlFor="plan-interval">
              <select
                id="plan-interval"
                value={form.interval}
                onChange={(event) => setForm((current) => ({ ...current, interval: event.target.value }))}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              >
                {Object.entries(INTERVAL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {numberField('plan-customers', 'Customer limit', form.customers, (next) =>
              setForm((current) => ({ ...current, customers: next })), '-1 = unlimited')}
            {numberField('plan-campaigns', 'Campaign limit', form.campaigns, (next) =>
              setForm((current) => ({ ...current, campaigns: next })), '-1 = unlimited')}
            {numberField('plan-whatsapp-monthly', 'WhatsApp / month', form.whatsappMonthly, (next) =>
              setForm((current) => ({ ...current, whatsappMonthly: next })))}
            {numberField('plan-whatsapp-batch', 'WhatsApp per batch', form.whatsappBatch, (next) =>
              setForm((current) => ({ ...current, whatsappBatch: next })))}
            {numberField('plan-email-monthly', 'Emails / month', form.emailMonthly, (next) =>
              setForm((current) => ({ ...current, emailMonthly: next })))}
            {numberField('plan-email-batch', 'Emails per batch', form.emailBatch, (next) =>
              setForm((current) => ({ ...current, emailBatch: next })))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm text-ink-muted" htmlFor="plan-wheel-design">
              <input
                id="plan-wheel-design"
                type="checkbox"
                checked={form.wheelDesign}
                onChange={(event) =>
                  setForm((current) => ({ ...current, wheelDesign: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              />
              <span>
                Wheel design edits — colors and motion
                <span className="mt-0.5 block text-xs text-ink-subtle">Business tier by default (scale, premium).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-muted" htmlFor="plan-wheel-center-logo">
              <input
                id="plan-wheel-center-logo"
                type="checkbox"
                checked={form.wheelCenterLogo}
                onChange={(event) =>
                  setForm((current) => ({ ...current, wheelCenterLogo: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              />
              <span>
                Logo at the wheel center
                <span className="mt-0.5 block text-xs text-ink-subtle">Pro tier by default (growth, scale, premium).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-muted" htmlFor="plan-wheel-steps-color">
              <input
                id="plan-wheel-steps-color"
                type="checkbox"
                checked={form.wheelStepsColor}
                onChange={(event) =>
                  setForm((current) => ({ ...current, wheelStepsColor: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              />
              <span>
                Gate step colour — badges and CTA buttons
                <span className="mt-0.5 block text-xs text-ink-subtle">Pro tier by default (growth, scale, premium).</span>
              </span>
            </label>
          </div>

          <Field label="Plan features (one per line)" htmlFor="plan-criteria">
            <textarea
              id="plan-criteria"
              rows={5}
              value={form.criteria}
              onChange={(event) => setForm((current) => ({ ...current, criteria: event.target.value }))}
              placeholder={'Priority support\nCustom branding'}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-muted" htmlFor="plan-active">
            <input
              id="plan-active"
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
            />
            Active — visible to merchants on the Billing page
          </label>

          {/* Enter submits the modal from any field. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={closeDelete}
        title="Delete this plan"
        description={deleteTarget ? `${deleteTarget.name} (${formatPrice(deleteTarget.priceCents)}) will be removed.` : undefined}
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? 'Deleting...' : 'Delete plan'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Plans referenced by an active subscription cannot be deleted — deactivate them instead. The
          merchant billing page updates within seconds.
        </p>
      </Modal>
    </div>
  );
}
