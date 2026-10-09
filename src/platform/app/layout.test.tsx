import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformLayout from '@/platform/app/layout';

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));

vi.mock('@/platform/auth/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/auth/operator-context')>();
  return {
    ...actual,
    useOperatorContext: () => ({
      operator: { id: 'op1', email: 'ops@example.test', firstName: 'Olivia', lastName: 'Ops' },
      status: 'authenticated' as const,
      login: vi.fn(),
      logout: logoutMock,
    }),
  };
});

function renderLayout(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<PlatformLayout />}>
          <Route path="dashboard" element={<div>dashboard page</div>} />
          <Route path="analytics" element={<div>analytics page</div>} />
          <Route path="accounts" element={<div>accounts page</div>} />
          <Route path="subscriptions" element={<div>subscriptions page</div>} />
          <Route path="plans" element={<div>plans page</div>} />
          <Route path="partners" element={<div>partners page</div>} />
          <Route path="password" element={<div>password page</div>} />
          <Route path="login" element={<div>login page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('platform layout sidebar', () => {
  beforeEach(() => {
    logoutMock.mockReset();
    logoutMock.mockResolvedValue(undefined);
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders every operator destination in the left sidebar with the active one marked', async () => {
    renderLayout('/dashboard');

    // Role queries skip the hidden mobile drawer copy, so links are unique.
    for (const label of ['Dashboard', 'Analytics', 'Accounts', 'Subscriptions', 'Plans', 'Partners', 'Password']) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Accounts' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('dashboard page')).toBeInTheDocument();

    // Nav lives in the sidebar with grouped section labels.
    const nav = screen.getByRole('navigation', { name: 'Platform' });
    expect(within(nav).getByText('Management')).toBeInTheDocument();
    expect(within(nav).getByText('Overview')).toBeInTheDocument();
    expect(within(nav).getByText('Account')).toBeInTheDocument();
  });

  it('switches the active destination and page when a sidebar link is clicked', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.click(await screen.findByRole('link', { name: 'Analytics' }));

    expect(await screen.findByText('analytics page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('signs out through the sidebar account card and lands on the login page', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    await user.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('opens and closes the mobile drawer from the header hamburger', async () => {
    const user = userEvent.setup();
    renderLayout('/dashboard');

    const drawer = screen.getByTestId('platform-drawer');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');

    await user.click(screen.getByRole('button', { name: /open menu/i }));
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
    expect(within(drawer).getByRole('link', { name: 'Plans' })).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /close menu/i }));
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
  });
});
