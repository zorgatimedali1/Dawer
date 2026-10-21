import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import BlogListPage from '@/app/blog/page';
import BlogArticlePage from '@/app/blog/[slug]/page';
import { blogArticles, blogExcerpt, getArticle } from '@/content/blog';
import { AppProvider } from '@/contexts/app-context';

function renderPage(entry: string, locale: 'fr' | 'en' = 'fr') {
  window.localStorage.setItem('campaign-engage-locale', locale);
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/blog" element={<BlogListPage />} />
          <Route path="/en/blog" element={<BlogListPage />} />
          <Route path="/blog/:slug" element={<BlogArticlePage />} />
          <Route path="/en/blog/:slug" element={<BlogArticlePage />} />
          <Route path="/" element={<p>fr-fallback</p>} />
          <Route path="/en" element={<p>en-fallback</p>} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('blog list page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sorts the cards newest first and links to the French slugs', () => {
    renderPage('/blog');

    expect(screen.getByRole('heading', { name: 'Blog', level: 1 })).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(blogArticles.length);
    expect(headings[0]?.textContent ?? '').toContain('WhatsApp');
    expect(headings[headings.length - 1]?.textContent ?? '').toContain('fortune');

    expect(screen.getByRole('link', { name: /fortune/i })).toHaveAttribute(
      'href',
      '/blog/roue-de-la-fortune-magasin',
    );
    for (const link of screen.getAllByRole('link', { name: /.*/ })) {
      expect(link.getAttribute('href')).not.toMatch(/^\/en\b/);
    }
    expect(screen.getAllByText(/min de lecture/).length).toBeGreaterThan(0);
  });

  it('switches the copy and slug prefix on the EN prefixed route', () => {
    renderPage('/en/blog', 'en');

    expect(screen.getByRole('heading', { name: 'Blog', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/min read/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /fortune wheel/i })).toHaveAttribute(
      'href',
      '/en/blog/roue-de-la-fortune-magasin',
    );
  });
});

describe('blog article page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the French body of the article', () => {
    renderPage('/blog/roue-de-la-fortune-magasin');

    expect(screen.getByRole('heading', { level: 1, name: /fortune/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /point d.attraction au comptoir/i })).toBeInTheDocument();
    expect(screen.getByText(/échange est explicite/i)).toBeInTheDocument();
    expect(screen.getByText(/min de lecture/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retour au blog/i })).toHaveAttribute('href', '/blog');
  });

  it('renders the English body on the EN route', () => {
    renderPage('/en/blog/whatsapp-marketing-commercants', 'en');

    expect(screen.getByRole('heading', { level: 1, name: /WhatsApp/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /customers. pockets/i })).toBeInTheDocument();
    expect(screen.getByText(/4 min read/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the blog/i })).toHaveAttribute('href', '/en/blog');
  });

  it('redirects unknown slugs to home for the current locale', () => {
    renderPage('/blog/slug-inconnu');
    expect(screen.getByText('fr-fallback')).toBeInTheDocument();

    renderPage('/en/blog/slug-inconnu', 'en');
    expect(screen.getByText('en-fallback')).toBeInTheDocument();
  });
});

describe('blog store helpers', () => {
  it('finds articles by slug and misses unknown ones', () => {
    const article = getArticle('acquisition-clients-tunisie');
    expect(article?.slug).toBe('acquisition-clients-tunisie');
    expect(getArticle('inexistant')).toBeUndefined();
  });

  it('returns a locale-appropriate excerpt from the intro', () => {
    const article = getArticle('acquisition-clients-tunisie');
    if (!article) throw new Error('article should exist');

    const frExcerpt = blogExcerpt(article, 'fr');
    expect(frExcerpt.length).toBeLessThanOrEqual(180);
    expect(frExcerpt).not.toBe(article.body.en.intro);

    const enExcerpt = blogExcerpt(article, 'en');
    expect(enExcerpt.length).toBeLessThanOrEqual(180);
    expect(enExcerpt).not.toBe(frExcerpt);
  });
});
