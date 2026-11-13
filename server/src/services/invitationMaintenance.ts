import { getAdminPortalClient } from '../config/supabase.js';

/** Marks interrupted sends uncertain. It never generates a link or sends email. */
export function startInvitationMaintenance() {
  let running = false;
  const clean = async () => {
    if (running) return;
    running = true;
    try {
      const { error } = await getAdminPortalClient().rpc('sis_expire_invitation_claims');
      if (error) throw new Error('Cleanup unavailable');
    } catch { console.error('SIS invitation claim cleanup unavailable. Check migration and database access.'); }
    finally { running = false; }
  };
  void clean();
  const timer = setInterval(() => { void clean(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
