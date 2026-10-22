import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react';
import type { SignedInUser } from '../types/dashboard';

export function AdminHandoffPage({ user, onLogout }: { user: SignedInUser; onLogout: () => void }) {
  return <main className="admin-handoff-page"><section className="admin-handoff-card"><div className="admin-handoff-icon"><ShieldCheck size={31} /></div><p className="eyebrow">ADMINISTRATOR ACCESS</p><h1>Welcome, {user.fullName || 'Administrator'}.</h1><p className="supporting-copy">You are signed in successfully. Student self-service pages are intentionally unavailable to administrator accounts.</p><div className="admin-handoff-note"><ArrowRight size={18} /><span>The separate administrator console is not available in this SIS portal yet. Please use the designated administration service.</span></div><button className="logout-button" type="button" onClick={onLogout}><LogOut size={16} />Sign out</button></section></main>;
}
