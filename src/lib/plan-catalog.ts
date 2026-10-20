import type { Locale } from '@/lib/i18n';

export interface MarketingPlan {
  description: string;
  badge?: string;
}

const planMarketing: Record<Locale, Record<string, MarketingPlan>> = {
  fr: {
    starter: { description: 'L’essentiel pour démarrer et fidéliser vos premiers clients.' },
    growth: { description: 'Le meilleur équilibre pour mesurer et accélérer votre croissance.', badge: 'Le plus populaire' },
    scale: { description: 'Plus de volume et des analyses avancées pour votre activité.', badge: 'Offre de lancement' },
    premium: { description: 'Une solution personnalisée pour les équipes et réseaux multi-sites.' },
  },
  en: {
    starter: { description: 'The essentials to get started and reward your first customers.' },
    growth: { description: 'The best balance to measure and accelerate your growth.', badge: 'Most popular' },
    scale: { description: 'More volume and advanced analytics for your business.', badge: 'Launch offer' },
    premium: { description: 'A tailored solution for multi-site teams and networks.' },
  },
};

export interface HomepagePlan {
  readonly name: string;
  readonly slug: string;
  readonly priceCents: number;
  readonly interval: string;
  readonly badge?: string | undefined;
  readonly featured?: boolean | undefined;
  readonly features: readonly string[];
}

/** A live plan row from `GET /api/public/plans` (operator-maintained). */
export interface LivePlan {
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  features: string[];
}

const homepagePlans: Record<Locale, readonly HomepagePlan[]> = {
  fr: [
    {
      name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
      features: ['Jusqu’à 200 clients collectés', '200 e-mails marketing inclus (bientôt disponible)', '100 SMS inclus', '100 WhatsApp marketing inclus (bientôt disponible)', 'Accès complet à la roue', 'Support par e-mail', 'Sans engagement'],
    },
    {
      name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year', badge: 'Le plus populaire', featured: true,
      features: ['Jusqu’à 1 000 clients collectés', '1 000 e-mails marketing inclus (bientôt disponible)', '200 SMS inclus', '200 WhatsApp marketing inclus (bientôt disponible)', 'Accès complet à la roue', 'Support e-mail prioritaire', 'Vue d’ensemble et analytics de base', 'Plaque QR code incluse', 'Gestion des récompenses', 'Logo central de la roue'],
    },
    {
      name: 'Business', slug: 'scale', priceCents: 79900, interval: '2_years', badge: 'Offre de lancement',
      features: ['Jusqu’à 10 000 clients collectés', '10 000 e-mails marketing inclus (bientôt disponible)', '300 SMS inclus par an', '300 WhatsApp marketing inclus par an (bientôt disponible)', 'Accès complet à la roue', 'Analytics avancées', 'Support prioritaire', 'Gestion des récompenses', 'Configuration avancée de la roue (couleurs et animations)', 'Logo central de la roue'],
    },
    {
      name: 'Enterprise', slug: 'premium', priceCents: 149900, interval: '3_years',
      features: ['Clients collectés illimités', 'Volumes de messages personnalisés (bientôt disponible)', 'Accès complet à la roue', 'Analytics avancées multi-sites', 'API et intégrations sur mesure', 'Accompagnement dédié', 'Support prioritaire', 'Gestion des récompenses', 'Configuration avancée de la roue (couleurs et animations)', 'Logo central de la roue'],
    },
  ],
  en: [
    {
      name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
      features: ['Up to 200 collected customers', '200 marketing emails included (coming soon)', '100 SMS included', '100 WhatsApp marketing included (coming soon)', 'Full wheel access', 'Email support', 'No commitment'],
    },
    {
      name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year', badge: 'Most popular', featured: true,
      features: ['Up to 1,000 collected customers', '1,000 marketing emails included (coming soon)', '200 SMS included', '200 WhatsApp marketing included (coming soon)', 'Full wheel access', 'Priority email support', 'Overview and basic analytics', 'QR code plate included', 'Rewards management', 'Centre wheel logo'],
    },
    {
      name: 'Business', slug: 'scale', priceCents: 79900, interval: '2_years', badge: 'Launch offer',
      features: ['Up to 10,000 collected customers', '10,000 marketing emails included (coming soon)', '300 SMS per year included', '300 WhatsApp per year included (coming soon)', 'Full wheel access', 'Advanced analytics', 'Priority support', 'Rewards management', 'Advanced wheel design (colours and animation)', 'Centre wheel logo'],
    },
    {
      name: 'Enterprise', slug: 'premium', priceCents: 149900, interval: '3_years',
      features: ['Unlimited collected customers', 'Custom message volumes (coming soon)', 'Full wheel access', 'Advanced multi-site analytics', 'Custom API and integrations', 'Dedicated onboarding', 'Priority support', 'Rewards management', 'Advanced wheel design (colours and animation)', 'Centre wheel logo'],
    },
  ],
};

export function getPlanMarketing(locale: Locale): Record<string, MarketingPlan> {
  return planMarketing[locale];
}

export function getHomepagePlans(locale: Locale): readonly HomepagePlan[] {
  return homepagePlans[locale];
}

/**
 * Overlays the operator-maintained plan list (name, price, interval, bullets)
 * onto the bundled catalog. The catalog only supplies what D1 does not store:
 * the localized badge and the featured flag, matched by slug. An empty or
 * failed live list keeps the bundled catalog, so the section never blanks.
 */
export function mergeLiveHomepagePlans(
  locale: Locale,
  live: readonly LivePlan[] | null,
): readonly HomepagePlan[] {
  const fallback = homepagePlans[locale];
  if (!live || live.length === 0) return fallback;

  return live.map((plan) => {
    const catalogEntry = fallback.find((entry) => entry.slug === plan.slug);
    return {
      name: plan.name,
      slug: plan.slug,
      priceCents: plan.priceCents,
      interval: plan.interval,
      badge: catalogEntry?.badge,
      featured: catalogEntry?.featured,
      features: plan.features.length > 0 ? plan.features : (catalogEntry?.features ?? []),
    } satisfies HomepagePlan;
  });
}

export function formatPlanPrice(priceCents: number): string {
  const amount = (priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2);
  return `${amount} DT`;
}

const planIntervals: Record<Locale, Record<string, string>> = {
  fr: { year: '1 an', '2_years': '2 ans', '3_years': '3 ans', '3_months': '3 mois', '6_months': '6 mois' },
  en: { year: '1 year', '2_years': '2 years', '3_years': '3 years', '3_months': '3 months', '6_months': '6 months' },
};

export function formatPlanInterval(interval: string, locale: Locale = 'fr'): string {
  const labels = planIntervals[locale];
  return labels[interval] ?? (locale === 'fr' ? '3 mois' : '3 months');
}

/**
 * Campaign stats (participants / conversion) ship from the Pro tier up —
 * mirrors the backend gate (whose analytics entitlement check unlocks the same
 * set of seeded plans). While billing is loading the slug is unknown and the
 * stats stay hidden, the starter-safe default.
 */
export const CAMPAIGN_STATS_PLAN_SLUGS = ['growth', 'scale', 'premium'] as const;

export function campaignStatsAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (CAMPAIGN_STATS_PLAN_SLUGS as readonly string[]).includes(slug));
}
