import { AppProvider } from '@/contexts/app-context';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100">
      <AppProvider>{children}</AppProvider>
    </div>
  );
}
