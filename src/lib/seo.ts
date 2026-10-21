import { formatPlanPrice, getHomepagePlans } from './plan-catalog';

export const SITE_URL = 'https://dawer.tn';
export const SITE_NAME = 'Dawer';

export type SiteLocale = 'fr' | 'en';

export const SITE_DESCRIPTIONS: Readonly<Record<SiteLocale, string>> = Object.freeze({
  fr: 'Dawer aide les commerces tunisiens à collecter et fidéliser leurs clients : roue de la fidélité, e-mails, SMS et WhatsApp marketing.',
  en: 'Dawer helps Tunisian businesses collect and retain customers with a prize wheel plus email, SMS and WhatsApp marketing.',
});

export const SCHEMA_CONTEXT = 'https://schema.org' as const;

export type JsonLdContext = { readonly '@context': typeof SCHEMA_CONTEXT };

export type GraphEntity = JsonLdContext & {
  readonly '@type': string;
  readonly [key: string]: unknown;
};

export function withContext<T extends { readonly '@type': string }>(
  entity: T,
): Readonly<JsonLdContext & T> {
  return Object.freeze({ '@context': SCHEMA_CONTEXT, ...entity }) as Readonly<JsonLdContext & T>;
}

const SOCIAL_PROFILES: readonly string[] = Object.freeze([
  'https://www.instagram.com/dawer.tn',
  'https://www.facebook.com/dawer.tn',
]);

export type OrganizationSchema = {
  readonly '@type': 'Organization';
  readonly name: string;
  readonly url: string;
  readonly logo: string;
  readonly sameAs: readonly string[];
};

