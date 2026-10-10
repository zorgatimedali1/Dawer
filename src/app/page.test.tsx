import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '@/app/page';
import { AppProvider } from '@/contexts/app-context';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** The partner marquee fetches its feed on mount; keep tests offline. */
function stubPartnersFeed() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, partners: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function renderHome() {
  stubPartnersFeed();
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

const cachedUser = {
  id: 'user-1',
  email: 'merchant@example.test',
  firstName: 'Med',
  lastName: 'Ali',
  role: 'merchant' as const,
};

/** Seeds the cached profile the AppProvider bootstraps from, plus a session revalidation stub. */
function renderHomeAuthenticated() {
  window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: cachedUser }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/auth/session')
        ? { success: true, user: cachedUser }
        : { success: true, partners: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return render(
    <MemoryRouter>
      <AppProvider>
        <Home />
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('home pricing section', () => {
  it('shows all four plans with the Pro analytics overview', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enterprise' })).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 100 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 1 000 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 10 000 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('349 DT')).toBeInTheDocument();
    expect(screen.getAllByText('Vue d’ensemble et analytics de base')).toHaveLength(1);
    expect(screen.getByText('Offre réservée aux 50 premiers commerçants')).toBeInTheDocument();
  });
});

describe('home demo section', () => {
  it('links “Voir la démo” to the in-page demo anchor', () => {
    renderHome();

    const demoLink = screen.getByRole('link', { name: 'Voir la démo' });
    expect(demoLink).toHaveAttribute('href', '#demo');
  });

  it('renders the YouTube demo video in a responsive aspect-video container', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Voyez la plateforme en action' })).toBeInTheDocument();

    const frame = screen.getByTitle('Vidéo de démonstration de la plateforme');
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/UDaMIqEyDh4');
    expect(frame.closest('.aspect-video')).not.toBeNull();
    expect(frame.closest('.rounded-2xl')).not.toBeNull();
  });

  it('places the demo section before the pricing section', () => {
    renderHome();

    const demo = document.getElementById('demo');
    const pricing = document.getElementById('pricing');
    if (!demo || !pricing) throw new Error('Both #demo and #pricing sections must exist.');

    // pricing must FOLLOW demo in document order (video first, plans below).
    expect(demo.compareDocumentPosition(pricing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });

  it('scrolls to the demo section when arriving with a #demo hash (post sign-out)', () => {
    window.location.hash = '#demo';
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      renderHome();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
      window.location.hash = '';
    }
  });
});

describe('home signed-in experience', () => {
  it('replaces “Se connecter” with a dashboard link when a session exists', () => {
    renderHomeAuthenticated();

    expect(screen.queryByRole('link', { name: 'Se connecter' })).not.toBeInTheDocument();
    const dashboardLink = screen.getByRole('link', { name: 'Ouvrir le tableau de bord' });
    expect(dashboardLink).toHaveAttribute('href', '/dashboard/overview');
  });

  it('sends the pricing CTAs to the dashboard instead of the register page', () => {
    renderHomeAuthenticated();

    const ctaLinks = screen.getAllByRole('link', { name: /Demander un essai gratuit/ });
    expect(ctaLinks.length).toBeGreaterThan(0);
    for (const link of ctaLinks) {
      expect(link).toHaveAttribute('href', '/dashboard/overview');
    }
  });

  it('keeps the sign-in link and register CTAs for anonymous visitors', () => {
    renderHome();

    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/auth/login');
    const ctaLinks = screen.getAllByRole('link', { name: /Demander un essai gratuit/ });
    for (const link of ctaLinks) {
      expect(link).toHaveAttribute('href', '/auth/register');
    }
  });
});

describe('home mobile navigation', () => {
  it('reveals the section links behind the hamburger', () => {
    renderHome();

    const toggle = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const panel = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(panel).toHaveAttribute('id', 'landing-mobile-nav');
    expect(within(panel).getByRole('link', { name: 'Confidentialité' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Tarifs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toBeInTheDocument();
  });

  it('closes the mobile nav on Escape', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument();
  });
});