import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Fire-and-forget page-view beacon: one POST per SPA route change feeds the
 * operator console's website-traffic analytics (site_visits). The visitor
 * identity stays server-side (IP + UA hash), so nothing is stored in the
 * browser and the request is skipped in tests where no trail is wanted.
 */
export function VisitBeacon() {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    void fetch('/api/public/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {
      // Analytics must never disturb the page for the visitor.
    });
  }, [location.pathname]);

  return null;
}
