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
  readonly badge?: string;
  readonly featured?: boolean;
  readonly features: readonly string[];
}

const homepagePlans: Record<Locale, readonly HomepagePlan[]> = {
  fr: [
    {
      name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
      features: ['Jusqu’à 100 clients collectés', '200 e-mails marketing inclus', '100 SMS inclus', '100 WhatsApp marketing inclus', 'Accès complet à la roue', 'Support par e-mail', 'Sans engagement'],
    },
    {
      name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year', badge: 'Le plus populaire', featured: true,
      features: ['Jusqu’à 1 000 clients collectés', '1 000 e-mails marketing inclus', '200 SMS inclus', '200 WhatsApp marketing inclus', 'Accès complet à la roue', 'Support e-mail prioritaire', 'Vue d’ensemble et analytics de base', 'Plaque QR code incluse'],
    },
    {
      name: 'Business', slug: 'scale', priceCents: 79900, interval: '3_years', badge: 'Offre de lancement',
      features: ['Jusqu’à 10 000 clients collectés', '10 000 e-mails marketing inclus', '300 SMS inclus par an', '300 WhatsApp marketing inclus par an', 'Accès complet à la roue', 'Analytics avancées', 'Support prioritaire'],
    },
    {
      name: 'Enterprise', slug: 'premium', priceCents: 149900, interval: '3_years',
      features: ['Clients collectés illimités', 'Volumes de messages personnalisés', 'Accès complet à la roue', 'Analytics avancées multi-sites', 'API et intégrations sur mesure', 'Accompagnement dédié', 'Support prioritaire'],
    },
  ],
  en: [
    {
      name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
      features: ['Up to 100 collected customers', '200 marketing emails included', '100 SMS included', '100 WhatsApp marketing included', 'Full wheel access', 'Email support', 'No commitment'],
    },
    {
      name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year', badge: 'Most popular', featured: true,
      features: ['Up to 1,000 collected customers', '1,000 marketing emails included', '200 SMS included', '200 WhatsApp marketing included', 'Full wheel access', 'Priority email support', 'Overview and basic analytics', 'QR code plate included'],
    },
    {
      name: 'Business', slug: 'scale', priceCents: 79900, interval: '3_years', badge: 'Launch offer',
      features: ['Up to 10,000 collected customers', '10,000 marketing emails included', '300 SMS per year included', '300 WhatsApp per year included', 'Full wheel access', 'Advanced analytics', 'Priority support'],
    },
    {
      name: 'Enterprise', slug: 'premium', priceCents: 149900, interval: '3_years',
      features: ['Unlimited collected customers', 'Custom message volumes', 'Full wheel access', 'Advanced multi-site analytics', 'Custom API and integrations', 'Dedicated onboarding', 'Priority support'],
    },
  ],
};

export function getPlanMarketing(locale: Locale): Record<string, MarketingPlan> {
  return planMarketing[locale];
}

export function getHomepagePlans(locale: Locale): readonly HomepagePlan[] {
  return homepagePlans[locale];
}

export function formatPlanPrice(priceCents: number): string {
  const amount = (priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2);
  return `${amount} DT`;
}

const planIntervals: Record<Locale, Record<string, string>> = {
  fr: { year: '1 an', '3_years': '3 ans', '3_months': '3 mois' },
  en: { year: '1 year', '3_years': '3 years', '3_months': '3 months' },
};

export function formatPlanInterval(interval: string, locale: Locale = 'fr'): string {
  const labels = planIntervals[locale];
  return labels[interval] ?? (locale === 'fr' ? '3 mois' : '3 months');
}
