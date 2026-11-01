import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { apiPost, type ApiFailure } from '../lib/api';
import { clearPasswordLink, type PasswordLink } from '../lib/passwordLink';
import { useCooldown } from '../lib/useCooldown';

function passwordFeedback(error: ApiFailure) {
  if (error.code === 'invalid_or_expired_link') return 'This link expired or was already used. Contact Administration for a fresh invitation or recovery link.';
  if (error.code === 'password_update_rejected') return 'The password was rejected after the link was verified. Contact Administration for a fresh recovery link and follow the password requirements.';
  if (error.code === 'password_update_throttled') return 'Password updates are temporarily limited. Wait, then request a fresh recovery link through Administration.';
  if (error.code === 'student_access_required') return 'This link cannot update an active student account. Contact Administration.';
  if (error.code === 'invalid_password_request') return error.message;
  if (error.code === 'rate_limited') return error.retryAfter ? `Please wait ${error.retryAfter} seconds before submitting.` : 'Please wait before submitting. Contact Administration if the limit persists.';
  return 'The password outcome could not be confirmed. Try normal sign in first; if it does not work, contact Administration for a fresh recovery link. Do not submit this link again.';
}

export function SetPasswordPage({ link, onClearLink, onComplete }: {
  link: PasswordLink | null; onClearLink: () => void; onComplete: () => void;
}) {
  const token = useRef(link);
  const [activeLink, setActiveLink] = useState(link);
  const [linkType] = useState(link?.type);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const cooldown = useCooldown();
  function clear() {
    clearPasswordLink(token.current); token.current = null;
    setActiveLink(null);
    setPassword(''); setConfirm(''); onClearLink();
  }
  function exit() { clear(); onComplete(); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || terminal || cooldown.remaining || !token.current?.tokenHash) return;
    setError('');
    if (password.length < 12 || password.length > 128 || password.includes('\0')) { setError('Use a password between 12 and 128 characters, without NUL characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    pending.current = true; setLoading(true);
    try {
      await apiPost('/api/auth/password/complete', { tokenHash: token.current.tokenHash, type: token.current.type, password });
      setDone(true); clear();
    } catch (caught) {
      const failure = caught as ApiFailure;
      cooldown.wait(failure.retryAfter);
      setError(passwordFeedback(failure));
      if (!['invalid_password_request', 'rate_limited'].includes(failure.code ?? '')) { setTerminal(true); clear(); }
    } finally { pending.current = false; setLoading(false); }
  }
  if (done) return <main className="login-page"><section className="login-shell"><div className="login-card signed-in-state"><div className="success-icon"><CheckCircle2 size={28} /></div><p className="eyebrow">PASSWORD UPDATED</p><h1>Password set successfully</h1><p className="supporting-copy">Sign in with your new password to continue.</p><button className="submit-button" onClick={exit}>Go to sign in <ArrowRight size={17} /></button></div></section></main>;
  if (!activeLink?.tokenHash && !terminal) return <main className="login-page"><section className="login-shell"><div className="login-card"><p className="eyebrow">PASSWORD SETUP</p><h1>This link is not valid</h1><p className="supporting-copy">Open the latest invitation or recovery email. If the link has expired or was already used, contact Administration for a fresh request.</p><button className="submit-button" onClick={exit}>Go to sign in <ArrowRight size={17} /></button></div></section></main>;
  return <main className="login-page"><section className="login-shell"><div className="login-card"><p className="eyebrow">{linkType === 'invite' ? 'WELCOME TO FRIGHTON' : 'PASSWORD RECOVERY'}</p><h1>Create your SIS password</h1><p className="supporting-copy">Choose a password to finish securing your university account.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    {cooldown.remaining > 0 && <p role="status">Try again in {cooldown.remaining} seconds.</p>}
    {!terminal && <form onSubmit={submit} noValidate><label htmlFor="new-password">New password</label><div className="input-wrap"><LockKeyhole size={18} /><input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} disabled={loading} onChange={event => setPassword(event.target.value)} required /><button className="icon-button" type="button" onClick={() => setShow(!show)} aria-label="Toggle password visibility">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      <label htmlFor="confirm-password">Confirm password</label><div className="input-wrap"><LockKeyhole size={18} /><input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} disabled={loading} onChange={event => setConfirm(event.target.value)} required /></div><button className="submit-button" disabled={loading || cooldown.remaining > 0}>{loading ? 'Saving…' : 'Set password'} {!loading && <ArrowRight size={17} />}</button>
    </form>}
    <button className="text-link password-exit" disabled={loading} onClick={exit}>Go to sign in</button>
  </div></section></main>;
}
