import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import CustomerRedirect from '@/app/customer/customer-redirect';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

describe('customer redirect', () => {
  it('forwards the legacy /customer link to the canonical /wheels route', () => {
    render(
      <MemoryRouter initialEntries={['/customer/ABC123DEF456']}>
        <Routes>
          <Route path="/customer/:campaignId" element={<CustomerRedirect />} />
          <Route path="/wheels/:campaignId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('path').textContent).toBe('/wheels/ABC123DEF456');
  });
});
