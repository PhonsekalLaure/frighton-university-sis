import { useEffect, useState } from 'react';
import { AppShell, type PortalView } from './components/AppShell';
import { apiGet, apiPost } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SchedulePage } from './pages/SchedulePage';
import { GradesPage } from './pages/GradesPage';
import { BillingPage } from './pages/BillingPage';
import type { SignedInUser } from './types/dashboard';
import './App.css';

function viewFromPath(): PortalView { const value = window.location.pathname.split('/')[1]; return value === 'schedule' || value === 'grades' || value === 'billing' ? value : 'dashboard'; }

export function App() {
  const [user, setUser] = useState<SignedInUser | null>(null); const [checkingSession, setCheckingSession] = useState(true); const [activeView, setActiveView] = useState<PortalView>(viewFromPath);
  useEffect(() => { apiGet<{ user: SignedInUser }>('/api/auth/me').then(data => setUser(data.user)).catch(() => undefined).finally(() => setCheckingSession(false)); }, []);
  function navigate(view: PortalView) { window.history.pushState({}, '', view === 'dashboard' ? '/dashboard' : `/${view}`); setActiveView(view); }
  async function logout() { await apiPost('/api/auth/logout', {}).catch(() => undefined); setUser(null); navigate('dashboard'); }
  if (checkingSession) return <div className="boot-screen">Loading Frighton SIS…</div>;
  if (!user) return <LoginPage onSignedIn={signedInUser => { setUser(signedInUser); navigate('dashboard'); }} />;
  return <AppShell user={user} activeView={activeView} onNavigate={navigate} onLogout={logout}>{activeView === 'dashboard' && <DashboardPage onNavigate={navigate} />}{activeView === 'schedule' && <SchedulePage />}{activeView === 'grades' && <GradesPage />}{activeView === 'billing' && <BillingPage />}</AppShell>;
}

export default App;
