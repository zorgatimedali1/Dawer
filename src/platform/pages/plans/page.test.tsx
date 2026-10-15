import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPlansManager from '@/platform/pages/plans/page';

const starter = {
  id: 'plan_starter',
  name: 'Starter',
  slug: 'starter',
  priceCents: 14900,
  interval: '3_months',
  active: true,
  features: {
    limits: {
      campaigns: -1,
      customers: 100,
      whatsappMonthly: 0,
      whatsappBatch: 0,
      emailMonthly: 0,
      emailBatch: 0,
      wheelDesign: 0,
      wheelCenterLogo: 0,
      wheelStepsColor: 0,
    },
    features: ['Support by email'],
  },
};

const pro = {
  id: 'plan_growth',
  name: 'Pro',
  slug: 'growth',
  priceCents: 34900,
  interval: 'year',
  active: true,
  features: {
    limits: {
      campaigns: -1,
      customers: 1000,
      whatsappMonthly: 200,
      whatsappBatch: 100,
      emailMonthly: 1000,
      emailBatch: 200,
      wheelDesign: 0,
      wheelCenterLogo: 1,
      wheelStepsColor: 1,
    },
    features: ['Priority support'],
  },
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url === '/api/admin/plans') {
      return jsonResponse({ success: true, plans: [starter, pro] });
    }
    if (method === 'POST' && url === '/api/admin/plans') {
      const payload = JSON.parse(String(init?.body)) as typeof pro;
      return jsonResponse({ success: true, plan: { ...payload, id: 'plan_new' } }, 201);
    }
    if (method === 'PUT' && url.includes('/plan_growth')) {
      const payload = JSON.parse(String(init?.body)) as Partial<typeof pro>;
      return jsonResponse({ success: true, plan: { ...pro, ...payload } });
    }
    if (method === 'DELETE' && url.includes('/plan_growth')) {
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: 'Route not found.' }, 404);
  });
}

describe('AdminPlansManager', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists the plans with price and interval', async () => {
    vi.stubGlobal('fetch', createFetch());
    render(<AdminPlansManager />);

    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('349.00 DT')).toBeInTheDocument();
    expect(screen.getByText('1 year')).toBeInTheDocument();
    expect(screen.getByText('2 plans')).toBeInTheDocument();
  });

  it('edits a plan and stores the tuned criteria', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPlansManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Pro' }));
    await screen.findByText('Edit Pro');

    const nameInput = screen.getByLabelText('Plan name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Pro Max');
    const customers = screen.getByLabelText('Customer limit');
    await userEvent.clear(customers);
    await userEvent.type(customers, '2500');

    const designBox = screen.getByLabelText(/Wheel design edits/i);
    const logoBox = screen.getByLabelText(/Logo at the wheel center/i);
    const stepsBox = screen.getByLabelText(/Gate step colour/i);
    expect(designBox).not.toBeChecked();
    expect(logoBox).toBeChecked();
    expect(stepsBox).toBeChecked();
    await userEvent.click(designBox);
    await userEvent.click(stepsBox);

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Plan "Pro Max" saved.');
    expect(screen.getByText('Pro Max')).toBeInTheDocument();

    const updateCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/plan_growth') && call[1]?.method === 'PUT',
    );
    expect(updateCall).toBeTruthy();
    const body = JSON.parse(String(updateCall?.[1]?.body)) as {
      name: string;
      priceCents: number;
      features: {
        limits: {
          customers: number;
          whatsappMonthly: number;
          wheelDesign: number;
          wheelCenterLogo: number;
          wheelStepsColor: number;
        };
      };
    };
    expect(body.name).toBe('Pro Max');
    expect(body.priceCents).toBe(34900);
    expect(body.features.limits.customers).toBe(2500);
    expect(body.features.limits.whatsappMonthly).toBe(200);
    expect(body.features.limits.wheelDesign).toBe(1);
    expect(body.features.limits.wheelCenterLogo).toBe(1);
    expect(body.features.limits.wheelStepsColor).toBe(0);
  });

  it('creates a plan from the modal', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPlansManager />);

    await screen.findByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    await screen.findByText('Create a plan');

    await userEvent.type(screen.getByLabelText('Plan name'), 'Enterprise');
    await userEvent.type(screen.getByLabelText('Slug'), 'enterprise');
    await userEvent.type(screen.getByLabelText('Price (DT)'), '49.9');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Plan "Enterprise" created.');
    expect(screen.getByText('Enterprise')).toBeInTheDocument();

    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/admin/plans' && call[1]?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall?.[1]?.body)) as {
      name: string;
      slug: string;
      priceCents: number;
      features: { limits: { customers: number } };
    };
    expect(body.name).toBe('Enterprise');
    expect(body.slug).toBe('enterprise');
    expect(body.priceCents).toBe(4990);
    expect(body.features.limits.customers).toBe(100);
  });

  it('removes a plan after confirmation', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPlansManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Pro' }));
    await screen.findByText('Delete this plan');
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }));

    await waitFor(() => expect(screen.queryByText('Pro')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(
        (call) => String(call[0]).includes('/plan_growth') && call[1]?.method === 'DELETE',
      ),
    ).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('Plan "Pro" deleted.');
  });

  it('surfaces a validation error without calling the API', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPlansManager />);

    await screen.findByText('Pro');
    await userEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    await screen.findByText('Create a plan');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Plan name is required.');
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  });
});
