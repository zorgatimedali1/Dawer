import { describe, expect, it } from 'vitest';
import {
  SITE_DESCRIPTIONS,
  SITE_NAME,
  SITE_URL,
  articleSchema,
  faqPageSchema,
  hreflangLinks,
  localBusinessSchema,
  organizationSchema,
  softwareApplicationSchema,
  withContext,
} from '@/lib/seo';
import type { GraphEntity } from '@/lib/seo';

describe('site constants', () => {
  it('exposes the Dawer site identity', () => {
    expect(SITE_URL).toBe('https://dawer.tn');
    expect(SITE_NAME).toBe('Dawer');
    expect(SITE_DESCRIPTIONS.fr).not.toBe('');
    expect(SITE_DESCRIPTIONS.en).not.toBe('');
  });
});

describe('withContext', () => {
  it('wraps an entity in the schema.org graph shape', () => {
    const wrapped = withContext({ '@type': 'Thing', name: 'test' });
    expect(wrapped['@context']).toBe('https://schema.org');
    expect(wrapped['@type']).toBe('Thing');
    expect(Object.isFrozen(wrapped)).toBe(true);
  });
});

describe('organizationSchema', () => {
  it('emits an Organization with the real social profiles', () => {
    const graph: GraphEntity = organizationSchema();
    expect(graph['@context']).toBe('https://schema.org');
    expect(organizationSchema()).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Dawer',
      url: 'https://dawer.tn',
      logo: 'https://dawer.tn/dawer-logo.png',
      sameAs: ['https://www.instagram.com/dawer.tn', 'https://www.facebook.com/dawer.tn'],
    });
    expect(Object.isFrozen(organizationSchema())).toBe(true);
  });
});

describe('localBusinessSchema', () => {
  it('emits the real NAP with Tunisian context', () => {
    const business = localBusinessSchema();
    expect(business['@type']).toBe('LocalBusiness');
    expect(business.name).toBe('Dawer');
    expect(business.telephone).toBe('+21655000000');
    expect(business.email).toBe('contact@dawer.com');
    expect(business.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Tunis',
      addressCountry: 'TN',
    });
    expect(business.areaServed).toBe('TN');
    expect(business.currenciesAccepted).toBe('TND');
  });

  it('derives priceRange from the real plan catalog prices', () => {
    expect(localBusinessSchema().priceRange).toBe('149 DT - 1499 DT');
  });
});

describe('softwareApplicationSchema', () => {
  it('emits a SoftwareApplication priced in TND from every catalog plan', () => {
    const app = softwareApplicationSchema();
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.applicationCategory).toBe('BusinessApplication');
    expect(app.operatingSystem).toBe('Web');
    expect(app.offers).toHaveLength(4);
    for (const offer of app.offers) {
      expect(offer['@type']).toBe('Offer');
      expect(offer.priceCurrency).toBe('TND');
      expect(offer.price).toBeGreaterThan(0);
    }
    const pro = app.offers.find((offer) => offer.name === 'Pro');
    expect(pro?.price).toBe(349);
    const starter = app.offers.find((offer) => offer.name === 'Starter');
    expect(starter?.priceSpecification).toEqual({
      '@type': 'UnitPriceSpecification',
      price: 149,
      priceCurrency: 'TND',
      billingDuration: 3,
      unitCode: 'MON',
    });
  });

  it('skips plans lacking a price', () => {
    const app = softwareApplicationSchema([
      { name: 'Priced', priceCents: 123450, interval: '3_months' },
      { name: 'Free', priceCents: null },
      { name: 'Quote' },
      { name: 'Invalid', priceCents: -100 },
      { name: 'NaN', priceCents: Number.NaN },
    ]);
    expect(app.offers).toHaveLength(1);
    expect(app.offers[0]?.name).toBe('Priced');
    expect(app.offers[0]?.price).toBe(1234.5);
  });
});

describe('faqPageSchema', () => {
  it('emits a FAQPage with one Question per entry', () => {
    const graph: GraphEntity = faqPageSchema([
      { question: 'Comment ça marche ?', answer: 'Vos clients tournent la roue.' },
      { question: 'Où ?', answer: 'En boutique.' },
    ]);
    expect(graph['@context']).toBe('https://schema.org');
    const faq = faqPageSchema([{ question: 'Q ?', answer: 'A.' }]);
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity).toHaveLength(1);
    expect(faq.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: 'Q ?',
      acceptedAnswer: { '@type': 'Answer', text: 'A.' },
    });
  });

  it('rejects an empty FAQ list', () => {
    expect(() => faqPageSchema([])).toThrow(/at least one FAQ/);
  });
});

describe('articleSchema', () => {
  it('emits an Article authored and published by Dawer', () => {
    const graph: GraphEntity = articleSchema({
      slug: 'wheel-guide',
      title: 'Guide de la roue',
      description: 'Tout savoir.',
      published: '2026-01-15',
      locale: 'fr',
    });
    expect(graph['@type']).toBe('Article');
    const article = articleSchema({
      slug: 'wheel-guide',
      title: 'Guide de la roue',
      description: 'Tout savoir.',
      published: '2026-01-15',
      locale: 'fr',
    });
    expect(article.headline).toBe('Guide de la roue');
    expect(article.datePublished).toBe('2026-01-15');
    expect(article.inLanguage).toBe('fr');
    expect(article.mainEntityOfPage).toBe('https://dawer.tn/blog/wheel-guide');
    expect(article.author).toEqual({
      '@type': 'Organization',
      name: 'Dawer',
      url: 'https://dawer.tn',
    });
    expect(article.publisher).toBe(article.author);
  });

  it('truncates headlines to 110 characters with an ellipsis', () => {
    const short = articleSchema({
      slug: 'a',
      title: 'x'.repeat(110),
      description: 'd',
      published: '2026-01-15',
      locale: 'fr',
    });
    expect(short.headline).toHaveLength(110);
    const long = articleSchema({
      slug: 'a',
      title: 'y'.repeat(200),
      description: 'd',
      published: '2026-01-15',
      locale: 'fr',
    });
    expect(long.headline).toHaveLength(110);
    expect(long.headline.endsWith('…')).toBe(true);
    expect(long.headline.slice(0, 109)).toBe('y'.repeat(109));
  });
});

describe('hreflangLinks', () => {
  it('produces exactly three links with x-default pointing to the FR path', () => {
    const links = hreflangLinks('/blog/a', '/en/blog/a');
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.hreflang)).toEqual(['fr', 'en', 'x-default']);
    expect(links[0]?.rel).toBe('alternate');
    expect(links[0]?.href).toBe('https://dawer.tn/blog/a');
    expect(links[1]?.href).toBe('https://dawer.tn/en/blog/a');
    expect(links[2]?.href).toBe('https://dawer.tn/blog/a');
    expect(links[2]?.href).toBe(links[0]?.href);
  });

  it('normalizes slashes against a custom site URL', () => {
    const links = hreflangLinks('blog/a', 'en/blog/a', 'https://custom.example/');
    expect(links[0]?.href).toBe('https://custom.example/blog/a');
    expect(links[1]?.href).toBe('https://custom.example/en/blog/a');
    expect(links[2]?.href).toBe('https://custom.example/blog/a');
  });
});
