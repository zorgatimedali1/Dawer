import { useState } from 'react';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { useT } from '@/hooks/use-t';

/**
 * dawer's public contact coordinates — EDIT THESE VALUES here in one place
 * (they are deliberately NOT translated or stored in the database).
 */
const CONTACT_PHONE = '+216 26 788 255';
const CONTACT_ADDRESS = 'Sousse, Tunisie';
export const CONTACT_EMAIL = 'mhoudou78@gmail.com';
const MAP_EMBED_SRC = 'https://www.google.com/maps?q=Sousse%20Centre%2C%20Tunisie&z=13&output=embed';

/**
 * Contact block: four info cards, a message form (mailto pre-fill for the v1:
 * the visitor's own mail client opens with the fields ready to send) and a
 * Google Maps embed. Needs no backend; swap handleSubmit for a real
 * POST /api/public/contact when lead storage ships.
 */
export function ContactSection() {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const infoCards = [
    {
      icon: Phone,
      label: t.landing.contactPhoneLabel,
      value: CONTACT_PHONE,
      href: `tel:${CONTACT_PHONE.replace(/\s/g, '')}`,
    },
    { icon: MapPin, label: t.landing.contactAddressLabel, value: CONTACT_ADDRESS, href: null },
    { icon: Clock, label: t.landing.contactHoursLabel, value: t.landing.contactHoursValue, href: null },
    {
      icon: Mail,
      label: t.landing.contactEmailLabel,
      value: CONTACT_EMAIL,
      href: `mailto:${CONTACT_EMAIL}`,
    },
  ];

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mailSubject = subject.trim() || t.landing.formTitle;
    const mailBody = `${message.trim()}\n\n— ${name.trim()} (${email.trim()})`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;
  };

  return (
    <section id="contact" className="relative border-y border-line bg-surface-2 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-accent-bright">
            {t.landing.contactEyebrow}
          </p>
          <h2 className="mt-3 text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
            {t.landing.contactTitle}
          </h2>
          <p className="mt-4 text-pretty text-[13.5px] leading-relaxed text-ink-muted">
            {t.landing.contactSubtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {infoCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-line bg-elevated p-6 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-brand-700 dark:text-accent-bright">
                <card.icon aria-hidden className="h-5 w-5" />
              </span>
              <p className="mt-4 text-[15px] font-semibold text-ink">{card.label}</p>
              {card.href ? (
                <a
                  href={card.href}
                  className="mt-1 block text-[13.5px] leading-relaxed text-ink-muted transition-colors duration-180 ease-swift hover:text-ink"
                >
                  {card.value}
                </a>
              ) : (
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{card.value}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <h3 className="text-balance text-[22px] font-semibold tracking-[-0.02em] text-ink">
              {t.landing.formTitle}
            </h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="contact-name" className="block text-[13px] font-medium text-ink">
                  {t.landing.formName} <span aria-hidden className="text-danger-500">*</span>
                </label>
                <Input
                  id="contact-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.landing.formNamePlaceholder}
                  className="mt-1.5"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-[13px] font-medium text-ink">
                  {t.landing.formEmailLabel} <span aria-hidden className="text-danger-500">*</span>
                </label>
                <Input
                  id="contact-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t.landing.formEmailPlaceholder}
                  className="mt-1.5"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="contact-subject" className="block text-[13px] font-medium text-ink">
                  {t.landing.formSubjectLabel} <span aria-hidden className="text-danger-500">*</span>
                </label>
                <Input
                  id="contact-subject"
                  required
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder={t.landing.formSubjectPlaceholder}
                  className="mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="contact-message" className="block text-[13px] font-medium text-ink">
                  {t.landing.formMessageLabel} <span aria-hidden className="text-danger-500">*</span>
                </label>
                <Textarea
                  id="contact-message"
                  required
                  rows={5}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t.landing.formMessagePlaceholder}
                  className="mt-1.5"
                />
              </div>
              <Button type="submit" size="lg" className="w-full">
                {t.landing.formSubmit}
              </Button>
            </form>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-line bg-elevated shadow-card">
            <iframe
              className="absolute inset-0 h-full min-h-[360px] w-full border-0"
              src={MAP_EMBED_SRC}
              title={t.landing.mapTitle}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
}
