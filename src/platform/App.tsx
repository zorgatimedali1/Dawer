import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  OperatorProvider,
  RedirectIfOperator,
  RequireOperator,
} from './auth/operator-context';
import { BrandLoader } from '@/components/brand/brand-loader';
import PlatformLayout from './app/layout';

const LoginPage = lazy(() => import('./pages/login/page'));
const DashboardPage = lazy(() => import('./pages/dashboard/page'));
const AnalyticsPage = lazy(() => import('./pages/analytics/page'));
const AccountsPage = lazy(() => import('./pages/accounts/page'));
const SubscriptionsPage = lazy(() => import('./pages/subscriptions/page'));
const PartnersPage = lazy(() => import('./pages/partners/page'));
const PlansPage = lazy(() => import('./pages/plans/page'));
const PasswordPage = lazy(() => import('./pages/password/page'));

export default function PlatformApp() {
  return (
    <OperatorProvider>
      <BrowserRouter>
        <Suspense fallback={<BrandLoader />}>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfOperator>
                  <LoginPage />
                </RedirectIfOperator>
              }
            />
            <Route
              path="/"
              element={
                <RequireOperator>
                  <PlatformLayout />
                </RequireOperator>
              }
            >
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="subscriptions" element={<SubscriptionsPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="partners" element={<PartnersPage />} />
              <Route path="password" element={<PasswordPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </OperatorProvider>
  );
}
