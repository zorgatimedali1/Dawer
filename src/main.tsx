import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from './app/layout';
import AuthLayout from './app/auth/layout';
import CustomerLayout from './app/customer/layout';
import CustomerRedirect from './app/customer/customer-redirect';
import DashboardLayout from './app/dashboard/layout';
import { LandingGate, RedirectIfAuthenticated, RequireAuth } from './components/route-guards';
import { RouteBoundary } from './components/route-error-boundary';
import { LocaleSync } from './contexts/app-context';
import { VisitBeacon } from './components/visit-beacon';
import { BrandLoader } from './components/brand/brand-loader';
import { lazyWithRecovery } from './lib/lazy-recovery';
import { initWebMcp } from './lib/webmcp';
import './app/globals.css';

// A refresh must always land at the top of the page; the browser's default
// scroll restoration instead re-applies the previous visit's scroll offset.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

// Fire-and-forget: only loads the SDK chunk when a DSN was baked in at build
// time, so unconfigured builds ship no Sentry bytes at all.
if (import.meta.env.VITE_SENTRY_DSN) {
  void import('./lib/sentry.client').then((m) => m.initSentry('merchant'));
}

// WebMCP: register the public site tools for in-browser AI agents (no-op when
// the browser does not ship the document.modelContext API). These tools only
// read public marketing data, so registering them on any SPA page is safe.
initWebMcp();

// lazyWithRecovery: a tab that outlived a deploy references content-hashed
// chunks that no longer exist; instead of a dead error page on the next menu
// click, the page reloads once and picks up the current build.
const LandingPage = lazyWithRecovery(() => import('./app/page'));
const PrivacyPage = lazyWithRecovery(() => import('./app/privacy/page'));
const BlogListPage = lazyWithRecovery(() => import('./app/blog/page'));
const BlogArticlePage = lazyWithRecovery(() => import('./app/blog/[slug]/page'));
const LoginPage = lazyWithRecovery(() => import('./app/auth/login/page'));
const RegisterPage = lazyWithRecovery(() => import('./app/auth/register/page'));
const AuthCallbackPage = lazyWithRecovery(() => import('./app/auth/callback/page'));
const ForgotPasswordPage = lazyWithRecovery(() => import('./app/auth/forgot-password/page'));
const ResetPasswordPage = lazyWithRecovery(() => import('./app/auth/reset-password/page'));
const CustomerPage = lazyWithRecovery(() => import('./app/customer/[campaignId]/page'));
const OverviewPage = lazyWithRecovery(() => import('./app/dashboard/overview/page'));
const AnalyticsPage = lazyWithRecovery(() => import('./app/dashboard/analytics/page'));
const BillingPage = lazyWithRecovery(() => import('./app/dashboard/billing/page'));
const CampaignsPage = lazyWithRecovery(() => import('./app/dashboard/campaigns/page'));
const CouponsPage = lazyWithRecovery(() => import('./app/dashboard/coupons/page'));
const CustomersPage = lazyWithRecovery(() => import('./app/dashboard/customers/page'));
const DemoPage = lazyWithRecovery(() => import('./app/dashboard/demo/page'));
const EmailPage = lazyWithRecovery(() => import('./app/dashboard/email/page'));
const PosterPage = lazyWithRecovery(() => import('./app/dashboard/poster/page'));
const QrCodesPage = lazyWithRecovery(() => import('./app/dashboard/qr-codes/page'));
const RewardsPage = lazyWithRecovery(() => import('./app/dashboard/rewards/page'));
const SettingsPage = lazyWithRecovery(() => import('./app/dashboard/settings/page'));
const WheelPage = lazyWithRecovery(() => import('./app/dashboard/wheel/page'));
const WhatsappPage = lazyWithRecovery(() => import('./app/dashboard/whatsapp/page'));
const SmsPage = lazyWithRecovery(() => import('./app/dashboard/sms/page'));

function App() {
  return (
    <RootLayout>
        <BrowserRouter>
        <RouteBoundary>
          <LocaleSync />
          <VisitBeacon />
          <Suspense fallback={<BrandLoader />}>
          <Routes>
            <Route path="/" element={<LandingGate><LandingPage /></LandingGate>} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/blog" element={<BlogListPage />} />
            <Route path="/blog/:slug" element={<BlogArticlePage />} />
            <Route path="/en" element={<LandingGate><LandingPage /></LandingGate>} />
            <Route path="/en/privacy" element={<PrivacyPage />} />
            <Route path="/en/blog" element={<BlogListPage />} />
            <Route path="/en/blog/:slug" element={<BlogArticlePage />} />
            <Route path="/auth" element={<RedirectIfAuthenticated><AuthLayout /></RedirectIfAuthenticated>}>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="callback" element={<AuthCallbackPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
            </Route>
            <Route path="/wheels" element={<CustomerLayout />}>
              <Route path=":campaignId" element={<CustomerPage />} />
            </Route>
            <Route path="/customer" element={<CustomerLayout />}>
              <Route path=":campaignId" element={<CustomerRedirect />} />
            </Route>
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <DashboardLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="coupons" element={<CouponsPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="demo" element={<DemoPage />} />
              <Route path="email" element={<EmailPage />} />
              <Route path="poster" element={<PosterPage />} />
              <Route path="pricing" element={<Navigate to="/dashboard/billing" replace />} />
              <Route path="qr-codes" element={<QrCodesPage />} />
              <Route path="rewards" element={<RewardsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="wheel" element={<WheelPage />} />
              <Route path="whatsapp" element={<WhatsappPage />} />
              <Route path="sms" element={<SmsPage />} />
              <Route path="whatsapp-web" element={<Navigate to="/dashboard/whatsapp?tab=web" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </RouteBoundary>
      </BrowserRouter>
    </RootLayout>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
