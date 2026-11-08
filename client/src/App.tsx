import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AppShell, type PortalView } from './components/AppShell';
import { ErrorState } from './components/PageStates';
import { apiGet, apiPost, onSessionExpired, resetSessionRequests, type ApiFailure } from './lib/api';
import { clearPasswordLink, type PasswordLink } from './lib/passwordLink';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SchedulePage } from './pages/SchedulePage';
import { GradesPage } from './pages/GradesPage';
import { BillingPage } from './pages/BillingPage';
import { HoldsPage } from './pages/HoldsPage';
import { LibraryPage } from './pages/LibraryPage';
import { AdminConsolePage } from './pages/AdminConsolePage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import type { SignedInUser } from './types/dashboard';
import './App.css';

const currentRoute = () => window.location.pathname + window.location.search;
function routeForUser(route: string, user: SignedInUser | null) {
  const pathname = route.split('?')[0];
  if (user?.role === 'admin' && !/^\/admin(?:\/|$)/.test(pathname)) return '/admin';
  if (user?.role === 'student' && (pathname === '/' || pathname === '/login')) return '/dashboard';
  return route;
}
function viewFromPath(route: string): PortalView {
  const value = route.split('?')[0].split('/')[1];
  return value === 'schedule' || value === 'grades' || value === 'billing' || value === 'library' || value === 'holds' ? value : 'dashboard';
}

export function App({ initialPasswordLink = null }: { initialPasswordLink?: PasswordLink | null }) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [route, setRoute] = useState(currentRoute);
  const [passwordLink, setPasswordLink] = useState(initialPasswordLink);
  const [startedWithPassword] = useState(() => window.location.pathname === '/set-password');
  const [session, setSession] = useState<{ checking: boolean; error?: ApiFailure }>({ checking: true });
  const [attempt, setAttempt] = useState(0);
  const passwordRoute = route.split('?')[0] === '/set-password';
  const activeView = viewFromPath(route);
  const pageTitle = passwordRoute ? 'Password setup' : !user ? 'Sign in' : user.role === 'admin' ? 'Administrator console' : ({ dashboard: 'Overview', schedule: 'My schedule', grades: 'Grades', billing: 'Billing', library: 'Library', holds: 'Holds' })[activeView];
  useEffect(() => { document.title = `${pageTitle} | Frighton University SIS`; }, [pageTitle]);

  useEffect(() => {
    const pop = () => {
      clearPasswordLink(initialPasswordLink); setPasswordLink(null);
      const raw = currentRoute();
      const next = raw.split('?')[0] === '/set-password' ? raw : routeForUser(raw, user);
      if (next !== raw) window.history.replaceState({}, '', next);
      setRoute(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [initialPasswordLink, user]);
  useEffect(() => onSessionExpired(() => {
    setUser(null);
    setSession({ checking: false });
    window.history.replaceState({}, '', '/login');
    setRoute('/login');
  }), []);
  useEffect(() => {
    if (passwordRoute || startedWithPassword) return;
    const controller = new AbortController();
    apiGet<{ user: SignedInUser }>('/api/auth/me', controller.signal).then(
      data => {
        if (!controller.signal.aborted) {
          const raw = currentRoute(), next = routeForUser(raw, data.user);
          if (next !== raw) { window.history.replaceState({}, '', next); setRoute(next); }
          setUser(data.user); setSession({ checking: false });
        }
      },
      (error: ApiFailure) => {
        if (!controller.signal.aborted) {
          setUser(null);
          setSession(error.status === 401 ? { checking: false } : { checking: false, error });
        }
      },
    );
    return () => controller.abort();
  }, [attempt, passwordRoute, startedWithPassword]);

  function navigatePath(path: string) {
    if (path !== currentRoute()) window.history.pushState({}, '', path);
    setRoute(path);
  }
  function navigate(view: PortalView) { navigatePath('/' + view); }
  function finishPassword() {
    clearPasswordLink(passwordLink);
    setPasswordLink(null);
    setUser(null);
    resetSessionRequests();
    setSession({ checking: false });
    navigatePath('/login');
  }
  async function logout() {
    resetSessionRequests();
    setUser(null);
    setSession({ checking: true });
    navigatePath('/login');
    await apiPost('/api/auth/logout', {}).catch(() => undefined);
    setSession({ checking: false });
  }

  if (passwordRoute) return <SetPasswordPage link={passwordLink} onClearLink={() => { clearPasswordLink(passwordLink); setPasswordLink(null); setUser(null); resetSessionRequests(); }} onComplete={finishPassword} />;
  if (session.checking) return <div className="boot-screen">Loading Frighton SIS…</div>;
  if (session.error) return <main className="login-page"><ErrorState message={session.error.message} forbidden={session.error.status === 403} onRetry={() => { setSession({ checking: true }); setAttempt(value => value + 1); }} /></main>;
  if (!user) return <LoginPage onSignedIn={signedInUser => {
    resetSessionRequests();
    setUser(signedInUser);
    setSession({ checking: false });
    navigatePath(signedInUser.role === 'admin' ? '/admin' : '/dashboard');
  }} />;
  if (route.split('?')[0].startsWith('/admin') && user.role !== 'admin') return <main className="admin-handoff-page"><section className="admin-handoff-card"><ShieldCheck size={31} /><p className="eyebrow">ACCESS DENIED</p><h1>Administrator access required.</h1><p className="supporting-copy">This area is only available to active administrator accounts.</p><button className="logout-button" onClick={() => navigatePath('/dashboard')}>Return to student portal</button><button className="logout-button" onClick={logout}>Sign out</button></section></main>;
  if (user.role === 'admin') return <AdminConsolePage user={user} onLogout={logout} path={route} navigate={navigatePath} />;
  return <AppShell user={user} activeView={activeView} onNavigate={navigate} onLogout={logout}>
    {activeView === 'dashboard' && <DashboardPage onNavigate={navigate} />}
    {activeView === 'schedule' && <SchedulePage />}
    {activeView === 'grades' && <GradesPage />}
    {activeView === 'billing' && <BillingPage />}
    {activeView === 'library' && <LibraryPage onNavigate={navigate} />}
    {activeView === 'holds' && <HoldsPage onNavigate={navigate} />}
  </AppShell>;
}
export default App;
