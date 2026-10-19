import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '@/contexts/app-context';
import Home from '@/app/page';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The partner marquee and the pricing section each fetch their feed on mount;
 * keep tests offline and route by path.
 */
function stubMarketingFeeds(overrides: { plans?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/public/plans')) {
        return jsonResponse(overrides.plans ?? { success: true, plans: [] });
      }
      return jsonResponse({ success: true, partners: [] });
    }),
  );
}

function renderHome() {
  stubMarketingFeeds();
  return render(
    <AppProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('home pricing section', () => {
  it('shows all four plans with the Pro analytics overview', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enterprise' })).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 200 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 1 000 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('Jusqu’à 10 000 clients collectés')).toBeInTheDocument();
    expect(screen.getByText('349 DT')).toBeInTheDocument();
    expect(screen.getAllByText('Vue d’ensemble et analytics de base')).toHaveLength(1);
    expect(screen.getByText('Offre réservée aux 50 premiers commerçants')).toBeInTheDocument();
  });

  it('replaces name, price and bullets with the operator-maintained feed', async () => {
    stubMarketingFeeds({
      plans: {
        success: true,
        plans: [
          {
            name: 'Start',
            slug: 'starter',
            priceCents: 19900,
            interval: 'year',
            features: ['Nouvelle bullet opérateur'],
          },
        ],
      },
    });
    render(
      <AppProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </AppProvider>,
    );

    // The feed overrides the bundled catalog as soon as it answers.
    expect(await screen.findByRole('heading', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByText('199 DT')).toBeInTheDocument();
    expect(screen.getByText('/ 1 an')).toBeInTheDocument();
    expect(screen.getByText('Nouvelle bullet opérateur')).toBeInTheDocument();
    // Catalog bullets are gone once the live list takes over.
    expect(screen.queryByText('Jusqu’à 200 clients collectés')).toBeNull();
  });

  it('keeps the bundled catalog when the feed fails or returns nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/public/plans')) {
          return new Response('boom', { status: 500 });
        }
        return jsonResponse({ success: true, partners: [] });
      }),
    );
    render(
      <AppProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </AppProvider>,
    );

    // Still the four bundled plans, not an empty section.
    expect(await screen.findByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enterprise' })).toBeInTheDocument();
    expect(screen.getByText('349 DT')).toBeInTheDocument();
  });

  it('falls back to catalog bullets when a live plan ships an empty list', async () => {
    stubMarketingFeeds({
      plans: {
        success: true,
        plans: [
          { name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months', features: [] },
        ],
      },
    });
    render(
      <AppProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </AppProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    });
    // Empty live bullets must not blank the card: the catalog list fills in.
    expect(screen.getByText('Jusqu’à 200 clients collectés')).toBeInTheDocument();
  });
});

