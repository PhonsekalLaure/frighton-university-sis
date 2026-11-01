import { useRef, useState, type FormEvent } from 'react';
import { apiGet, apiPatch, apiPost, type ApiFailure } from '../../lib/api';
import { accountFeedback, uncertainOutcome } from '../../lib/accountFeedback';
import { useCooldown } from '../../lib/useCooldown';
import { fieldLimits, studentPayload, studentValues, type FormValues } from '../../lib/studentForm';
import type { Page, Student, StudentListItem } from '../../types/admin';
import { Dialog } from '../Dialog';
import { statuses } from '../../lib/adminConstants';

const fields = [
  ['firstName', 'First name', 'text'], ['middleName', 'Middle name', 'text'], ['lastName', 'Last name', 'text'],
  ['email', 'University email', 'email'], ['studentNumber', 'Student number', 'text'], ['department', 'Department', 'text'],
  ['program', 'Program', 'text'], ['yearLevel', 'Year level', 'number'], ['avatarUrl', 'Avatar URL', 'url'],
] as const;

export function StudentForm({ student, onClose, onSaved, onReview, restoreFocusTo }: {
  student?: Student; onClose: () => void; onSaved: (id: string) => Promise<void> | void; onReview?: () => Promise<Student>; restoreFocusTo?: HTMLElement | null;
}) {
  const [baseline, setBaseline] = useState(student);
  const [values, setValues] = useState(() => studentValues(student));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewed, setReviewed] = useState<Student>();
  const [matched, setMatched] = useState<StudentListItem>();
  const cooldown = useCooldown();
  let unchanged = false;
  try { unchanged = Boolean(baseline && Object.keys(studentPayload(values, baseline)).length === 0); } catch { /* Submission explains invalid fields. */ }
  const set = (key: keyof FormValues, value: string) => setValues(current => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || reviewRequired || cooldown.remaining || unchanged) return;
    setError('');
    let payload: ReturnType<typeof studentPayload>;
    try { payload = studentPayload(values, baseline); } catch (validation) { setError((validation as Error).message); return; }
    if (baseline && payload.email && !window.confirm(`Change the shared university login from ${baseline.email} to ${payload.email}? This changes the student's login in SIS and LMS.`)) return;
    inFlight.current = true; setSaving(true);
    let committed = false;
    try {
      const result = baseline
        ? await apiPatch<{ student: Student }>(`/api/v1/admin/students/${baseline.id}`, payload)
        : await apiPost<{ student: Student }>('/api/v1/admin/students', payload);
      committed = true;
      await onSaved(result.student.id);
    } catch (caught) {
      const failure = caught as ApiFailure;
      cooldown.wait(failure.retryAfter);
      setReviewRequired(committed || uncertainOutcome(failure));
      setError(committed ? 'Account saved, but reloading failed. Refresh and review the record before another change.' : accountFeedback(failure));
    } finally { inFlight.current = false; setSaving(false); }
  }

  async function review() {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true);
    try {
      if (baseline && onReview) {
        const current = await onReview();
        setBaseline(current); setReviewed(current); setReviewRequired(false);
        setError('Record refreshed. Compare the current record below with your retained edits before saving.');
      } else {
        const result = await apiGet<Page<StudentListItem>>(`/api/v1/admin/students?q=${encodeURIComponent(values.email.trim())}&page=1&pageSize=100`);
        const match = result.items.find(item => item.email.toLowerCase() === values.email.trim().toLowerCase());
        setMatched(match);
        setError(match ? 'A matching account exists. Open it to review the outcome; do not create it again.' : 'No matching account was returned. This does not confirm failure. Ask an operator to review the provisioning outcome before another creation request.');
      }
    } catch (caught) { setError(`Review could not be completed. ${(caught as Error).message}`); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <Dialog title={baseline ? 'Edit student profile' : 'Create student account'} busy={saving} onClose={onClose} restoreFocusTo={restoreFocusTo}>
    {error && <p className="error-message" role="alert">{error}</p>}
    {reviewed && <details className="review-record" open><summary>Current committed record</summary><dl>{Object.entries(studentValues(reviewed)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || 'Not set'}</dd></div>)}</dl></details>}
    {reviewRequired && <button className="admin-secondary" disabled={saving} onClick={review}>Refresh and review record</button>}
    {matched && <button className="admin-secondary" disabled={saving} onClick={() => { void onSaved(matched.id); }}>Open matching account</button>}
    {cooldown.remaining > 0 && <p role="status">Try again in {cooldown.remaining} seconds.</p>}
    <form className="admin-form" onSubmit={submit} noValidate>
      <fieldset disabled={saving}><legend className="sr-only">Student profile</legend>
        {fields.map(([key, label, type]) => <label key={key}>{label}<input type={type} value={values[key]} disabled={key === 'studentNumber' && Boolean(baseline)}
          required={['firstName', 'lastName', 'email'].includes(key) || (!baseline && ['studentNumber', 'department', 'program', 'yearLevel'].includes(key))}
          min={key === 'yearLevel' ? 1 : undefined} max={key === 'yearLevel' ? 4 : undefined} step={key === 'yearLevel' ? 1 : undefined}
          maxLength={key === 'yearLevel' ? undefined : fieldLimits[key]} onChange={event => set(key, event.target.value)} /></label>)}
        <label>Academic status<select value={values.academicStatus} onChange={event => set('academicStatus', event.target.value)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
      </fieldset>
      <div className="modal-actions"><button type="button" className="admin-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="admin-primary" disabled={saving || unchanged || reviewRequired || cooldown.remaining > 0}>{saving ? 'Saving…' : baseline ? 'Save changes' : 'Create account'}</button></div>
    </form>
  </Dialog>;
}
