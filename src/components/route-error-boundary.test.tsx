import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteBoundary, RouteErrorBoundary } from '@/components/route-error-boundary';

describe('RouteErrorBoundary', () => {
  let shouldThrow = true;

  function Bomb() {
    if (shouldThrow) throw new Error('boom');
    return <p>recovered content</p>;
  }

  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the fallback when a child throws', () => {
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Bomb />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue');
    expect(screen.queryByText('recovered content')).not.toBeInTheDocument();
  });

  it('recovers when the user retries and the error is gone', () => {
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Bomb />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    shouldThrow = false;
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Bomb />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('RouteBoundary', () => {
  let shouldThrow = true;

  function Bomb() {
    if (shouldThrow) throw new Error('boom');
    return <p>recovered content</p>;
  }

  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets the error state when the route changes', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RouteBoundary>
          <Bomb />
        </RouteBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    // A navigation remounts the boundary (new key), clearing the stale error.
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteBoundary>
          <Bomb />
        </RouteBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('recovered content')).toBeInTheDocument();
  });
});
