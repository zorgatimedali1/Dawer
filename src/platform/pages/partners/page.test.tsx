import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPartnersManager from '@/platform/pages/partners/page';

const existing = {
  id: 'p1',
  name: 'Acme Corp',
  logoUrl: '/api/public/partners/p1/logo',
  createdAt: '2026-01-05T00:00:00.000Z',
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

    if (method === 'DELETE' && url.includes('/p1')) {
      return jsonResponse({ success: true });
    }
    if (method === 'POST' && url === '/api/admin/partners') {
      const payload = JSON.parse(String(init?.body)) as { name: string; mimeType: string };
      expect(payload.mimeType).toBe('image/png');
      return jsonResponse(
        {
          success: true,
          partner: {
            id: 'p2',
            name: payload.name,
            logoUrl: '/api/public/partners/p2/logo',
            createdAt: '2026-01-06T00:00:00.000Z',
          },
        },
        201,
      );
    }
    if (method === 'GET' && url === '/api/admin/partners') {
      return jsonResponse({ success: true, partners: [existing] });
    }

    return jsonResponse({ success: false, error: 'Route not found.' }, 404);
  });
}

describe('AdminPartnersManager', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // jsdom has no object URL API; the page uses it for the upload preview.
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined }));
  });

  it('lists the current partners in a grid', async () => {
    vi.stubGlobal('fetch', createFetch());
    render(<AdminPartnersManager />);

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('1 logo')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Acme Corp' })).toHaveAttribute(
      'src',
      '/api/public/partners/p1/logo',
    );
  });

  it('adds a partner from an uploaded file, deriving the name from the filename', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPartnersManager />);

    await screen.findByText('Acme Corp');
    // No name input exists anymore: the name comes from the file ("beta.png").
    expect(screen.queryByLabelText('Partner name')).not.toBeInTheDocument();
    await userEvent.upload(
      screen.getByLabelText('Logo file'),
      new File([new Uint8Array([1, 2, 3])], 'beta.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add partner' }));

    // The notice lands only after the POST resolves and the form resets, so
    // by then the grid (not the preview) holds the derived name.
    expect(await screen.findByRole('status')).toHaveTextContent('added to the landing page');
    expect(screen.getByText('Beta')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/admin/partners' && call[1]?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(
      (JSON.parse(String(createCall?.[1]?.body)) as { name: string }).name,
    ).toBe('Beta');
  });

  it('removes a partner from the grid after confirmation', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPartnersManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove Acme Corp' }));
    await screen.findByText('Remove this partner');
    await userEvent.click(screen.getByRole('button', { name: 'Remove partner' }));

    await waitFor(() => expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(
        (call) => String(call[0]).includes('/p1') && call[1]?.method === 'DELETE',
      ),
    ).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('removed from the landing page');
  });
});
