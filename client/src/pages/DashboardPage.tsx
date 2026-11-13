import { ArrowRight, Award, CalendarDays, CheckCircle2, CreditCard, ShieldCheck } from 'lucide-react';
import { useApiRead } from '../lib/useApiRead';
import { money } from '../lib/format';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import type { DashboardData } from '../types/dashboard';
import { StudentAvatar } from '../components/StudentAvatar';

type Navigate = (view: 'schedule' | 'grades' | 'billing') => void;
export function DashboardPage({ onNavigate }: { onNavigate: Navigate }) {
  const { data, error, retry } = useApiRead<DashboardData>('/api/v1/dashboard/me');
  if (error) return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
  if (!data) return <LoadingState />;
  return <><SectionHeading eyebrow="FRIGHTON UNIVERSITY SIS" title={`Welcome, ${data.profile.fullName}.`} description={`${data.profile.program || data.profile.department || 'Student'} · ${data.profile.studentNumber}`} action={<span className="term-tag">{data.currentTerm?.name || 'No active term'}</span>} /><DashboardRecords data={data} onNavigate={onNavigate} /></>;
}

export function DashboardRecords({ data, onNavigate }: { data: DashboardData; onNavigate?: Navigate }) {
  const billingLabel = data.billing.status === null ? 'No statement available' : `${money(data.billing.outstandingBalance)} outstanding`;
  return <div className="dashboard-grid"><div className="dashboard-primary">
    <section className="status-banner"><div className="status-icon"><ShieldCheck size={24} /></div><div><p className="eyebrow">ACADEMIC STATUS</p><h2>{data.profile.academicStatus?.toUpperCase() || 'Not recorded'}</h2><p>Current academic credits: <strong>{data.metrics.currentAcademicCredits}</strong></p></div><CheckCircle2 className="status-check" size={24} /></section>
    <section className="content-card"><div className="card-title-row"><div><p className="eyebrow">TODAY</p><h2>Your schedule</h2></div>{onNavigate && <button className="text-link" onClick={() => onNavigate('schedule')}>View full schedule <ArrowRight size={15} /></button>}</div>
      {data.todaySchedule.length ? data.todaySchedule.map(item => <div className="schedule-row" key={`${item.courseCode}-${item.schedule}`}><div className="course-badge">{item.courseCode.slice(0, 2)}</div><div><strong>{item.courseCode} · {item.title}</strong><span>{item.schedule || 'Schedule to be announced'} · {item.room || 'Room to be announced'}</span></div></div>) : <div className="empty-row"><CalendarDays size={20} /><span>No classes scheduled for today.</span></div>}
    </section>
    {onNavigate ? <div className="quick-links"><button onClick={() => onNavigate('grades')}><Award size={19} /><span><small>ACADEMIC RECORDS</small><strong>View grades</strong></span><ArrowRight size={16} /></button><button onClick={() => onNavigate('billing')}><CreditCard size={19} /><span><small>ACCOUNT SUMMARY</small><strong>{billingLabel}</strong></span><ArrowRight size={16} /></button></div> : <section className="content-card"><p className="eyebrow">ACCOUNT SUMMARY</p><h2>{billingLabel}</h2></section>}
  </div><aside className="dashboard-side">
    <section className="profile-card"><p className="eyebrow">STUDENT PROFILE</p><StudentAvatar src={data.profile.avatarUrl} name={data.profile.fullName} /><h2>{data.profile.fullName}</h2><p>{data.profile.email}</p><dl><div><dt>Student number</dt><dd>{data.profile.studentNumber}</dd></div><div><dt>Year level</dt><dd>{data.profile.yearLevel || '—'}</dd></div><div><dt>Department</dt><dd>{data.profile.department || '—'}</dd></div></dl></section>
    <section className="metric-card"><p className="eyebrow">ACADEMIC SNAPSHOT</p><div className="metric"><span>Cumulative GPA</span><strong>{data.metrics.cumulativeGpa ?? '—'}</strong></div><div className="metric"><span>Credits earned</span><strong>{data.metrics.creditsEarned}</strong></div><div className="metric"><span>Active holds</span><strong className={data.metrics.activeHolds ? 'warning-text' : ''}>{data.metrics.activeHolds}</strong></div></section>
  </aside></div>;
}
