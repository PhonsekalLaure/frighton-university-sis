import { BookOpen, CalendarDays, CreditCard, GraduationCap, LayoutDashboard, LibraryBig, LogOut, ScrollText, ShieldAlert, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SignedInUser } from '../types/dashboard';

export type PortalView = 'dashboard' | 'schedule' | 'grades' | 'billing' | 'library' | 'holds' | 'profile';

interface AppShellProps { user: SignedInUser; activeView: PortalView; onNavigate: (view: PortalView) => void; onLogout: () => void; children: ReactNode; }

const navigation: Array<{ view: PortalView; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { view: 'schedule', label: 'My schedule', icon: CalendarDays },
  { view: 'grades', label: 'Grades', icon: GraduationCap },
  { view: 'billing', label: 'Billing', icon: CreditCard },
  { view: 'library', label: 'Library', icon: LibraryBig },
  { view: 'holds', label: 'Holds', icon: ShieldAlert },
  { view: 'profile', label: 'Student profile', icon: UserRound },
];

export function AppShell({ user, activeView, onNavigate, onLogout, children }: AppShellProps) {
  return <div className="portal-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="sidebar-mark"><span>F</span></div><div><strong>FRIGHTON</strong><small>STUDENT INFORMATION SYSTEM</small></div></div>
      <p className="nav-label">STUDENT PORTAL</p>
      <nav className="main-nav" aria-label="Student portal">
        {navigation.map(({ view, label, icon: Icon }) => <button key={view} aria-current={activeView === view ? 'page' : undefined} className={activeView === view ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate(view)}><Icon size={18} />{label}</button>)}
      </nav>
      <div className="sidebar-footer"><div className="secure-badge"><ScrollText size={16} /><span><strong>Official SIS record</strong><small>Your academic data is protected.</small></span></div><button className="logout-button" onClick={onLogout}><LogOut size={16} />Sign out</button></div>
    </aside>
    <div className="portal-main">
      <header className="topbar"><div className="topbar-brand"><UniversityMiniMark /> <span>FRIGHTON UNIVERSITY SIS</span></div><div className="topbar-actions"><span className="term-pill"><BookOpen size={15} /> Student portal</span><button type="button" className="user-chip profile-chip" aria-label="Open student profile" onClick={() => onNavigate('profile')}><div className="avatar">{user.fullName?.charAt(0) || 'S'}</div><span>{user.fullName || user.email}</span></button></div></header>
      <main className="page-content">{children}</main>
    </div>
  </div>;
}

function UniversityMiniMark() { return <span className="mini-mark">F</span>; }
