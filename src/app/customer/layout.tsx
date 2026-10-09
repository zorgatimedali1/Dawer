import { Outlet } from 'react-router-dom';

/**
 * Chrome-free shell for the public campaign experience. It deliberately renders
 * no navigation so the play flow stays focused, but it now follows the theme
 * instead of pinning the page to white.
 */
export default function CustomerLayout() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <Outlet />
    </div>
  );
}