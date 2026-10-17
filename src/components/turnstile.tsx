import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    __cfTurnstileReady?: Promise<void>;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        // A dead tag can never fire again — drop it and the cached promise so
        // the next attempt re-injects a fresh script.
        existing.remove();
        scriptPromise = null;
        reject(new Error('Turnstile failed to load.'));
      });
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptPromise = null;
      reject(new Error('Turnstile failed to load.'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

type TurnstileWidgetProps = {
  siteKey: string;
  action: string;
  /** Called with the fresh token whenever the widget issues one. */
  onToken: (token: string | null) => void;
  /** Force a reset (tokens are single-use; call after a failed attempt). */
  resetSignal?: number;
};

/**
 * Explicit-mode Cloudflare Turnstile widget (M7). Only rendered when the
 * server surfaced a site key, i.e. the operator has enabled bot protection.
 * The token is handed to the parent via `onToken` and must be sent with the
 * participate request; it is single-use, so the parent resets it after use.
 */
export function TurnstileWidget({ siteKey, action, onToken, resetSignal = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let disposed = false;

    void loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          // Managed mode: invisible challenge when possible, interaction only
          // when Cloudflare decides it is required.
          appearance: 'interaction-only',
          callback: (token: string) => onTokenRef.current(token),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // Script load failure surfaces as a null token; the spin request will
        // be rejected by the server when enforcement is on, with a retryable
        // error the visitor can see.
        onTokenRef.current(null);
      });

    return () => {
      disposed = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget already gone.
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action]);

  // Parent signals a reset (e.g. after a rejected spin): clear the consumed
  // token and let Cloudflare issue a fresh one.
  useEffect(() => {
    if (resetSignal === 0) return;
    onTokenRef.current(null);
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // Widget may have been removed.
      }
    }
  }, [resetSignal]);

  return <div ref={containerRef} className="cf-turnstile" />;
}
