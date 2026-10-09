import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from '@/app/privacy/page';

describe('privacy policy page', () => {
  it('presents the policy sections and contact email', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Politique de confidentialité' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Données collectées' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Utilisation des données' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partage des données' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conservation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vos droits' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sécurité & cookies' })).toBeInTheDocument();
    const contactLinks = screen.getAllByRole('link', { name: 'contact@dawer.com' });
    expect(contactLinks).toHaveLength(2);
    expect(contactLinks[0]).toHaveAttribute('href', 'mailto:contact@dawer.com');
  });
});
