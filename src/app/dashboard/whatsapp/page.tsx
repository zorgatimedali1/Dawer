import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useT } from '@/hooks/use-t';
import CloudBroadcastPanel from './cloud-panel';
import WebBroadcastPanel from './web-panel';

type TabKey = 'cloud' | 'web';

export default function WhatsAppPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'web' ? 'web' : 'cloud';
  const [reloadKey, setReloadKey] = useState(0);

  const switchTab = useCallback(
    (next: string) => {
      if ((next === 'web' ? 'web' : 'cloud') === tab) return;
      setSearchParams(next === 'web' ? { tab: 'web' } : {}, { replace: true });
    },
    [setSearchParams, tab],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={tab === 'web' ? t.webBroadcast.eyebrow : t.whatsapp.eyebrow}
        title={tab === 'web' ? t.webBroadcast.title : t.whatsapp.title}
        description={tab === 'web' ? t.webBroadcast.description : t.whatsapp.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t.whatsapp.refresh}
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={switchTab}
        items={[
          { value: 'cloud', label: t.whatsapp.tabCloud },
          { value: 'web', label: t.whatsapp.tabWeb },
        ]}
        aria-label={t.whatsapp.tabsLabel}
        idPrefix="wa-channel"
      />

      <TabPanel value="cloud" active={tab} idPrefix="wa-channel">
        <CloudBroadcastPanel reloadKey={reloadKey} />
      </TabPanel>
      <TabPanel value="web" active={tab} idPrefix="wa-channel">
        <WebBroadcastPanel reloadKey={reloadKey} />
      </TabPanel>
    </div>
  );
}
