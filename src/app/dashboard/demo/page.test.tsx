import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import DemoPage from '@/app/dashboard/demo/page';
import { DEMO_VIDEO_EMBED_URL } from '@/lib/demo-video';

function renderDemo() {
  return render(
    <MemoryRouter>
      <DemoPage />
    </MemoryRouter>,
  );
}

describe('dashboard demo page', () => {
  it('shows the product demo video', () => {
    renderDemo();

    expect(screen.getByRole('heading', { name: 'Voyez la plateforme en action' })).toBeInTheDocument();

    const frame = screen.getByTitle('Vidéo de démonstration de la plateforme');
    expect(frame).toHaveAttribute('src', DEMO_VIDEO_EMBED_URL);
    expect(frame.closest('.aspect-video')).not.toBeNull();
  });

  it('links to the plans so trial users can upgrade', () => {
    renderDemo();

    const plansLink = screen.getByRole('link', { name: 'Voir les plans' });
    expect(plansLink).toHaveAttribute('href', '/dashboard/billing');
  });
});
