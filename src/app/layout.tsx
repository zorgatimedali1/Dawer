import { AppProvider } from '@/contexts/app-context';
import { ToastProvider } from '@/components/ui/toast';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <ToastProvider>
        <div className="min-h-screen bg-surface font-sans text-ink antialiased">{children}</div>
      </ToastProvider>
    </AppProvider>
  );
}