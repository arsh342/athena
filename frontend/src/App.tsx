import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Footer } from './components/Footer';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { PrivacyPolicyPage } from './pages/PrivacyPolicy';
import { QuickstartPage } from './pages/Quickstart';
import { Register } from './pages/Register';
import { ReportPage } from './pages/ReportPage';
import { ScanPage } from './pages/ScanPage';
import { SettingsPage } from './pages/Settings';
import { SitemapPage } from './pages/Sitemap';
import { TermsPage } from './pages/Terms';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  // The sign-in pages are a full-height split: no footer.
  const bare = pathname === '/login' || pathname === '/register';

  return (
    <div className="shell">
      <ScrollToTop />
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/quickstart" element={<QuickstartPage />} />
          <Route path="/sitemap" element={<SitemapPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/reports/:scanId" element={<ReportPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {bare ? null : <Footer />}
    </div>
  );
}