export function organizationSchema(): Readonly<JsonLdContext & OrganizationSchema> {
  return withContext({
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/dawer-logo.png`,
    sameAs: SOCIAL_PROFILES,
  });
}

export type PostalAddressSchema = {
  readonly '@type': 'PostalAddress';
  readonly addressLocality: string;
  readonly addressCountry: string;
};

export type LocalBusinessSchema = {
  readonly '@type': 'LocalBusiness';
  readonly name: string;
  readonly url: string;
  readonly telephone: string;
  readonly email: string;
  readonly address: PostalAddressSchema;
  readonly areaServed: string;
  readonly currenciesAccepted: string;
  readonly priceRange?: string;
};

const CONTACT_TELEPHONE = '+21655000000';
const CONTACT_EMAIL = 'contact@dawer.com';

export function localBusinessSchema(): Readonly<JsonLdContext & LocalBusinessSchema> {
  const pricedCents = getHomepagePlans('fr')
    .map((plan) => plan.priceCents)
    .filter((cents) => Number.isFinite(cents) && cents >= 0);
  const priceRange =
    pricedCents.length === 0
      ? undefined
      : `${formatPlanPrice(Math.min(...pricedCents))} - ${formatPlanPrice(Math.max(...pricedCents))}`;
  return withContext({
    '@type': 'LocalBusiness',
    name: SITE_NAME,
    url: SITE_URL,
    telephone: CONTACT_TELEPHONE,
    email: CONTACT_EMAIL,
    address: { '@type': 'PostalAddress', addressLocality: 'Tunis', addressCountry: 'TN' },
    areaServed: 'TN',
    currenciesAccepted: 'TND',
    ...(priceRange !== undefined ? { priceRange } : {}),
  });
}

export interface PlanOfferInput {
  readonly name: string;
  readonly priceCents?: number | null;
  readonly interval?: string | null;
}

export type UnitPriceSpecificationSchema = {
  readonly '@type': 'UnitPriceSpecification';
  readonly price: number;
  readonly priceCurrency: string;
  readonly billingDuration: number;
  readonly unitCode: 'MON' | 'ANN';
};

export type OfferSchema = {
  readonly '@type': 'Offer';
  readonly name: string;
  readonly price: number;
  readonly priceCurrency: string;
  readonly priceSpecification?: UnitPriceSpecificationSchema;
};

export type SoftwareApplicationSchema = {
  readonly '@type': 'SoftwareApplication';
  readonly name: string;
  readonly url: string;
  readonly applicationCategory: string;
  readonly operatingSystem: string;
  readonly offers: readonly OfferSchema[];
};

const INTERVAL_UNITS: Record<string, readonly [unitCode: 'MON' | 'ANN', billingDuration: number]> = {
  '3_months': ['MON', 3],
  '6_months': ['MON', 6],
  month: ['MON', 1],
  year: ['ANN', 1],
  '2_years': ['ANN', 2],
  '3_years': ['ANN', 3],
};

function buildOffers(plans: readonly PlanOfferInput[]): readonly OfferSchema[] {
  const offers: OfferSchema[] = [];
  for (const plan of plans) {
    if (typeof plan.priceCents !== 'number' || !Number.isFinite(plan.priceCents) || plan.priceCents < 0) {
      continue;
    }
    const price = plan.priceCents / 100;
    const unit =
      typeof plan.interval === 'string' ? INTERVAL_UNITS[plan.interval] : undefined;
    const specification: UnitPriceSpecificationSchema | undefined =
      unit === undefined
        ? undefined
        : {
            '@type': 'UnitPriceSpecification',
            price,
            priceCurrency: 'TND',
            billingDuration: unit[1],
            unitCode: unit[0],
          };
    offers.push(
      Object.freeze(
        specification === undefined
          ? { '@type': 'Offer', name: plan.name, price, priceCurrency: 'TND' }
          : {
              '@type': 'Offer',
              name: plan.name,
              price,
              priceCurrency: 'TND',
              priceSpecification: specification,
            },
      ),
    );
  }
  return Object.freeze(offers);
}

export function softwareApplicationSchema(
  plans: readonly PlanOfferInput[] = getHomepagePlans('fr'),
): Readonly<JsonLdContext & SoftwareApplicationSchema> {
  return withContext({
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: buildOffers(plans),
  });
}

export interface FaqInput {
  readonly question: string;
  readonly answer: string;
}

export type AnswerSchema = {
  readonly '@type': 'Answer';
  readonly text: string;
};

export type QuestionSchema = {
  readonly '@type': 'Question';
  readonly name: string;
  readonly acceptedAnswer: AnswerSchema;
};

export type FaqPageSchema = {
  readonly '@type': 'FAQPage';
  readonly mainEntity: readonly QuestionSchema[];
};

export function faqPageSchema(faqs: readonly FaqInput[]): Readonly<JsonLdContext & FaqPageSchema> {
  if (faqs.length === 0) {
    throw new Error('FAQPage schema requires at least one FAQ');
  }
  return withContext({
    '@type': 'FAQPage',
    mainEntity: Object.freeze(
      faqs.map((faq) =>
        Object.freeze({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: Object.freeze({ '@type': 'Answer', text: faq.answer }),
        }),
      ),
    ),
  });
}

export type OrganizationReferenceSchema = {
  readonly '@type': 'Organization';
  readonly name: string;
  readonly url: string;
};

export interface ArticleInput {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly published: string;
  readonly locale: string;
}

export type ArticleSchema = {
  readonly '@type': 'Article';
  readonly headline: string;
  readonly description: string;
  readonly datePublished: string;
  readonly inLanguage: string;
  readonly mainEntityOfPage: string;
  readonly author: OrganizationReferenceSchema;
  readonly publisher: OrganizationReferenceSchema;
};

const HEADLINE_MAX_LENGTH = 110;

const ORGANIZATION_REFERENCE: OrganizationReferenceSchema = Object.freeze({
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
});

function truncateHeadline(title: string): string {
  if (title.length <= HEADLINE_MAX_LENGTH) {
    return title;
  }
  return `${title.slice(0, HEADLINE_MAX_LENGTH - 1)}…`;
}

export function articleSchema(article: ArticleInput): Readonly<JsonLdContext & ArticleSchema> {
  return withContext({
    '@type': 'Article',
    headline: truncateHeadline(article.title),
    description: article.description,
    datePublished: article.published,
    inLanguage: article.locale,
    mainEntityOfPage: `${SITE_URL}/blog/${article.slug}`,
    author: ORGANIZATION_REFERENCE,
    publisher: ORGANIZATION_REFERENCE,
  });
}

export type HreflangLink = {
  readonly rel: 'alternate';
  readonly hreflang: 'fr' | 'en' | 'x-default';
  readonly href: string;
};

function joinCanonical(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return suffix.length === 0 ? base : `${base}/${suffix}`;
}

export function hreflangLinks(
  pathFr: string,
  pathEn: string,
  siteUrl: string = SITE_URL,
): readonly HreflangLink[] {
  const frHref = joinCanonical(siteUrl, pathFr);
  return Object.freeze([
    Object.freeze({ rel: 'alternate', hreflang: 'fr', href: frHref }),
    Object.freeze({ rel: 'alternate', hreflang: 'en', href: joinCanonical(siteUrl, pathEn) }),
    Object.freeze({ rel: 'alternate', hreflang: 'x-default', href: frHref }),
  ] as readonly HreflangLink[]);
}
