import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from './app/layout';
import AuthLayout from './app/auth/layout';
import CustomerLayout from './app/customer/layout';
import CustomerRedirect from './app/customer/customer-redirect';
import DashboardLayout from './app/dashboard/layout';
import { RedirectIfAuthenticated, RequireAuth } from './components/route-guards';
import { BrandLoader } from './components/brand/brand-loader';
import './app/globals.css';

const LandingPage = lazy(() => import('./app/page'));
const PrivacyPage = lazy(() => import('./app/privacy/page'));
const LoginPage = lazy(() => import('./app/auth/login/page'));
const RegisterPage = lazy(() => import('./app/auth/register/page'));
const AuthCallbackPage = lazy(() => import('./app/auth/callback/page'));
const ForgotPasswordPage = lazy(() => import('./app/auth/forgot-password/page'));
const ResetPasswordPage = lazy(() => import('./app/auth/reset-password/page'));
const CustomerPage = lazy(() => import('./app/customer/[campaignId]/page'));
const OverviewPage = lazy(() => import('./app/dashboard/overview/page'));
const AnalyticsPage = lazy(() => import('./app/dashboard/analytics/page'));
const BillingPage = lazy(() => import('./app/dashboard/billing/page'));
const CampaignsPage = lazy(() => import('./app/dashboard/campaigns/page'));
const CustomersPage = lazy(() => import('./app/dashboard/customers/page'));
const DemoPage = lazy(() => import('./app/dashboard/demo/page'));
const EmailPage = lazy(() => import('./app/dashboard/email/page'));
const PosterPage = lazy(() => import('./app/dashboard/poster/page'));
const QrCodesPage = lazy(() => import('./app/dashboard/qr-codes/page'));
const RewardsPage = lazy(() => import('./app/dashboard/rewards/page'));
const SettingsPage = lazy(() => import('./app/dashboard/settings/page'));
const WheelPage = lazy(() => import('./app/dashboard/wheel/page'));
const WhatsappPage = lazy(() => import('./app/dashboard/whatsapp/page'));

function App() {
  return (
    <RootLayout>
      <BrowserRouter>
        <Suspense fallback={<BrandLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
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
              <Route path="whatsapp-web" element={<Navigate to="/dashboard/whatsapp?tab=web" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </RootLayout>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
