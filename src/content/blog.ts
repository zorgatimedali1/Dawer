import type { Locale } from '@/lib/i18n';

export type BlogBody = { intro: string; sections: { heading: string; paragraphs: string[] }[] };
export type MultilingualText = { fr: string; en: string };

export type BlogArticle = {
  slug: string;
  published: string;
  readMinutes: number;
  title: MultilingualText;
  metaDescription: MultilingualText;
  body: Record<Exclude<Locale, 'ar'>, BlogBody>;
};

export const blogArticles: readonly BlogArticle[] = [
  {
    slug: 'roue-de-la-fortune-magasin',
    published: '2026-09-12',
    readMinutes: 4,
    title: {
      fr: 'La roue de la fortune en boutique : transformer chaque passage en moment de jeu',
      en: 'The in-store fortune wheel: turning every visit into a playful moment',
    },
    metaDescription: {
      fr: 'Comment une roue de la fortune installée en boutique attire l’attention, recueille des contacts avec le consentement du client et transforme l’attente en caisse en interaction positive.',
      en: 'How a fortune wheel in your shop draws attention, collects contacts with the customer’s consent, and turns checkout waiting time into a positive interaction.',
    },
    body: {
      fr: {
        intro:
          'Installer une roue de la fortune près du comptoir, c’est proposer au client un petit jeu plutôt qu’une simple promotion affichée. La mécanique est connue de tous : on tourne, on découvre un lot et l’on repart avec un souvenir de la visite. Voici comment ce dispositif s’intègre dans le quotidien d’un commerce.',
        sections: [
          {
            heading: 'Un point d’attraction au comptoir',
            paragraphs: [
              'Une roue posée en caisse attire naturellement l’œil, surtout pendant l’attente au moment de payer. Ce temps calme devient une occasion de faire tourner la roue et de vivre une interaction positive avec la boutique.',
              'Le geste de tourner la roue est simple et universel. Il n’exige aucune explication technique et fonctionne aussi bien pour un nouveau client que pour un habitué.',
            ],
          },
          {
            heading: 'Des lots définis par le commerçant',
            paragraphs: [
              'Chaque tour promet quelque chose, même petit : une remise, un geste commercial ou un lot de consolation. Ce « toujours gagnant » évite la frustration et donne raison au client d’avoir joué.',
              'Le commerçant choisit ses lots selon ses marges et ses objectifs. La roue reste un outil souple, au service de l’offre du magasin, jamais l’inverse.',
            ],
          },
          {
            heading: 'Des contacts recueillis avec le consentement',
            paragraphs: [
              'Pour recevoir son gain ou son bon, le client laisse une trace : téléphone ou e-mail, librement donné. L’échange est explicite et préparé par le jeu, ce qui produit une base de contacts de qualité pour la suite.',
            ],
          },
          {
            heading: 'Repérer ce qui fait tourner les têtes',
            paragraphs: [
              'Une campagne en magasin ne s’arrête pas quand le client repart. Les tours de roue, les gains distribués et les contacts laissés se comptent, ce qui permet d’ajuster les lots ou le discours au fil des semaines.',
              'Le jeu devient ainsi un repère concret de la dynamique entre la boutique et ses visiteurs. Il montre ce qui plaît, ce qui attire et ce qui fait revenir.',
            ],
          },
        ],
      },
      en: {
        intro:
          'Placing a fortune wheel next to the counter means offering shoppers a small game instead of yet another printed promotion. The mechanism is familiar to everyone: one spin, a prize to discover, and a memorable moment to take home. Here is how such a device fits into the everyday life of a shop.',
        sections: [
          {
            heading: 'A point of attraction at the counter',
            paragraphs: [
              'A wheel standing at the checkout naturally catches the eye, especially while customers wait to pay. That quiet moment becomes an excuse to spin and to share a positive interaction with the shop.',
              'The spin itself is simple and universal. It needs no technical explanation and works as well for a first-time visitor as for a regular.',
            ],
          },
          {
            heading: 'Prizes defined by the merchant',
            paragraphs: [
              'Every spin promises something, however small: a discount, a commercial gesture or a consolation prize. This “always a winner” spirit avoids frustration and makes the play worthwhile.',
              'The merchant sets the prizes according to margins and goals. The wheel stays a flexible tool serving the shop’s offering, never the other way around.',
            ],
          },
          {
            heading: 'Contacts collected with consent',
            paragraphs: [
              'To receive the prize or the voucher, the customer leaves a detail: a phone number or an email, freely given. The exchange is explicit and framed by the game, which produces a high-quality contact list for later use.',
            ],
          },
          {
            heading: 'Spotting what gets people spinning',
            paragraphs: [
              'An in-store campaign does not end when the customer walks out. Spins, distributed prizes and collected contacts can be counted, week after week, to adjust prizes or messaging.',
              'The game thus becomes a concrete gauge of how the shop and its visitors interact. It shows what works, what draws people in and what brings them back.',
            ],
          },
        ],
      },
    },
  },
  {
    slug: 'acquisition-clients-tunisie',
    published: '2026-09-28',
    readMinutes: 5,
    title: {
      fr: 'Acquisition de clients en Tunisie : partir de ceux qui passent déjà devant votre boutique',
      en: 'Acquiring customers in Tunisia: start with those already passing by your shop',
    },
    metaDescription: {
      fr: 'Des pistes simples et concrètes pour un petit commerce tunisien : exploiter le trafic du comptoir, installer un point QR visible et bâtir une base de contacts réellement exploitable.',
      en: 'Simple, practical paths for a Tunisian small business: make the most of counter traffic, place a visible QR point, and build a contact base you actually use.',
    },
    body: {
      fr: {
        intro:
          'L’acquisition de clients ne commence pas dans une application : elle commence sur le trottoir. Chaque jour, des visiteurs entrent, comparent et repartent, parfois sans achat. Voici comment un petit commerce peut transformer ce flux de passage en base de clients fidèles.',
        sections: [
          {
            heading: 'Votre comptoir est déjà une porte d’entrée',
            paragraphs: [
              'Chaque visiteur qui franchit la porte est une opportunité, et il serait coûteux de la remplacer par une campagne en ligne. Avant de viser de nouveaux publics, il vaut souvent mieux garder une trace des personnes déjà venues.',
              'Un carnet se perd, un numéro noté sans nom ne raconte rien. Recueillir ces informations de façon structurée dès le comptoir change tout : chaque contact devient identifiable, joignable et réutilisable.',
            ],
          },
          {
            heading: 'Le QR code : un pont entre la rue et votre commerce',
            paragraphs: [
              'Placée sur une vitrine ou fixée au comptoir, une plaque QR invite le passant à ouvrir une page d’un seul geste. Le client n’installe rien, le commerçant n’ajoute aucun appareil complexe. Ce code peut mener à un jeu, à une inscription ou à une offre du moment.',
              'Visible en permanence, la plaque QR transforme l’emplacement de la boutique en point de collecte qui travaille même aux heures creuses.',
            ],
          },
          {
            heading: 'Fidéliser coûte moins cher que conquérir',
            paragraphs: [
              'Faire revenir un client satisfait demande en général moins d’effort que d’en convaincre un tout nouveau. Un lot gagné en caisse, une offre envoyée à bon escient ou un simple moment d’attention laissent une empreinte durable.',
              'Dans une boutique de quartier, cette régularité du lien fait souvent la différence. Les habitués ramènent leur voisinage, et le bouche-à-oreille fait le reste.',
            ],
          },
          {
            heading: 'Bâtir une base que l’on sait utiliser',
            paragraphs: [
              'Une liste de contacts ne vaut que par ce qu’on en fait : annoncer une nouveauté, relancer un client discret, remercier les habitués. Chaque commerçant choisit les canaux qu’il maîtrise — e-mail, SMS ou WhatsApp — et respecte leur rythme.',
              'L’essentiel est d’exploiter la base progressivement, sans saturer les boîtes de réception. Une présence régulière et utile vaut mieux qu’un déluge ponctuel.',
            ],
          },
        ],
      },
      en: {
        intro:
          'Customer acquisition does not start inside an app: it starts on the pavement. Every day, visitors walk in, compare and leave, sometimes without buying anything. Here is how a small shop can turn that passing flow into a base of loyal customers.',
        sections: [
          {
            heading: 'Your counter is already a doorway',
            paragraphs: [
              'Every visitor who walks through the door is an opportunity, and replacing them with an online campaign gets expensive fast. Before reaching for new audiences, it is usually wiser to keep a trace of the people who already came by.',
              'A paper log gets lost, a phone number written without a name tells you nothing. Capturing details in a structured way right at the counter changes everything: every contact becomes identifiable, reachable and ready to be used.',
            ],
          },
          {
            heading: 'The QR code: a bridge between the street and your shop',
            paragraphs: [
              'Placed on a window or fixed to the counter, a QR plate invites a passer-by to open a page with a single gesture. The customer installs nothing, the merchant adds no complex device. The code can lead to a game, a sign-up or a current offer.',
              'Visible at all times, the QR plate turns the shop’s location into a collection point that keeps working even during quiet hours.',
            ],
          },
          {
            heading: 'Keeping customers costs less than winning them',
            paragraphs: [
              'Bringing back a satisfied customer usually takes less effort than convincing a brand-new one. A prize won at the till, an offer sent at the right moment or a simple note of attention leaves a lasting mark.',
              'In a neighbourhood shop, that steady relationship often makes the difference. Regulars bring their neighbours along, and word of mouth does the rest.',
            ],
          },
          {
            heading: 'Build a base you actually use',
            paragraphs: [
              'A contact list is worth whatever you do with it: announcing something new, nudging a quiet customer, thanking the regulars. Each merchant picks the channels they master — email, SMS or WhatsApp — and respects their rhythms.',
              'The point is to make use of the base progressively, without flooding inboxes. A steady, useful presence beats an occasional flood.',
            ],
          },
        ],
      },
    },
  },
  {
    slug: 'whatsapp-marketing-commercants',
    published: '2026-10-14',
    readMinutes: 4,
    title: {
      fr: 'WhatsApp marketing pour commerçants : parler à vos clients là où ils lisent déjà',
      en: 'WhatsApp marketing for merchants: talk to your customers where they already read',
    },
    metaDescription: {
      fr: 'Pourquoi WhatsApp est un canal de proximité naturel pour un commerce de quartier, et comment mener des campagnes utiles sans saturer vos clients.',
      en: 'Why WhatsApp is a natural proximity channel for a neighbourhood shop, and how to run useful campaigns without overwhelming your customers.',
    },
    body: {
      fr: {
        intro:
          'WhatsApp n’est plus seulement une application de famille : c’est devenu un réflexe pour des milliers de commerces. Un message envoyé sur ce canal arrive dans une application que le client ouvre chaque jour. Cette présence naturelle explique l’intérêt des commerçants pour ce média.',
        sections: [
          {
            heading: 'Un canal déjà dans la poche de vos clients',
            paragraphs: [
              'Pour de nombreux foyers, WhatsApp est devenu un moyen de contact quotidien, autant avec la famille qu’avec les commerces. La barrière de l’inconnu n’existe pas : vos clients savent déjà s’en servir.',
              'Ce caractère familier en fait un canal de proximité avant tout. On y parle simplement, au nom de la boutique, sans jargon ni langue de bois.',
            ],
          },
          {
            heading: 'Un message utile plutôt qu’un flot de messages',
            paragraphs: [
              'Les messages qui marquent restent courts, clairs et utiles : une arrivée de nouveautés, une offre du jour, un rappel avant une date clé. Un client qui se sent considéré personnellement reste bien plus réceptif qu’un destinataire d’un envoi de masse.',
              'La qualité de la liste compte davantage que la quantité : des contacts consentants, à jour et bien ciblés. Un envoi bien préparé fatigue moins le client et s’accorde mieux à l’activité du magasin.',
            ],
          },
          {
            heading: 'Des campagnes à l’échelle d’une boutique',
            paragraphs: [
              'Un commerçant n’écrit pas à des millions de personnes : il écrit à sa communauté. Les campagnes se préparent en amont avec des outils dédiés, qui encadrent les volumes et les modèles de message.',
              'Ce cadre remplace le bricolage à partir d’un simple téléphone professionnel. Il laisse le temps au commerçant de soigner l’essentiel : trouver les mots qui donnent envie de revenir en boutique.',
            ],
          },
          {
            heading: 'Observer, puis ajuster',
            paragraphs: [
              'Comme toute action commerciale, une campagne WhatsApp mérite d’être observée dans le temps : quels jours d’envoi obtiennent le meilleur retour, quels formats sont relus, quelle cadence ne lasse pas vos clients.',
              'Ces repères permettent d’ajuster l’envoi suivant plutôt que de recommencer le précédent. Au fil des campagnes, le commerçant affine ce qui parle vraiment à sa clientèle.',
            ],
          },
        ],
      },
      en: {
        intro:
          'WhatsApp is no longer just a family app: it has become a reflex for thousands of shops. A message on this channel lands inside an application the customer opens every day. That familiar presence explains why merchants keep turning to it.',
        sections: [
          {
            heading: 'A channel already in your customers’ pockets',
            paragraphs: [
              'In many households, WhatsApp has become a daily means of contact, as much with family as with shops. There is no novelty barrier: your customers already know how to use it.',
              'That familiarity makes it a proximity channel first and foremost. You speak simply, in the shop’s name, without jargon or empty wording.',
            ],
          },
          {
            heading: 'A useful message rather than a stream of messages',
            paragraphs: [
              'Messages that stick stay short, clear and useful: a new arrival, today’s offer, a reminder before a key date. A customer who feels personally considered stays far more receptive than the recipient of a mass blast.',
              'The quality of the list matters more than its size: consenting, up-to-date and well-segmented contacts. A well-prepared send fatigues the customer less and connects better with the shop’s activity.',
            ],
          },
          {
            heading: 'Campaigns at the scale of a shop',
            paragraphs: [
              'A merchant does not write to millions of people: they write to their own community. Campaigns are prepared beforehand with dedicated tools that frame volumes and message templates.',
              'That framework replaces improvising from a single professional phone. It leaves the merchant time to look after what matters: finding the words that make people want to come back to the shop.',
            ],
          },
          {
            heading: 'Look, then adjust',
            paragraphs: [
              'Like any commercial action, a WhatsApp campaign deserves to be observed over time: which sending days get the best response, which formats get re-read, which pace never wears thin.',
              'Those markers help adjust the next send instead of repeating the previous one. Campaign after campaign, the merchant refines what truly speaks to their audience.',
            ],
          },
        ],
      },
    },
  },
];

export function getArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find((article) => article.slug === slug);
}

const EXCERPT_MAX_LENGTH = 180;

function bodyForLocale(article: BlogArticle, locale: Locale): BlogBody {
  return locale === 'en' ? article.body.en : article.body.fr;
}

export function blogExcerpt(article: BlogArticle, locale: Locale): string {
  const intro = bodyForLocale(article, locale).intro;
  if (intro.length <= EXCERPT_MAX_LENGTH) return intro;
  const cut = intro.slice(0, EXCERPT_MAX_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}
