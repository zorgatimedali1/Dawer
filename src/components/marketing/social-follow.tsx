import { Facebook, Instagram } from 'lucide-react';
import { useT } from '@/hooks/use-t';

/**
 * dawer's own social profiles — EDIT THESE VALUES in one place.
 */
const SOCIAL_HANDLE = '@dawer.tn';
const SOCIAL_LINKS = [
  { label: 'Instagram', href: 'https://www.instagram.com/dawer.tn', icon: Instagram },
  { label: 'Facebook', href: 'https://www.facebook.com/dawer.tn', icon: Facebook },
];

/**
 * "Follow us" strip: centred handle + two icon cards, mirroring the merchant
 * template look on the Dawer brand surfaces.
 */
export function SocialFollow() {
  const t = useT();

  return (
    <section aria-label={t.landing.socialTitle} className="relative">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <h2 className="text-balance text-center text-[26px] font-semibold tracking-[-0.03em] text-ink sm:text-[32px]">
          {t.landing.socialTitle}
        </h2>
        <p className="mt-3 text-center text-[13.5px] text-ink-subtle">{SOCIAL_HANDLE}</p>

        <div className="mx-auto mt-10 grid max-w-md grid-cols-2 gap-4">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              aria-label={social.label}
              className="flex aspect-[4/3] items-center justify-center rounded-xl border border-line bg-elevated text-ink shadow-card transition-[border-color,box-shadow,transform] duration-180 ease-swift hover:-translate-y-0.5 hover:border-brand-500/50 hover:text-brand-700 hover:shadow-lift dark:hover:text-accent-bright"
            >
              <social.icon aria-hidden className="h-7 w-7" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
