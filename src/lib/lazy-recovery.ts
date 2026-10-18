import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOADED_FLAG = 'dawer:chunk-recovery-reloaded';

/**
 * A lazy route chunk failed to load — the classic signature of a tab that
 * outlived a deploy: the old index.js references content-hashed chunk names
 * that no longer exist on the server.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed|Loading CSS chunk/i.test(
    message,
  );
}

/**
 * `lazy()` with self-healing for stale-tab chunk 404s. When a chunk import
 * fails, reload the page once so the browser picks up the current index.html
 * and its matching chunks; the sessionStorage flag stops a reload loop if the
 * failure is something else. On the second failure the error surfaces to the
 * route error boundary as usual.
 */
export function lazyWithRecovery<T extends ComponentType<Record<string, never>>>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await loader();
      // Fresh chunks loaded: clear the loop guard for the next incident.
      window.sessionStorage.removeItem(RELOADED_FLAG);
      return module;
    } catch (error) {
      if (isChunkLoadError(error) && !window.sessionStorage.getItem(RELOADED_FLAG)) {
        window.sessionStorage.setItem(RELOADED_FLAG, '1');
        window.location.reload();
        // Suspend forever while the reload tears the page down.
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
