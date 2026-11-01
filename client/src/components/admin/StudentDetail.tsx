import { useRef, useState } from 'react';
import { Activity, ArrowLeft, Mail, Pencil } from 'lucide-react';
import { apiGet, apiPost, type ApiFailure } from '../../lib/api';
import { accountFeedback, uncertainOutcome } from '../../lib/accountFeedback';
import { useApiRead } from '../../lib/useApiRead';
import { useCooldown } from '../../lib/useCooldown';
import { timestamp } from '../../lib/format';
import type { StudentDetail as DetailData } from '../../types/admin';
import { LoadingState } from '../PageStates';
import { BillingRecords, GradeRecords, ScheduleRecords } from '../RecordViews';
import { DashboardRecords } from '../../pages/DashboardPage';
import { HoldsRecords } from '../../pages/HoldsPage';
import { StudentForm } from './StudentForm';
import { Failure } from './shared';
import { initials } from '../../lib/adminConstants';

const tabs = ['Overview', 'Schedule', 'Grades', 'Holds', 'Billing'] as const;
export function StudentDetail({ id, search, navigate }: { id: string; search: string; navigate: (path: string) => void }) {
  const read = useApiRead<DetailData>(`/api/v1/admin/students/${id}`);
  const [updated, setUpdated] = useState<DetailData>();
  const data = updated ?? read.data;
  const [form, setForm] = useState(false);
  const [formOpener, setFormOpener] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [mailReview, setMailReview] = useState(false);
  const cooldown = useCooldown();
  const rawTab = new URLSearchParams(search).get('tab');
  const tab = tabs.find(value => value.toLowerCase() === rawTab) ?? 'Overview';
  function chooseTab(value: typeof tabs[number]) { navigate(`/admin/students/${id}?tab=${value.toLowerCase()}`); }
  async function reload() {
    const latest = await apiGet<DetailData>(`/api/v1/admin/students/${id}`);
    setUpdated(latest);
    return latest;
  }
  async function review() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      await reload(); setNeedsReview(false);
      setNotice(mailReview ? 'Account refreshed. Email delivery still needs operator review; do not resend to resolve an uncertain outcome.' : 'Account refreshed. Review the current record and audit history before another change.');
    } catch { setNotice('The account could not be refreshed. Review is still required before another change.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function action(path: string, message: string) {
    if (!data || inFlight.current || form || needsReview || cooldown.remaining) return;
    const emailAction = path === 'invitation-resend' || path === 'password-recovery';
    if (emailAction && mailReview) return;
    const detail = path === 'deactivate' ? 'Subsequent SIS requests will be denied. Academic status and records will remain unchanged.'
      : path === 'reactivate' ? 'This restores account access without changing academic records.' : 'This requests an email; inbox delivery is not guaranteed.';
    if (!window.confirm(`${message.replace(/\.$/, '')} for ${data.student.fullName}? ${detail}`)) return;
    inFlight.current = true; setBusy(true); setNotice('');
    let accepted = false;
    try {
      await apiPost(`/api/v1/admin/students/${id}/${path}`, {});
      accepted = true;
      if (emailAction) cooldown.wait(60);
      await reload(); setNotice(message);
    } catch (caught) {
      const error = caught as ApiFailure;
      cooldown.wait(error.retryAfter);
      const unknown = uncertainOutcome(error);
      setNeedsReview(accepted || unknown || error.status === 409 || error.code === 'identity_inconsistent');
      if (emailAction && (unknown || error.code === 'identity_inconsistent')) setMailReview(true);
      setNotice(accepted ? 'Request accepted, but reloading failed. Refresh and review before another action.' : accountFeedback(error));
    } finally { inFlight.current = false; setBusy(false); }
  }
  const back = <button className="back-link" onClick={() => navigate('/admin/students')}><ArrowLeft size={15} />Back to student accounts</button>;
  if (read.error && !updated) return <div className="admin-content">{back}<Failure error={read.error} retry={read.retry} /></div>;
  if (!data) return <LoadingState />;
  const { student } = data;
  const auth = student.auth;
  const locked = busy || form || needsReview || cooldown.remaining > 0;
  return <div className="admin-content">{back}
    <div className="detail-header"><div className="profile-avatar large">{initials(student.fullName)}</div><div><p className="eyebrow">STUDENT PROFILE</p><h1>{student.fullName}</h1><p className="supporting-copy">{student.studentNumber} · {student.email}</p><div className="detail-tags"><span className={`status-tag ${student.academicStatus}`}>{student.academicStatus}</span><span className={`status-tag ${student.isActive ? 'active' : 'inactive'}`}>{student.isActive ? 'Access active' : 'Access inactive'}</span></div></div>
      <div className="detail-actions"><button className="admin-secondary" disabled={locked} onClick={event => { setFormOpener(event.currentTarget); setForm(true); }}><Pencil size={15} />Edit profile</button><button className={student.isActive ? 'danger-button' : 'admin-primary'} disabled={locked} onClick={() => { void action(student.isActive ? 'deactivate' : 'reactivate', student.isActive ? 'Access deactivated.' : 'Access reactivated.'); }}>{student.isActive ? 'Deactivate' : 'Reactivate'}</button></div></div>
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {cooldown.remaining > 0 && <p role="status">Try again in {cooldown.remaining} seconds.</p>}
    {needsReview && <button className="admin-secondary" disabled={busy} onClick={review}>Refresh and review record</button>}
    <div className="detail-grid"><section className="admin-card"><p className="eyebrow">ACCOUNT ACTIVITY</p><h2>Authentication status</h2>{auth ? <dl className="admin-details"><div><dt>Invitation</dt><dd>{timestamp(auth.invitedAt)}</dd></div><div><dt>Email confirmed</dt><dd>{timestamp(auth.emailConfirmedAt)}</dd></div><div><dt>Last sign in</dt><dd>{timestamp(auth.lastSignInAt)}</dd></div></dl> : <div className="warning-box">Authentication identity is unavailable. Email actions are disabled pending review.</div>}
      {auth && student.isActive && <div className="action-row">{auth.invitedAt && !auth.emailConfirmedAt && <button className="admin-secondary" disabled={locked || mailReview} onClick={() => { void action('invitation-resend', 'Invitation requested.'); }}><Mail size={15} />Resend invitation</button>}{auth.emailConfirmedAt && <button className="admin-secondary" disabled={locked || mailReview} onClick={() => { void action('password-recovery', 'Recovery instructions requested.'); }}><Mail size={15} />Send recovery instructions</button>}</div>}</section>
      <section className="admin-card"><p className="eyebrow">PROFILE</p><h2>Academic profile</h2><dl className="admin-details"><div><dt>Department</dt><dd>{student.department || 'Not set'}</dd></div><div><dt>Program</dt><dd>{student.program || 'Not set'}</dd></div><div><dt>Year level</dt><dd>{student.yearLevel ?? 'Not set'}</dd></div><div><dt>Created</dt><dd>{timestamp(student.createdAt)}</dd></div></dl></section></div>
    <div className="record-tabs" role="tablist" aria-label="Student records">{tabs.map(value => <button key={value} id={`tab-${value}`} role="tab" aria-selected={value === tab} aria-controls="student-record-panel" tabIndex={value === tab ? 0 : -1} onClick={() => chooseTab(value)} onKeyDown={event => {
      const index = tabs.indexOf(value);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); chooseTab(tabs[next]); document.getElementById(`tab-${tabs[next]}`)?.focus(); }
    }}>{value}</button>)}</div>
    <section id="student-record-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
      {tab === 'Overview' && <DashboardRecords data={data.dashboard} />}
      {tab === 'Schedule' && <ScheduleRecords data={data.schedule} />}
      {tab === 'Grades' && <GradeRecords data={data.grades} />}
      {tab === 'Holds' && <HoldsRecords data={data.holds} />}
      {tab === 'Billing' && <BillingRecords data={data.billing} />}
    </section>
    <button className="text-link audit-detail-link" onClick={() => navigate(`/admin/audit-logs?studentId=${id}`)}><Activity size={15} />View audit history for this student</button>
    {form && <StudentForm student={student} restoreFocusTo={formOpener} onClose={() => setForm(false)} onReview={async () => (await reload()).student} onSaved={async () => { await reload(); setForm(false); }} />}
  </div>;
}
