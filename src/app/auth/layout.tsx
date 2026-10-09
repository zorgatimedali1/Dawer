import { Outlet } from 'react-router-dom';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { useT } from '@/hooks/use-t';

export default function AuthLayout() {
  const t = useT();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface-2 px-4 py-10 sm:py-14">
      {/* Ambient brand wash. Decorative only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dw-grid-fade absolute inset-0" />
        <div className="absolute -left-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-brand-500/18 blur-3xl" />
        <div className="absolute -bottom-48 -right-24 h-[24rem] w-[24rem] rounded-full bg-brand-400/14 blur-3xl dark:bg-brand-500/12" />
      </div>

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-7 flex animate-slide-down flex-col items-center gap-4 text-center">
          <DawerLogo className="h-11 w-auto" />
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-accent-bright">
              {t.auth.eyebrow}
            </p>
            <p className="text-pretty text-[13.5px] leading-relaxed text-ink-muted">
              {t.auth.tagline}
            </p>
          </div>
        </div>

        <div className="animate-pop-in rounded-2xl border border-line bg-elevated p-6 shadow-card sm:p-7">
          <Outlet />
        </div>
      </div>
    </main>
  );
}