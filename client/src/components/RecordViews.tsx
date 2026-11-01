import { useState } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, CreditCard, MapPin, ReceiptText, UserRound } from 'lucide-react';
import type { BillingData, BillingStatement, GradesData, GradeStatus, ScheduleData } from '../types/dashboard';
import { calendarDate, money, timestamp } from '../lib/format';

function Statement({ statement }: { statement: BillingStatement }) {
  return <><div className="billing-hero"><div><p className="eyebrow">{statement.term.name}</p><h2>{money(statement.outstandingBalance)}</h2><span>Outstanding balance</span></div><span className={`status-pill ${statement.statementStatus}`}>{statement.statementStatus.replaceAll('_', ' ')}</span></div>
    <div className="billing-breakdown"><div><span>Total assessed</span><strong>{money(statement.totalAssessed)}</strong></div><div><span>Cashier payments</span><strong>{money(statement.totalPaid)}</strong></div><div><span>Due date</span><strong>{calendarDate(statement.dueDate)}</strong></div></div>
    <div className="charges-list"><div><span>Tuition</span><strong>{money(statement.charges.tuition)}</strong></div><div><span>Mandatory fees</span><strong>{money(statement.charges.mandatoryFees)}</strong></div><div><span>Scholarships / discounts</span><strong className="credit-text">− {money(statement.charges.scholarships)}</strong></div></div></>;
}

export function BillingRecords({ data }: { data: BillingData }) {
  const [selectedId, setSelectedId] = useState<string>();
  const statements = [...data.statements].sort((a, b) => b.term.startDate.localeCompare(a.term.startDate));
  const selected = statements.find(statement => statement.id === selectedId) ?? data.currentStatement ?? statements[0];
  return <><div className="notice-banner"><ReceiptText size={19} /><span>{data.paymentNotice}</span></div>
    {!data.currentStatement && <p className="admin-notice" role="status">No active-term statement is available.{statements.length > 0 ? ' Historical statements are available below.' : ''}</p>}
    {statements.length > 0 && <label className="statement-selector">Statement<select value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{statements.map(statement => <option value={statement.id} key={statement.id}>{statement.term.name}{statement.id === data.currentStatement?.id ? ' (current)' : ''}</option>)}</select></label>}
    {selected ? <div className="billing-grid"><section className="content-card statement-card"><div className="card-title-row"><div><p className="eyebrow">{selected.id === data.currentStatement?.id ? 'CURRENT STATEMENT' : 'HISTORICAL STATEMENT'}</p><h2>Account summary</h2></div><CreditCard className="card-icon" size={22} /></div><Statement statement={selected} /></section>
      <section className="content-card receipt-card"><p className="eyebrow">PAYMENT HISTORY</p><h2>Cashier receipts</h2>{selected.payments.length ? selected.payments.map(payment => <div className="payment-row" key={payment.id}><div className="payment-icon"><CheckCircle2 size={17} /></div><div><strong>{money(payment.amount)}</strong><span>{payment.referenceNumber || 'No reference number'} · {timestamp(payment.paidAt)}</span></div><small>{payment.receiptStatus}</small></div>) : <div className="empty-row">No cashier payments recorded.</div>}<p className="official-note">{data.officialReceiptNotice}</p></section></div>
      : <div className="content-card empty-state"><CreditCard size={27} /><h2>No statement available</h2><p>No billing statements have been recorded.</p><p>{data.officialReceiptNotice}</p></div>}</>;
}

const gradeLabels: Record<Exclude<GradeStatus, 'final'>, string> = { in_progress: 'In progress', withdrawn: 'Withdrawn', not_recorded: 'Not recorded' };
export function GradeRecords({ data }: { data: GradesData }) {
  return <><div className="summary-strip"><div><span>Cumulative GPA</span><strong>{data.summary.cumulativeGpa ?? '—'}</strong></div><div><span>Attempted credits</span><strong>{data.summary.attemptedCredits}</strong></div><div><span>Credits earned</span><strong>{data.summary.creditsEarned}</strong></div></div>
    <div className="grades-list">{data.terms.map(term => <section className="content-card term-card" key={term.id}><div className="card-title-row"><div><p className="eyebrow">{term.code}</p><h2>{term.name}</h2></div><div className="term-gpa"><small>TERM GPA</small><strong>{term.gpa ?? '—'}</strong></div></div><p className="supporting-copy">{term.attemptedCredits} attempted credits · {term.creditsEarned} credits earned</p><div className="grades-table"><div className="grades-header"><span>Course</span><span>Credits</span><span>Grade</span></div>{term.courses.map(course => <div className="grade-row" key={course.id}><span><strong>{course.courseCode}</strong><small>{course.title} · Section {course.sectionNumber}</small></span><span>{course.credits}</span><span className={course.gradeStatus === 'final' ? 'grade-pill' : 'grade-pill neutral'}>{course.gradeStatus === 'final' ? course.grade ?? 'Not recorded' : gradeLabels[course.gradeStatus]}</span></div>)}</div></section>)}{!data.terms.length && <div className="empty-state"><BookOpen size={25} /><p>No grades have been posted yet.</p></div>}</div></>;
}

export function ScheduleRecords({ data }: { data: ScheduleData }) {
  return <section className="content-card page-card"><div className="card-title-row"><div><p className="eyebrow">{data.currentTerm?.name ?? 'No active term'}</p><h2>{data.classes.length} classes</h2></div><CalendarDays size={22} className="card-icon" /></div>{data.classes.length ? data.classes.map(item => <div className="detail-row" key={item.id}><div className="course-badge large">{item.courseCode.slice(0, 2)}</div><div className="detail-main"><strong>{item.courseCode} · {item.title}</strong><span>{item.credits} credits · Section {item.sectionNumber}</span></div><div className="detail-meta"><span><CalendarDays size={14} /> {item.schedule || 'To be announced'}</span><span><MapPin size={14} /> {item.room || 'To be announced'}</span><span><UserRound size={14} /> {item.instructor.name || 'Instructor to be announced'}</span>{item.instructor.email && <span>{item.instructor.email}</span>}</div></div>) : <div className="empty-state"><CalendarDays size={25} /><p>No current academic assignments found.</p></div>}</section>;
}
