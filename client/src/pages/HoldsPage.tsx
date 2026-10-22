import { useEffect, useState } from 'react';
import { CircleCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { apiGet } from '../lib/api';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import type { HoldsData, StudentHold, StudentHoldType } from '../types/dashboard';
import type { PortalView } from '../components/AppShell';

const labels: Record<StudentHoldType, string> = {
  library_debt: 'Library debt',
  academic_probation: 'Academic probation',
  financial_delinquency: 'Financial delinquency',
  disciplinary: 'Disciplinary',
};

const guidance: Record<StudentHoldType, { message: string; view?: PortalView }> = {
  library_debt: { message: 'Review Library services for the related account information.', view: 'library' },
  academic_probation: { message: 'Contact your academic adviser or department for clearance guidance.' },
  financial_delinquency: { message: 'Review your student account and contact the university cashier.', view: 'billing' },
  disciplinary: { message: 'Contact Student Affairs for clearance guidance.' },
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value));
}

function HoldCard({ hold, active, onNavigate }: { hold: StudentHold; active: boolean; onNavigate: (view: PortalView) => void }) {
  const nextStep = guidance[hold.holdType];
  return <article className={`hold-card ${active ? 'hold-card-active' : ''}`}>
    <div className="hold-card-icon">{active ? <ShieldAlert size={19} /> : <CircleCheck size={19} />}</div>
    <div className="hold-card-main">
      <div className="hold-card-heading"><div><p className="eyebrow">{labels[hold.holdType]}</p><h2>{hold.reason}</h2></div><span className={`status-pill ${active ? 'hold-active' : 'hold-resolved'}`}>{active ? 'Active' : 'Resolved'}</span></div>
      <dl className="hold-details"><div><dt>Placed by</dt><dd>{hold.placedBySystem}</dd></div><div><dt>Placed</dt><dd>{formatDate(hold.placedAt)}</dd></div>{!active && <div><dt>Resolved</dt><dd>{formatDate(hold.resolvedAt)}</dd></div>}</dl>
      {active && <div className="hold-guidance"><TriangleAlert size={15} /><span>{nextStep.message}</span>{nextStep.view && <button type="button" onClick={() => { if (nextStep.view) onNavigate(nextStep.view); }}>Open {nextStep.view === 'library' ? 'Library' : 'Billing'}</button>}</div>}
    </div>
  </article>;
}

export function HoldsPage({ onNavigate }: { onNavigate: (view: PortalView) => void }) {
  const [data, setData] = useState<HoldsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { apiGet<HoldsData>('/api/v1/holds/me').then(setData).catch((reason: Error) => setError(reason.message)); }, []);
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return <><SectionHeading eyebrow="STUDENT RECORD" title="Holds" description="Review restrictions on your university account and the steps needed to clear them." />
    <section className="holds-section"><div className="card-title-row"><div><p className="eyebrow">ACTIVE RESTRICTIONS</p><h2>{data.activeHolds.length ? `${data.activeHolds.length} active hold${data.activeHolds.length === 1 ? '' : 's'}` : 'No active holds'}</h2></div><ShieldAlert className="card-icon" size={22} /></div>
      {data.activeHolds.length ? <div className="holds-list">{data.activeHolds.map(hold => <HoldCard key={hold.id} hold={hold} active onNavigate={onNavigate} />)}</div> : <div className="empty-state"><CircleCheck size={27} /><div><h2>Your account is clear</h2><p>You have no active holds at this time.</p></div></div>}
    </section>
    <section className="holds-section resolved-section"><div className="card-title-row"><div><p className="eyebrow">HISTORY</p><h2>Resolved holds</h2></div></div>
      {data.resolvedHolds.length ? <div className="holds-list">{data.resolvedHolds.map(hold => <HoldCard key={hold.id} hold={hold} active={false} onNavigate={onNavigate} />)}</div> : <div className="empty-row"><CircleCheck size={18} /><span>No resolved holds are recorded.</span></div>}
    </section>
  </>;
}
