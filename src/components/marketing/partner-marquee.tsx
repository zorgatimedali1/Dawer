import { useEffect, useState } from 'react';
import { PartnersService, type Partner } from '@/services/partners.service';
import { useT } from '@/hooks/use-t';

/** Minimum logos per half-track so the loop still covers a wide viewport. */
const MIN_HALF_ITEMS = 10;

interface PartnerMarqueeProps {
  /**
   * Preloaded partners. When omitted the component fetches
   * `GET /api/public/partners` on mount and renders nothing until it knows
   * whether the operator configured any partners at all.
   */
  partners?: Partner[];
}

/**
 * Infinite right-to-left partner logo strip for the landing page.
 *
 * The track holds two identical halves (`translateX(-50%)` lands exactly on
 * the seam — spacing comes from item padding, never from a track `gap`, so
 * the loop cannot jump). Hovering the strip pauses the animation via
 * `animation-play-state`, and `motion-reduce:animate-none` plus the global
 * reduced-motion block keep it static for users who ask for that.
 */
export function PartnerMarquee({ partners: preloaded }: PartnerMarqueeProps) {
  const t = useT();
  const [partners, setPartners] = useState<Partner[] | null>(preloaded ?? null);

  useEffect(() => {
    if (preloaded !== undefined) return;
    let cancelled = false;
    void PartnersService.list()
      .then((rows) => {
        if (!cancelled) setPartners(rows);
      })
      .catch(() => {
        // A marketing strip never breaks the page: fail to "no partners".
        if (!cancelled) setPartners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [preloaded]);

  if (!partners || partners.length === 0) return null;

  // Repeat a short list so one half still fills a desktop viewport, then
  // duplicate the result: the track is always exactly two equal halves.
  const repeats = Math.max(1, Math.ceil(MIN_HALF_ITEMS / partners.length));
  const half = Array.from({ length: repeats }, () => partners).flat();
  const track = [...half, ...half];

  return (
    <section className="relative py-14 sm:py-16" aria-label={t.landing.partnersTitle}>
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex items-center gap-4 sm:gap-6">
          <span aria-hidden className="h-px flex-1 bg-line" />
          <h2 className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle sm:text-[12px]">
            {t.landing.partnersTitle}
          </h2>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      </div>

      <div className="group relative mt-10 overflow-hidden mask-fade-x">
        <ul className="flex w-max animate-marquee-slow list-none motion-reduce:animate-none group-hover:[animation-play-state:paused]">
          {track.map((partner, index) => (
            <li
              key={`${partner.id}-${index}`}
              className="flex shrink-0 items-center pr-14 sm:pr-20"
              title={partner.name}
            >
              <img
                src={partner.logoUrl}
                alt={partner.name}
                loading="lazy"
                draggable={false}
                className="h-10 w-auto max-w-[170px] object-contain transition duration-300 ease-swift sm:h-12 sm:max-w-[230px]"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
