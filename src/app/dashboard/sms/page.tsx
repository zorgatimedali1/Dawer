import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useT } from '@/hooks/use-t';
import SmsBroadcastPanel from './sms-panel';

export default function SmsPage() {
  const t = useT();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.sms.eyebrow}
        title={t.sms.title}
        description={t.sms.description}
        actions={
          <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t.sms.refresh}
          </Button>
        }
      />
      <SmsBroadcastPanel reloadKey={reloadKey} />
    </div>
  );
}
