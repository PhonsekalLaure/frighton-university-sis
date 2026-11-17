import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { admins } from '../seed-data/admins.js';
import { students } from '../seed-data/students.js';
import { assertSISLMSProject } from './projectGuard.js';

interface Profile { id: string; email: string; role: string; }
interface Target { profile: Profile; directoryEmail: string; directoryRole: string; authId: string | null; }
const protectedEmails = new Set([...students, ...admins].map(account => account.email.toLowerCase()));
const normalize = (value: string) => value.trim().toLowerCase();
const isStudent = (role: string) => ['student', 'students'].includes(normalize(role));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(id: string, reason: string): Error {
  return new Error(`SIS setup stopped for student ${id}: ${reason}`);
}

async function guardedStudentAccount(client: SupabaseClient, id: string, email: string, apply = false): Promise<void> {
  const { data, error } = await client.rpc('sis_setup_student_account', { p_student_id: id, p_email: email, p_apply: apply });
  if (error || !data) throw failure(id, apply ? 'student record deletion could not be confirmed. Setup is incomplete.'
    : 'could not verify account dependencies. Apply the setup-account cleanup migration before retrying.');
  if (!data.ready) {
    const table = typeof data.table === 'string' && /^[a-z_]+$/.test(data.table) ? data.table : 'shared';
    const message = data.reason === 'linked_records' ? `linked ${table} records require review. LMS/shared history has not been deleted.`
      : data.reason === 'outbox_nonzero' ? 'library_debt_outbox contains non-zero or unverified debt. LMS review is required.'
        : data.reason === 'outbox_in_flight' ? 'library_debt_outbox has an active worker claim. Stop the LMS worker and wait for its claim to expire.'
          : data.reason === 'schema_not_ready' ? 'the SIS profile-key migration is required before account cleanup.'
            : 'account ownership or shared dependencies changed. Review this account before retrying setup.';
    throw failure(id, message);
  }
  if (apply && data.deleted !== true) throw failure(id, 'student record deletion could not be confirmed. Setup is incomplete.');
}

async function inspect(client: SupabaseClient, profile: Profile): Promise<Target | null> {
  if (!uuidPattern.test(profile.id)) throw new Error('SIS setup found an invalid student identifier.');
  if (profile.role !== 'student' || protectedEmails.has(normalize(profile.email))) return null;
  const { data: directory, error } = await client.from('users').select('users_id,email,role')
    .eq('users_id', profile.id).maybeSingle();
  if (error || !directory) throw failure(profile.id, 'the shared directory record could not be verified.');
  // A stale/corrupt SIS profile must never turn staff into deletion targets.
  if (!isStudent(directory.role) || protectedEmails.has(normalize(directory.email))) return null;
  if (normalize(directory.email) !== normalize(profile.email)) throw failure(profile.id, 'profile and directory emails differ.');
  const email = directory.email.replace(/[\\%_]/g, '\\$&');
  const { data: matches, error: matchesError } = await client.from('users').select('users_id').ilike('email', email);
  if (matchesError || matches?.length !== 1 || matches[0].users_id !== profile.id) {
    throw failure(profile.id, 'the login email is shared or ambiguous.');
  }
  // Diagnostics resolve legacy Auth UUIDs by verified directory/profile email;
  // this deliberately avoids listing all Auth users or assuming UUID equality.
  const { data: diagnostic, error: diagnosticError } = await client.rpc('sis_account_diagnostics', {
    p_student_id: profile.id, p_operation_id: null,
  });
  if (diagnosticError || !Array.isArray(diagnostic?.authCandidates)) throw failure(profile.id, 'Auth diagnostics are unavailable.');
  const candidates = diagnostic.authCandidates as Array<{ id: string; emailMatchesDirectory: boolean; emailMatchesProfile: boolean }>;
  if (candidates.length > 1 || candidates.some(candidate => !candidate.emailMatchesDirectory || !candidate.emailMatchesProfile)) {
    throw failure(profile.id, 'Auth identity ownership is ambiguous.');
  }
  let authId: string | null = null;
  if (candidates.length) {
    const candidate = candidates[0];
    if (!uuidPattern.test(candidate.id)) throw failure(profile.id, 'the Auth identifier is invalid.');
    let identity;
    try {
      const { data, error: authError } = await client.auth.admin.getUserById(candidate.id);
      if (authError) throw authError;
      identity = data.user;
    } catch { throw failure(profile.id, 'the Auth identity could not be verified.'); }
    if (!identity || identity.id !== candidate.id || !identity.email ||
      normalize(identity.email) !== normalize(directory.email)) throw failure(profile.id, 'the Auth identity changed or could not be verified.');
    if (candidate.id !== profile.id) {
      const { data: otherAccount, error: otherError } = await client.from('users').select('users_id')
        .eq('users_id', candidate.id).maybeSingle();
      if (otherError || otherAccount) throw failure(profile.id, 'the Auth identifier is attached to another directory account.');
    }
    authId = identity.id;
  }
  await guardedStudentAccount(client, profile.id, directory.email);
  return { profile, directoryEmail: directory.email, directoryRole: directory.role, authId };
}

/** Setup-only cleanup; standalone reset continues to preserve shared identities. */
export async function cleanupSetupStudentAccounts(injectedClient?: SupabaseClient): Promise<number> {
  if (!process.argv.includes('--confirm')) throw new Error('Student account deletion requires confirmed SIS setup.');
  assertSISLMSProject();
  const client = injectedClient ?? getSupabaseAdmin();
  const targets: Target[] = [];
  // Preflight the entire batch before the first destructive action. A linked
  // borrower or identity mismatch must not leave an otherwise untouched reset.
  for (let start = 0; ; start += 500) {
    const { data, error } = await client.from('profiles').select('id,email,role')
      .eq('role', 'student').order('id').range(start, start + 499);
    if (error || !data) throw new Error('SIS setup could not read student profiles. No accounts have been removed.');
    for (const profile of data as Profile[]) {
      const target = await inspect(client, profile);
      if (target) targets.push(target);
    }
    if (data.length < 500) break;
  }
  for (const prepared of targets) {
    const { data: profile, error: profileError } = await client.from('profiles').select('id,email,role')
      .eq('id', prepared.profile.id).maybeSingle();
    if (profileError || !profile || profile.email !== prepared.profile.email) throw failure(prepared.profile.id, 'the profile changed during setup.');
    const current = await inspect(client, profile as Profile);
    if (!current || current.authId !== prepared.authId || current.directoryEmail !== prepared.directoryEmail ||
      current.directoryRole !== prepared.directoryRole) throw failure(prepared.profile.id, 'account ownership changed during setup.');
    if (current.authId) {
      try {
        const { error } = await client.auth.admin.deleteUser(current.authId);
        if (error) throw error;
      } catch { throw failure(profile.id, 'Auth deletion could not be confirmed. Review this account before retrying setup.'); }
    }
    // Keep the profile until directory deletion: if Auth deletion succeeded but
    // a later SQL call fails, a retry can still establish SIS student ownership.
    // The database rechecks every FK and the outbox lease with its own clock,
    // then removes the empty sync entry and directory/profile atomically.
    await guardedStudentAccount(client, profile.id, current.directoryEmail, true);
  }
  console.log(`Removed ${targets.length} non-seeded SIS student accounts and their login identities.`);
  return targets.length;
}
