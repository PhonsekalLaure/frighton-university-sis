import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { apiGet, apiPatch, apiPost, apiUpload, type ApiFailure } from '../../lib/api';
import { accountFeedback, uncertainOutcome } from '../../lib/accountFeedback';
import { useCooldown } from '../../lib/useCooldown';
import { fieldLimits, studentPayload, studentValues, type FormValues } from '../../lib/studentForm';
import type { Page, Student, StudentListItem } from '../../types/admin';
import { Dialog } from '../Dialog';
import { StudentAvatar } from '../StudentAvatar';
import { departments, statuses } from '../../lib/adminConstants';

const fields = [
  ['firstName', 'First name', 'text'], ['middleName', 'Middle name', 'text'], ['lastName', 'Last name', 'text'],
  ['email', 'University email', 'email'],
  ['program', 'Program', 'text'], ['yearLevel', 'Year level', 'number'],
] as const;

export function StudentForm({ student, onClose, onSaved, onReview, restoreFocusTo }: {
  student?: Student; onClose: () => void; onSaved: (id: string) => Promise<void> | void; onReview?: () => Promise<Student>; restoreFocusTo?: HTMLElement | null;
}) {
  const [baseline, setBaseline] = useState(student);
  const [values, setValues] = useState(() => studentValues(student));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const emailCancel = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const wasConfirmingEmail = useRef(false);
  const [photo, setPhoto] = useState<File>();
  const [photoPreview, setPhotoPreview] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewed, setReviewed] = useState<Student>();
  const [matched, setMatched] = useState<StudentListItem>();
  const cooldown = useCooldown();
  let unchanged = false;
  try { unchanged = Boolean(baseline && !photo && Object.keys(studentPayload(values, baseline)).length === 0); } catch { /* Submission explains invalid fields. */ }
  const set = (key: keyof FormValues, value: string) => setValues(current => ({ ...current, [key]: value }));

  useEffect(() => {
    if (photoPreview) return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    if (confirmEmail) emailCancel.current?.focus();
    else if (wasConfirmingEmail.current) saveButton.current?.focus();
    wasConfirmingEmail.current = confirmEmail;
  }, [confirmEmail]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 2 * 1024 * 1024 || !selected.size) {
      setPhoto(undefined); setPhotoPreview('');
      setError('Choose a JPEG, PNG, or WebP image, 2 MB or smaller.');
      event.target.value = '';
      return;
    }
    setError(''); setPhoto(selected); setPhotoPreview(URL.createObjectURL(selected));
  }

  function removePhoto() {
    setPhoto(undefined); setPhotoPreview(''); set('avatarUrl', ''); setError('');
    if (photoInput.current) photoInput.current.value = '';
  }

  async function submit(event?: FormEvent, emailConfirmed = false) {
    event?.preventDefault();
    if (inFlight.current || reviewRequired || cooldown.remaining || unchanged) return;
    setError('');
    let payload: ReturnType<typeof studentPayload>;
    try { payload = studentPayload(values, baseline); } catch (validation) { setError((validation as Error).message); return; }
    if (baseline && payload.email && !emailConfirmed) { setConfirmEmail(true); return; }
    setConfirmEmail(false);
    inFlight.current = true; setSaving(true);
    let committed = false;
    let accountAttempted = false;
    try {
      if (photo) {
        const uploaded = await apiUpload<{ avatarUrl: string }>('/api/v1/admin/student-photos', photo);
        payload.avatarUrl = uploaded.avatarUrl;
        set('avatarUrl', uploaded.avatarUrl); setPhoto(undefined); setPhotoPreview('');
        if (photoInput.current) photoInput.current.value = '';
      }
      accountAttempted = true;
      const result = baseline
        ? await apiPatch<{ student: Student }>(`/api/v1/admin/students/${baseline.id}`, payload)
        : await apiPost<{ student: Student }>('/api/v1/admin/students', payload);
      committed = true;
      await onSaved(result.student.id);
    } catch (caught) {
      const failure = caught as ApiFailure;
      cooldown.wait(failure.retryAfter);
      setReviewRequired(committed || (accountAttempted && (uncertainOutcome(failure) || failure.code === 'identity_inconsistent')));
      setError(committed ? 'Account saved, but reloading failed. Refresh and review the record before another change.'
        : !accountAttempted ? 'Photo upload failed. Your changes are retained. Try saving again.' : accountFeedback(failure));
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
      <fieldset disabled={saving || confirmEmail}><legend className="sr-only">Student profile</legend>
        <div className="student-number-field">
          <label>Student number<input value={baseline?.studentNumber ?? ''} placeholder="Assigned automatically when saved" disabled aria-describedby={!baseline ? 'student-number-help' : undefined} /></label>
          {!baseline && <small id="student-number-help">The next student number is assigned automatically when the account is created.</small>}
        </div>
        {fields.map(([key, label, type]) => <label key={key}>{label}<input type={type} value={values[key]}
          required={['firstName', 'lastName', 'email'].includes(key) || (!baseline && ['program', 'yearLevel'].includes(key))}
          min={key === 'yearLevel' ? 1 : undefined} max={key === 'yearLevel' ? 4 : undefined} step={key === 'yearLevel' ? 1 : undefined}
          maxLength={key === 'yearLevel' ? undefined : fieldLimits[key]} onChange={event => set(key, event.target.value)} /></label>)}
        <label>Department<select value={values.department} required={!baseline} onChange={event => set('department', event.target.value)}>
          <option value="">{baseline ? 'Not set' : 'Select a department'}</option>
          {baseline?.department && !departments.includes(baseline.department) && <option value={baseline.department}>{baseline.department}</option>}
          {departments.map(department => <option key={department}>{department}</option>)}
        </select></label>
        <label>Academic status<select value={values.academicStatus} onChange={event => set('academicStatus', event.target.value)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
        <div className="student-photo-field">
          <label>Student photo<input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} aria-describedby="student-photo-help" /></label>
          <small id="student-photo-help">Optional. Leave blank to use the default profile picture. JPEG, PNG, or WebP, up to 2 MB.</small>
          <StudentAvatar className="student-photo-preview" src={photoPreview || values.avatarUrl} name={[values.firstName, values.lastName].filter(Boolean).join(' ') || 'student'} alt="Student photo preview" />
          {(photo || values.avatarUrl) && <button type="button" className="admin-secondary" onClick={removePhoto}>Remove photo</button>}
        </div>
      </fieldset>
      {confirmEmail && <section className="account-confirmation" aria-labelledby="email-confirm-title"><h3 id="email-confirm-title">Change university login?</h3><p>Change the shared university login from <strong>{baseline?.email}</strong> to <strong>{values.email.trim()}</strong>? This changes the student's login in SIS and LMS.</p><div className="modal-actions"><button ref={emailCancel} type="button" className="admin-secondary" onClick={() => { setConfirmEmail(false); saveButton.current?.focus(); }}>Keep editing</button><button type="button" className="admin-primary" onClick={() => { void submit(undefined, true); }}>Confirm email change</button></div></section>}
      <div className="modal-actions" hidden={confirmEmail}><button type="button" className="admin-secondary" disabled={saving} onClick={onClose}>Cancel</button><button ref={saveButton} className="admin-primary" disabled={saving || unchanged || reviewRequired || cooldown.remaining > 0}>{saving ? 'Saving…' : baseline ? 'Save changes' : 'Create account'}</button></div>
    </form>
  </Dialog>;
}
