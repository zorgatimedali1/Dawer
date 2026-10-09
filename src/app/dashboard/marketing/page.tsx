'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/hooks/use-t';

const campaigns = [
  {
    name: 'Summer Splash',
    channel: 'Email + QR',
    status: 'Running',
    reach: '12.8k',
    roi: '4.7x',
  },
  {
    name: 'Referral Rush',
    channel: 'Social',
    status: 'Draft',
    reach: '7.4k',
    roi: '3.1x',
  },
  {
    name: 'VIP Rewards',
    channel: 'In-store',
    status: 'Scheduled',
    reach: '9.1k',
    roi: '5.4x',
  },
];

export default function MarketingPage() {
  const t = useT();

  const CHANNEL_LABELS: Record<string, string> = {
    'Email + QR': t.marketing.channelEmailQr,
    Social: t.marketing.channelSocial,
    'In-store': t.marketing.channelInStore,
  };

  const STATUS_LABELS: Record<string, string> = {
    Running: t.marketing.statusRunning,
    Draft: t.marketing.statusDraft,
    Scheduled: t.marketing.statusScheduled,
  };

  const contentIdeas = [
    t.marketing.ideaTestimonials,
    t.marketing.ideaFlashSale,
    t.marketing.ideaLoyalty,
    t.marketing.ideaReferral,
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.marketing.eyebrow}
        title={t.marketing.title}
        description={t.marketing.description}
        actions={<Button size="sm">{t.marketing.createCampaign}</Button>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {campaigns.map((campaign) => (
          <Card key={campaign.name}>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <CardTitle className="text-[15px]">{campaign.name}</CardTitle>
              <Badge tone={campaign.status === 'Running' ? 'success' : campaign.status === 'Draft' ? 'warning' : 'info'} size="sm" dot>
                {STATUS_LABELS[campaign.status] ?? campaign.status}
              </Badge>
            </CardHeader>
            <CardContent>
              <p className="text-[13px] text-ink-subtle">{CHANNEL_LABELS[campaign.channel] ?? campaign.channel}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-surface-2/60 p-3">
                  <p className="text-[12px] text-ink-subtle">{t.marketing.reach}</p>
                  <p className="numeric mt-1 text-[15px] font-semibold text-ink">{campaign.reach}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2/60 p-3">
                  <p className="text-[12px] text-ink-subtle">{t.marketing.roi}</p>
                  <p className="numeric mt-1 text-[15px] font-semibold text-ink">{campaign.roi}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">{t.marketing.contentIdeas}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {contentIdeas.map((idea) => (
              <div
                key={idea}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3 text-[13.5px] text-ink transition-colors duration-180 hover:border-accent/40"
              >
                <span>{idea}</span>
                <Button variant="link" size="xs">
                  {t.marketing.view}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">{t.marketing.quickStats}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-xl border border-accent/30 bg-accent-soft/60 p-4 dark:border-accent/25 dark:bg-accent-soft">
              <p className="text-[13px] font-medium text-brand-800 dark:text-accent-bright">{t.marketing.avgCtr}</p>
              <p className="numeric mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">8.4%</p>
            </div>
            <div className="rounded-xl border border-success-300/60 bg-success-50 p-4 dark:border-success-900/60 dark:bg-success-900/25">
              <p className="text-[13px] font-medium text-success-800 dark:text-success-200">{t.marketing.conversionLift}</p>
              <p className="numeric mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">+27%</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
