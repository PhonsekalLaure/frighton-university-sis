import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, GraduationCap, LockKeyhole, UserRound } from 'lucide-react';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import { StudentAvatar } from '../components/StudentAvatar';
import { apiPost, type ApiFailure } from '../lib/api';
import { timestamp } from '../lib/format';
import { useApiRead } from '../lib/useApiRead';
import { useCooldown } from '../lib/useCooldown';
import type { StudentProfile } from '../types/profile';

export function ProfilePage({ onRequireLogin }: { onRequireLogin: (message: string) => void }) {
  const { data, error, retry } = useApiRead<{ profile: StudentProfile }>('/api/v1/profile/me');
  if (error) return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
  if (!data) return <LoadingState />;
  const profile = data.profile;
  return <>
    <SectionHeading eyebrow="STUDENT RECORD" title="Student profile" description="Your university details and account security, in one place." />
    <section className="content-card student-profile-summary" aria-label="Student identity">
      <StudentAvatar src={profile.avatarUrl} name={profile.fullName} className="large" />
      <div><p className="eyebrow">FRIGHTON UNIVERSITY STUDENT</p><h2>{profile.fullName}</h2><p>{profile.studentNumber}</p></div>
      <span className={`status-tag ${profile.academicStatus}`}>{profile.academicStatus}</span>
    </section>
    <div className="student-profile-grid">
      <div className="student-profile-details">
        <section className="content-card" aria-labelledby="personal-details-heading">
          <div className="card-title-row"><div><p className="eyebrow">BASIC INFORMATION</p><h2 id="personal-details-heading">Personal details</h2></div><UserRound className="card-icon" size={21} /></div>
          <dl className="student-profile-fields">
            <div><dt>First name</dt><dd>{profile.firstName}</dd></div><div><dt>Middle name</dt><dd>{profile.middleName || 'Not recorded'}</dd></div>
            <div><dt>Last name</dt><dd>{profile.lastName}</dd></div><div><dt>University email</dt><dd>{profile.email}</dd></div>
          </dl>
        </section>
        <section className="content-card" aria-labelledby="academic-details-heading">
          <div className="card-title-row"><div><p className="eyebrow">UNIVERSITY RECORD</p><h2 id="academic-details-heading">Academic details</h2></div><GraduationCap className="card-icon" size={22} /></div>
          <dl className="student-profile-fields">
            <div><dt>Student number</dt><dd>{profile.studentNumber}</dd></div><div><dt>Year level</dt><dd>{profile.yearLevel ?? 'Not recorded'}</dd></div>
            <div><dt>Department</dt><dd>{profile.department || 'Not recorded'}</dd></div><div><dt>Program</dt><dd>{profile.program || 'Not recorded'}</dd></div>
            <div><dt>Profile created</dt><dd>{timestamp(profile.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{timestamp(profile.updatedAt)}</dd></div>
          </dl>
          <p className="student-profile-note">Contact Administration to correct your personal or academic details, or update your profile photo.</p>
        </section>
      </div>
      <ChangePassword onRequireLogin={onRequireLogin} />
    </div>
  </>;
}

function ChangePassword({ onRequireLogin }: { onRequireLogin: (message: string) => void }) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const cooldown = useCooldown();
  function clear() { setValues({ currentPassword: '', newPassword: '', confirmPassword: '' }); setShow(false); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || cooldown.remaining) return;
    setError('');
    if (!values.currentPassword || values.currentPassword.length > 1024 || values.currentPassword.includes('\0') ||
      values.newPassword.length < 12 || values.newPassword.length > 128 || values.newPassword.includes('\0')) {
      setError('Enter your current password and a new password of 12–128 characters, without NUL characters.'); return;
    }
    if (values.newPassword !== values.confirmPassword) { setError('The new password and confirmation must match.'); return; }
    if (values.currentPassword === values.newPassword) { setError('Choose a password different from your current password.'); return; }
    pending.current = true; setSaving(true);
    try {
      const result = await apiPost<{ requiresLogin: true; sessionsRevoked: boolean }>('/api/v1/profile/me/password', values);
      clear();
      onRequireLogin(result.sessionsRevoked
        ? 'Your password changed. Sign in with your new password to continue.'
        : 'Your password changed. Sign in with your new password. Other sessions could not be confirmed signed out.');
    } catch (caught) {
      const failure = caught as ApiFailure;
      clear();
      if (failure.code === 'password_update_unknown') {
        onRequireLogin('The password update could not be confirmed. Try signing in before attempting another change.');
        return;
      }
      cooldown.wait(failure.retryAfter ?? (failure.status === 429 ? 60 : undefined));
      setError(failure.status ? failure.message : 'The password update could not be confirmed. Try signing in before attempting another change.');
      if (!failure.status) {
        onRequireLogin('The password update could not be confirmed. Try signing in before attempting another change.');
      }
    } finally { pending.current = false; setSaving(false); }
  }
  return <section className="content-card student-password-card" aria-labelledby="change-password-heading">
    <div className="card-title-row"><div><p className="eyebrow">ACCOUNT SECURITY</p><h2 id="change-password-heading">Change password</h2></div><LockKeyhole className="card-icon" size={21} /></div>
    <p className="student-profile-note">This changes your password for both SIS and LMS. You will need to sign in again afterward.</p>
    <form onSubmit={submit} noValidate aria-busy={saving}>
      {(['currentPassword', 'newPassword', 'confirmPassword'] as const).map(field => <div className="student-password-field" key={field}>
        <label htmlFor={field}>{field === 'currentPassword' ? 'Current password' : field === 'newPassword' ? 'New password' : 'Confirm new password'}</label>
        <div className="input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id={field} type={show ? 'text' : 'password'} autoComplete={field === 'currentPassword' ? 'current-password' : 'new-password'} value={values[field]} disabled={saving} required aria-describedby={field === 'currentPassword' ? undefined : 'password-requirements'} onChange={event => setValues(previous => ({ ...previous, [field]: event.target.value }))} /></div>
      </div>)}
      <p className="student-profile-note" id="password-requirements">Use 12–128 characters and a password different from your current one.</p>
      <button type="button" className="text-link" aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}{show ? 'Hide passwords' : 'Show passwords'}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
      {cooldown.remaining > 0 && <p className="student-profile-note" role="status">Try again in {cooldown.remaining} seconds.</p>}
      <button className="submit-button" disabled={saving || cooldown.remaining > 0}>{saving ? 'Updating password…' : 'Update password'}</button>
    </form>
  </section>;
}
