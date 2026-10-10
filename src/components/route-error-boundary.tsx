import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-t';
import { reportError } from '@/lib/monitoring';

export type ErrorFallbackProps = { error: Error; reset: () => void };

type Props = { children: ReactNode; fallback?: (props: ErrorFallbackProps) => ReactNode };
type State = { error: Error | null };

function DefaultErrorFallback({ reset }: ErrorFallbackProps) {
  const t = useT();
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center px-5 text-center">
      <h1 className="text-lg font-semibold text-ink">{t.boundary.title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">{t.boundary.description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>{t.boundary.retry}</Button>
        <Button asChild variant="outline">
          <Link to="/">{t.boundary.home}</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Catches render errors so a broken component shows a recoverable fallback
 * instead of a blank white screen. Wrap routes, not the whole app, so the
 * shell chrome (providers, router) survives the crash.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- crash diagnostics even when monitoring is off
    console.error('Route error boundary caught an error', error, info.componentStack);
    reportError(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    const { error } = this.state;
    if (error) {
      const Fallback = this.props.fallback ?? DefaultErrorFallback;
      return <Fallback error={error} reset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/**
 * Route-aware boundary: remounts (and therefore clears the error state) on
 * navigation, so "back to home" from the fallback actually works.
 */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>;
}