describe('home demo section', () => {
  it('links “Voir la démo” to the in-page demo anchor', () => {
    renderHome();

    // Both the hero secondary CTA and the footer link to the demo section.
    const demoLinks = screen.getAllByRole('link', { name: 'Voir la démo' });
    expect(demoLinks.length).toBeGreaterThanOrEqual(2);
    for (const demoLink of demoLinks) {
      expect(demoLink).toHaveAttribute('href', '#demo');
    }
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

  it('scrolls to the demo section when arriving with a #demo hash (post sign-out) and clears it so a refresh lands on top', () => {
    window.location.hash = '#demo';
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      renderHome();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe('');
    } finally {
      delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
      window.location.hash = '';
    }
  });
});

describe('home auth links', () => {
  it('always shows the sign-in link and register CTAs', () => {
    renderHome();

    // Sign-in sits both in the top nav and in the footer.
    const signInLinks = screen.getAllByRole('link', { name: 'Se connecter' });
    expect(signInLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of signInLinks) {
      expect(link).toHaveAttribute('href', '/auth/login');
    }
    const ctaLinks = screen.getAllByRole('link', { name: /Demander un essai gratuit/ });
    for (const link of ctaLinks) {
      expect(link).toHaveAttribute('href', '/auth/register');
    }
  });

  it('places the register CTA in the nav, the hero and the footer', () => {
    renderHome();

    const heroCta = screen.getByRole('link', { name: 'Commencer gratuitement' });
    expect(heroCta).toHaveAttribute('href', '/auth/register');

    // Exact name match: the hero CTA reads "Commencer gratuitement", the nav one "Commencer".
    const navCta = screen.getByRole('link', { name: 'Commencer' });
    expect(navCta).toHaveAttribute('href', '/auth/register');

    // The honest product facts strip replaces the old fabricated metrics.
    expect(screen.getByText('QR → Roue → Coupon')).toBeInTheDocument();
    expect(screen.getByText('Analytics en direct')).toBeInTheDocument();
    expect(screen.getByText('Essai gratuit')).toBeInTheDocument();
  });
});

describe('home footer', () => {
  it('shows login, demo, contact and privacy links', () => {
    renderHome();

    expect(screen.getByRole('link', { name: 'Nous contacter' })).toHaveAttribute(
      'href',
      'mailto:contact@dawer.com',
    );
    expect(screen.getByRole('link', { name: 'Politique de confidentialité' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});

describe('home hero wheel demo', () => {
  it('renders the interactive prize wheel with its spin button', () => {
    renderHome();

    expect(screen.getByTestId('landing-wheel-demo')).toBeInTheDocument();
    // The six sample slices are visible, including the retry slice.
    expect(screen.getAllByText('Café offert').length).toBeGreaterThan(0);
    expect(screen.getByText('Réessayez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tourner la roue' })).toBeInTheDocument();
  });

  it('spins the wheel and reveals the result', async () => {
    renderHome();

    const spinButton = screen.getByRole('button', { name: 'Tourner la roue' });
    fireEvent.click(spinButton);

    expect(screen.getByRole('button', { name: 'La roue tourne…' })).toBeDisabled();

    // The "fast" motion preset spins for 2s; the win/no-win chip lands just after.
    const result = await screen.findByText(/Vous avez gagné|Presque !/, {}, { timeout: 6000 });
    expect(result).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejouer' })).toBeEnabled();
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

  it('offers the register CTA at the bottom of the mobile panel', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));

    const panel = screen.getByRole('navigation', { name: 'Navigation principale' });
    const cta = within(panel).getByRole('link', { name: 'Commencer gratuitement' });
    expect(cta).toHaveAttribute('href', '/auth/register');
  });

  it('closes the mobile nav on Escape', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument();
  });

  it('offers the Contact anchor link in both navigations', () => {
    renderHome();

    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '#contact');

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const panel = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(panel).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '#contact');
  });
});

describe('home language switcher', () => {
  it('exposes the FR/EN toggle in the header', () => {
    renderHome();

    const group = screen.getByRole('radiogroup', { name: 'Langue' });
    expect(group).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'FR' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'EN' })).toBeInTheDocument();
  });
});

describe('home FAQ section', () => {
  it('renders the six questions with the first answer open', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Questions fréquentes' })).toBeInTheDocument();
    for (const question of ['essai gratuit', 'temps', 'réclame', 'fraudés', 'suivre', 'contacter']) {
      expect(screen.getByRole('button', { name: new RegExp(question) })).toBeInTheDocument();
    }
    expect(screen.getByText(/Créez votre espace marchand/)).toBeInTheDocument();
  });

  it('toggles answers on click, one open at a time', () => {
    renderHome();

    const second = screen.getByRole('button', { name: /Combien de temps/ });
    fireEvent.click(second);
    expect(screen.getByText(/concevez votre roue/)).toBeInTheDocument();
    expect(screen.queryByText(/Créez votre espace marchand/)).toBeNull();

    fireEvent.click(second);
    expect(screen.queryByText(/concevez votre roue/)).toBeNull();
  });
});

describe('home contact section', () => {
  it('shows the four info cards', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Contactez-nous' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+216 55 000 000' })).toHaveAttribute('href', 'tel:+21655000000');
    expect(screen.getByText('Tunis, Tunisie')).toBeInTheDocument();
    expect(screen.getByText('Lun–Ven : 9h – 18h')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contact@dawer.com' })).toHaveAttribute(
      'href',
      'mailto:contact@dawer.com',
    );
  });

  it('renders the message form with labelled required fields', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Envoyez-nous un message' })).toBeInTheDocument();
    // Labels carry a visually-hidden-assist "*" span, so match by prefix.
    expect(screen.getByLabelText(/^Nom/)).toBeRequired();
    expect(screen.getByLabelText(/^Email/)).toBeRequired();
    expect(screen.getByLabelText(/^Sujet/)).toBeRequired();
    expect(screen.getByLabelText(/^Message/)).toBeRequired();
  });

  it('embeds the Google Maps location', () => {
    renderHome();

    expect(screen.getByTitle('Localisation Google Maps')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=Tunis%2C%20Tunisie&z=12&output=embed',
    );
  });
});

describe('home social follow', () => {
  it('links the Instagram and Facebook cards', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Suivez-nous' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/dawer.tn',
    );
    expect(screen.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
      'href',
      'https://www.facebook.com/dawer.tn',
    );
  });
});