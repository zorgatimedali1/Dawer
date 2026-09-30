"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BillingService, type BillingState, type Plan } from '@/services/billing.service';

function formatPrice(plan: Plan): string {
  const amount = (plan.priceCents / 100).toFixed(plan.priceCents % 100 === 0 ? 0 : 2);
  return `$${amount}/${plan.interval === 'year' ? 'yr' : 'mo'}`;
}

function limitLabel(value: number): string {
  return value < 0 ? 'Unlimited' : String(value);
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setBilling(await BillingService.get());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load billing.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changePlan = async (slug: string) => {
    setPending(true);
    setStatus('');
    setError('');
    try {
      const updated = await BillingService.changePlan(slug);
      setBilling(updated);
      setStatus(`Now on the ${updated.subscription?.plan.name ?? slug} plan.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change the plan.');
    } finally {
      setPending(false);
    }
  };

  if (error && !billing) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading billing…</p>
      </div>
    );
  }

  const currentSlug = billing.subscription?.plan.slug ?? null;

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
          <p className="text-sm text-gray-600">Manage your subscription, payments, and usage</p>
        </div>
        <div className="text-right text-sm">
          {status && <p className="text-green-600">{status}</p>}
          {error && <p className="text-red-600">{error}</p>}
          {pending && <p className="text-gray-500">Updating…</p>}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-medium text-gray-900">Current subscription</h3>
        {billing.subscription ? (
          <p className="mt-2 text-sm text-gray-600">
            {billing.subscription.plan.name} plan • {billing.subscription.status} •{' '}
            ${(billing.subscription.plan.priceCents / 100).toFixed(2)}/
            {billing.subscription.plan.interval === 'year' ? 'yr' : 'mo'}
            {billing.subscription.currentPeriodEnd && (
              <> • renews {new Date(billing.subscription.currentPeriodEnd).toLocaleDateString()}</>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No active subscription. Pick a plan below.</p>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-medium text-gray-900">Usage</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {billing.plans
            .filter((plan) => plan.slug === currentSlug)
            .map((plan) => (
              <div key={plan.slug} className="text-sm text-gray-600">
                <p>
                  Campaigns: {billing.usage.campaigns}/{limitLabel(plan.features.limits.campaigns)}
                </p>
                <p>
                  Customers: {billing.usage.customers}/{limitLabel(plan.features.limits.customers)}
                </p>
              </div>
            ))}
          {currentSlug === null && (
            <p className="text-sm text-gray-600">
              Campaigns: {billing.usage.campaigns} • Customers: {billing.usage.customers}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {billing.plans.map((plan) => {
          const isCurrent = plan.slug === currentSlug;
          return (
            <div
              key={plan.slug}
              className={`rounded-lg border bg-white p-6 ${
                isCurrent ? 'border-indigo-600 ring-1 ring-indigo-600' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">{plan.name}</h3>
                {isCurrent && <span className="text-xs font-semibold text-indigo-600">Current</span>}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{formatPrice(plan)}</p>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                {plan.features.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              <Button
                className="mt-4 w-full"
                variant={isCurrent ? 'outline' : 'default'}
                disabled={pending || isCurrent}
                onClick={() => void changePlan(plan.slug)}
              >
                {isCurrent ? 'Current plan' : 'Switch plan'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
