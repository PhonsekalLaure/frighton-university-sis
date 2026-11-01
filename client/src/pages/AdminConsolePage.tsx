import { Activity, CheckCircle2, ChevronRight, FileText, LayoutDashboard, LogOut, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApiRead } from '../lib/useApiRead';
import { calendarDate, timestamp } from '../lib/format';
import type { SignedInUser } from '../types/dashboard';
import type { AdminDashboard } from '../types/admin';
import { LoadingState } from '../components/PageStates';
import { AdminPageHeading, Failure } from '../components/admin/shared';
import { actionLabels, initials } from '../lib/adminConstants';
import { Students } from '../components/admin/Students';
import { StudentDetail } from '../components/admin/StudentDetail';
import { AuditLogs } from '../components/admin/AuditLogs';

function AdminLayout({ user, page, navigate, onLogout, children }: {
  user: SignedInUser; page: string; navigate: (path: string) => void; onLogout: () => void; children: ReactNode;
}) {
  return <div className="admin-shell"><aside className="admin-sidebar"><div className="sidebar-brand"><div className="sidebar-mark">F</div><div><strong>FRIGHTON</strong><small>ADMINISTRATION</small></div></div><p className="nav-label">WORKSPACE</p>
    <nav className="main-nav" aria-label="Administrator console">
      <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('/admin')}><LayoutDashboard size={17} />Dashboard</button>
      <button className={`nav-item ${page === 'students' || page === 'detail' ? 'active' : ''}`} onClick={() => navigate('/admin/students')}><Users size={17} />Student accounts</button>
      <button className={`nav-item ${page === 'audit' ? 'active' : ''}`} onClick={() => navigate('/admin/audit-logs')}><Activity size={17} />Audit log</button>
    </nav><div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={17} /><span><strong>Administrator access</strong><small>{user.email}</small></span></div><button className="logout-button" onClick={onLogout}><LogOut size={15} />Sign out</button></div>
  </aside><main className="admin-main"><header className="admin-topbar"><span className="admin-topbar-title">ADMINISTRATOR CONSOLE</span><span className="user-chip"><span className="avatar">{initials(user.fullName)}</span>{user.fullName}</span></header>{children}</main></div>;
}

function Dashboard({ navigate }: { navigate: (path: string) => void }) {
  const { data, error, retry } = useApiRead<AdminDashboard>('/api/v1/admin/dashboard');
  if (error) return <Failure error={error} retry={retry} />;
  if (!data) return <LoadingState />;
  const metrics = [
    ['Total students', data.metrics.totalStudents, Users], ['Active access', data.metrics.activeStudents, CheckCircle2],
    ['Inactive access', data.metrics.inactiveStudents, ShieldCheck], ['On probation', data.metrics.probationStudents, Activity],
    ['Students with holds', data.metrics.studentsWithActiveHolds, FileText],
  ] as const;
  return <div className="admin-content"><AdminPageHeading eyebrow="ADMINISTRATION" title="Dashboard" description="A concise view of the student directory and recent administrative activity." action={<button className="admin-primary" onClick={() => navigate('/admin/students')}><Users size={16} />Student accounts</button>} />
    <div className="admin-metric-grid">{metrics.map(([label, value, Icon]) => <div className="admin-metric" key={label}><Icon size={18} /><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="admin-two-column"><section className="admin-card"><div className="card-title-row"><div><p className="eyebrow">ACADEMIC CALENDAR</p><h2>Current term</h2></div></div>{data.currentTerm ? <div className="term-summary"><strong>{data.currentTerm.name}</strong><span>{data.currentTerm.code}</span><small>{calendarDate(data.currentTerm.startDate)} – {calendarDate(data.currentTerm.endDate)}</small></div> : <div className="admin-empty">No active academic term.</div>}</section>
      <section className="admin-card"><p className="eyebrow">QUICK ACCESS</p><h2>Directory tools</h2><div className="quick-links"><button onClick={() => navigate('/admin/students')}><Users size={18} /><span>Manage student accounts</span><ChevronRight size={15} /></button><button onClick={() => navigate('/admin/audit-logs')}><Activity size={18} /><span>Review audit history</span><ChevronRight size={15} /></button></div></section></div>
    <section className="admin-card"><div className="card-title-row"><div><p className="eyebrow">LATEST ACTIVITY</p><h2>Recent audit events</h2></div><button className="text-link" onClick={() => navigate('/admin/audit-logs')}>View all <ChevronRight size={14} /></button></div>{data.recentActivity.length ? <div className="audit-list">{data.recentActivity.map(event => <div className="audit-row" key={event.id}><div className="audit-icon"><Activity size={15} /></div><div className="audit-main"><strong>{actionLabels[event.action]}</strong><span>{event.actor.fullName} · {event.target.studentNumber}</span></div><time>{timestamp(event.createdAt)}</time><button className="icon-button" onClick={() => navigate(`/admin/students/${event.studentId}`)} aria-label="Open student"><ChevronRight size={16} /></button></div>)}</div> : <div className="admin-empty">No recent activity.</div>}</section>
  </div>;
}

export function AdminConsolePage({ user, onLogout, path, navigate }: { user: SignedInUser; onLogout: () => void; path: string; navigate: (path: string) => void }) {
  const url = new URL(path, window.location.origin);
  const detailId = /^\/admin\/students\/([^/]+)$/.exec(url.pathname)?.[1];
  const page = url.pathname === '/admin/audit-logs' ? 'audit' : detailId ? 'detail' : url.pathname === '/admin/students' ? 'students' : 'dashboard';
  return <AdminLayout user={user} page={page} navigate={navigate} onLogout={onLogout}>
    {page === 'dashboard' && <Dashboard navigate={navigate} />}
    {page === 'students' && <Students navigate={navigate} search={url.search} />}
    {page === 'detail' && detailId && <StudentDetail key={detailId} id={detailId} search={url.search} navigate={navigate} />}
    {page === 'audit' && <AuditLogs navigate={navigate} search={url.search} />}
  </AdminLayout>;
}
