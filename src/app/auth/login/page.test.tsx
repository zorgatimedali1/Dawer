import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import LoginPage from '@/app/auth/login/page';
import { AppProvider } from '@/contexts/app-context';

function renderPage(entry: string) {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/auth/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('login page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the OAuth error carried in the query string', () => {
    renderPage('/auth/login?error=Invalid%20or%20expired%20OAuth%20state.');

    expect(screen.getByText('Invalid or expired OAuth state.')).toBeTruthy();
  });

  it('renders without an error when the query string is clean', () => {
    renderPage('/auth/login');

    expect(screen.queryByText(/OAuth state/i)).toBeNull();
  });
});
