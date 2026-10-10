import { createRoot } from 'react-dom/client';
import PlatformApp from './App';
import '../app/globals.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  void import('@/lib/sentry.client').then((m) => m.initSentry('platform'));
}

createRoot(document.getElementById('root')!).render(<PlatformApp />);
