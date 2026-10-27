import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AppShell, type PortalView } from './components/AppShell';
import { apiGet, apiPost } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SchedulePage } from './pages/SchedulePage';
import { GradesPage } from './pages/GradesPage';
import { BillingPage } from './pages/BillingPage';
import { HoldsPage } from './pages/HoldsPage';
import { LibraryPage } from './pages/LibraryPage';
import { AdminConsolePage } from './pages/AdminConsolePage';
import { SetPasswordPage, capturePasswordLink } from './pages/SetPasswordPage';
import type { SignedInUser } from './types/dashboard';
import './App.css';

function viewFromPath(): PortalView { const value = window.location.pathname.split('/')[1]; return value === 'schedule' || value === 'grades' || value === 'billing' || value === 'library' || value === 'holds' ? value : 'dashboard'; }
export function App() { const [user, setUser] = useState<SignedInUser | null>(null); const [checkingSession, setCheckingSession] = useState(true); const [activeView, setActiveView] = useState<PortalView>(viewFromPath); const [route, setRoute] = useState(window.location.pathname + window.location.search); const [passwordLink] = useState(() => window.location.pathname === '/set-password' ? capturePasswordLink() : null); useEffect(() => { apiGet<{ user: SignedInUser }>('/api/auth/me').then(data => setUser(data.user)).catch(() => undefined).finally(() => setCheckingSession(false)); }, []); useEffect(() => { const handlePopState = () => { setActiveView(viewFromPath()); setRoute(window.location.pathname + window.location.search); }; window.addEventListener('popstate', handlePopState); return () => window.removeEventListener('popstate', handlePopState); }, []); function navigate(view: PortalView) { const path = view === 'dashboard' ? '/dashboard' : `/${view}`; window.history.pushState({}, '', path); setActiveView(view); setRoute(path); } function navigatePath(path: string) { window.history.pushState({}, '', path); setRoute(path); } async function logout() { await apiPost('/api/auth/logout', {}).catch(() => undefined); setUser(null); navigatePath('/login'); } if (route.startsWith('/set-password')) return <SetPasswordPage link={passwordLink} onComplete={() => { setUser(null); navigatePath('/login'); }} />; if (checkingSession) return <div className="boot-screen">Loading Frighton SIS…</div>; if (!user) return <LoginPage onSignedIn={signedInUser => { setUser(signedInUser); navigatePath(signedInUser.role === 'admin' ? '/admin' : '/dashboard'); }} />; if (route.startsWith('/admin') && user.role !== 'admin') return <main className="admin-handoff-page"><section className="admin-handoff-card"><div className="admin-handoff-icon"><ShieldCheck size={31} /></div><p className="eyebrow">ACCESS DENIED</p><h1>Administrator access required.</h1><p className="supporting-copy">This area is only available to active administrator accounts.</p><button className="logout-button" onClick={() => navigatePath('/dashboard')}>Return to student portal</button></section></main>; if (user.role === 'admin') return <AdminConsolePage user={user} onLogout={logout} path={route} navigate={navigatePath} />; return <AppShell user={user} activeView={activeView} onNavigate={navigate} onLogout={logout}>{activeView === 'dashboard' && <DashboardPage onNavigate={navigate} />}{activeView === 'schedule' && <SchedulePage />}{activeView === 'grades' && <GradesPage />}{activeView === 'billing' && <BillingPage />}{activeView === 'library' && <LibraryPage />}{activeView === 'holds' && <HoldsPage onNavigate={navigate} />}</AppShell>; }
export default App;
