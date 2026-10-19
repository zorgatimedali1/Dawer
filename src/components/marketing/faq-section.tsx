import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/hooks/use-t';

const FAQ_INDICES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Landing FAQ: a single elevated card of expandable rows — one answer open at
 * a time, chevron rotation signalling the state. Questions/answers live in
 * the FR/EN landing dictionaries (faqQ1..faqQ6 / faqA1..faqA6).
 */
export function FaqSection() {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="relative scroll-mt-20">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
        <h2 className="text-balance text-center text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
          {t.landing.faqTitle}
        </h2>

        <div className="mt-10 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elevated shadow-card">
          {FAQ_INDICES.map((item, index) => {
            const open = openIndex === index;
            return (
              <div key={item}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`faq-panel-${item}`}
                  onClick={() => setOpenIndex(open ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-[14.5px] font-medium text-ink transition-colors duration-180 ease-swift hover:text-brand-700 dark:hover:text-accent-bright sm:text-[15px]"
                >
                  {t.landing[`faqQ${item}` as keyof typeof t.landing] as string}
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-180 ease-swift',
                      open && 'rotate-180 text-brand-700 dark:text-accent-bright',
                    )}
                  />
                </button>
                {open ? (
                  <div
                    id={`faq-panel-${item}`}
                    className="animate-slide-down px-6 pb-5 text-[13.5px] leading-relaxed text-ink-muted motion-reduce:animate-none"
                  >
                    {t.landing[`faqA${item}` as keyof typeof t.landing] as string}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
