import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { DEMO_VIDEO_EMBED_URL } from '@/lib/demo-video';
import { useT } from '@/hooks/use-t';

/**
 * First-stop page for read-only trial users: instead of landing on Billing
 * straight away, they watch the product demo, with a single CTA to the plans.
 */
export default function DemoPage() {
  const t = useT();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.demoPage.eyebrow}
        title={t.demoPage.title}
        description={t.demoPage.description}
      />

      <Card className="p-4 sm:p-6">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-elevated shadow-card">
          <iframe
            className="absolute inset-0 h-full w-full border-0"
            src={DEMO_VIDEO_EMBED_URL}
            title={t.landing.demoVideoTitle}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">{t.demoPage.hint}</p>

        <div className="mt-4">
          <Button asChild>
            <Link to="/dashboard/billing">{t.demoPage.openPlans}</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
