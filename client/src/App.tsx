import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import './App.css';

interface SignedInUser {
  fullName: string;
  email: string;
  role: 'student' | 'admin';
}

interface AuthResponse {
  user?: SignedInUser;
  error?: string;
}

export function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return;
        const data: AuthResponse = await response.json();
        if (data.user) setUser(data.user);
      })
      .catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember }),
      });
      const data: AuthResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to sign in. Please try again.');
      }
      setUser(data.user ?? null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to sign in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="ambient-glow ambient-glow-left" />
      <div className="ambient-glow ambient-glow-right" />

      <section className="login-shell" aria-label="Frighton University student portal">
        <div className="brand-lockup">
          <div className="university-mark" aria-hidden="true">
            <span>F</span>
            <small>1912</small>
          </div>
          <div className="brand-copy">
            <p className="eyebrow">FRIGHTON UNIVERSITY</p>
            <p className="brand-name">Student Information System</p>
          </div>
        </div>

        <div className="login-card">
          {user ? (
            <div className="signed-in-state">
              <div className="success-icon"><ShieldCheck size={28} /></div>
              <p className="eyebrow">AUTHENTICATED</p>
              <h1>Welcome, {user.fullName || 'Frighton student'}.</h1>
              <p className="supporting-copy">You are signed in as a {user.role}. Your SIS session is active.</p>
              <button className="submit-button" type="button" onClick={() => setUser(null)}>
                Continue to SIS <ArrowRight size={17} />
              </button>
            </div>
          ) : (
            <>
              <div className="card-heading">
                <p className="eyebrow">STUDENT PORTAL</p>
                <h1>Sign in to your account</h1>
                <p className="supporting-copy">Access your classes, academic records, and university services.</p>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <label htmlFor="email">University email</label>
                <div className="input-wrap">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@frighton.edu"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="label-row">
                  <label htmlFor="password">Password</label>
                  <a href="mailto:helpdesk@frighton.edu?subject=SIS%20password%20help">Need help?</a>
                </div>
                <div className="input-wrap">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <label className="remember-me">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span className="custom-checkbox" aria-hidden="true" />
                  Keep me signed in
                </label>

                {error && <p className="error-message" role="alert">{error}</p>}

                <button className="submit-button" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                  {!isSubmitting && <ArrowRight size={17} />}
                </button>
              </form>

              <p className="access-note">For active Frighton University students and administrators. Contact the University Help Desk if you need assistance.</p>
            </>
          )}
        </div>

        <p className="footer-note"><span className="footer-dot" /> Secure university access <span className="footer-divider">|</span> © 2026 Frighton University</p>
      </section>
    </main>
  );
}

export default App;
