import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartnerMarquee } from '@/components/marketing/partner-marquee';
import type { Partner } from '@/services/partners.service';

const partners: Partner[] = [
  { id: 'p1', name: 'Acme Corp', logoUrl: '/api/public/partners/p1/logo' },
  { id: 'p2', name: 'Beta Ltd', logoUrl: '/api/public/partners/p2/logo' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartnerMarquee', () => {
  it('renders the header with side divider lines', () => {
    render(<PartnerMarquee partners={partners} />);

    const heading = screen.getByRole('heading', { name: 'ILS NOUS FONT CONFIANCE' });
    expect(heading).toBeInTheDocument();
    // Two divider lines flank the title.
    expect(heading.parentElement?.querySelectorAll('span')).toHaveLength(2);
  });

  it('duplicates the logo list into two equal halves for the infinite loop', () => {
    render(<PartnerMarquee partners={partners} />);

    const acmeLogos = screen.getAllByAltText('Acme Corp');
    const betaLogos = screen.getAllByAltText('Beta Ltd');

    expect(acmeLogos.length).toBeGreaterThanOrEqual(2);
    expect(acmeLogos.length).toBe(betaLogos.length);
    // Even count = the track is exactly two identical halves.
    expect(acmeLogos.length % 2).toBe(0);
    expect(acmeLogos[0]).toHaveAttribute('src', '/api/public/partners/p1/logo');
  });

  it('renders nothing when there are no partners', () => {
    const { container } = render(<PartnerMarquee partners={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('fetches the public feed when no partners are passed in', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, partners }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<PartnerMarquee />);

    await waitFor(() => expect(screen.getAllByAltText('Acme Corp').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith('/api/public/partners', expect.anything());
  });

  it('stays hidden when the feed request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    const { container } = render(<PartnerMarquee />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
