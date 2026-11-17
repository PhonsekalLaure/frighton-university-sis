import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupSetupStudentAccounts } from '../src/scripts/setupStudentAccounts.js';
import { setupSISDatabase } from '../src/scripts/setup.js';
import { students } from '../src/seed-data/students.js';

const manual = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const seeded = '33333333-3333-4333-8333-333333333333';
const admin = '44444444-4444-4444-8444-444444444444';
const librarian = '55555555-5555-4555-8555-555555555555';
const legacyAuth = '66666666-6666-4666-8666-666666666666';
const outside = '77777777-7777-4777-8777-777777777777';
type Row = Record<string, any>;

function fixture() {
  const rows = [
    { users_id: manual, email: 'manual@example.invalid', role: 'Students' },
    { users_id: second, email: 'second@example.invalid', role: 'student' },
    { users_id: seeded, email: students[0].email, role: 'Students' },
    { users_id: admin, email: 'admin@example.invalid', role: 'Admin' },
    { users_id: librarian, email: 'librarian@example.invalid', role: 'Librarian' },
    { users_id: outside, email: 'lms-only@example.invalid', role: 'Students' },
  ];
  const directory = new Map(rows.map(row => [row.users_id, { ...row }]));
  // Stale staff profiles are included to prove the shared role prevents deletion.
  const profiles = new Map(rows.filter(row => row.users_id !== outside).map(row => [row.users_id,
    { id: row.users_id, email: row.email, role: 'student' }]));
  const identities = new Map(rows.map(row => [row.users_id, { id: row.users_id, email: row.email }]));
  const mutations: string[] = [], reads: string[] = [];
  const controls = { blockedTable: '', blockedStudent: second, readErrorTable: '', guardMissing: false, diagnosticError: false,
    authRejected: false, authThrows: false, directoryRejected: false, beforeRecheck: undefined as undefined | (() => void) };
  const client = {
    from(table: string) {
      reads.push(table);
      const filters = new Map<string, unknown>();
      let emailPattern = '', start = 0, end = Number.MAX_SAFE_INTEGER;
      const selected = () => [...(table === 'profiles' ? profiles : directory).values()].filter(row =>
        [...filters].every(([column, value]) => row[column] === value) &&
        (!emailPattern || row.email.toLowerCase() === emailPattern.toLowerCase()));
      const q: any = {
        select() { return q; },
        eq(column: string, value: unknown) { filters.set(column, value); return q; },
        ilike(_column: string, value: string) { emailPattern = value.replace(/\\([\\%_])/g, '$1'); return q; },
        order() { return q; }, range(first: number, last: number) { start = first; end = last; return q; },
        async maybeSingle() {
          if (table === 'profiles' && filters.has('id') && controls.beforeRecheck) {
            const mutate = controls.beforeRecheck; controls.beforeRecheck = undefined; mutate();
          }
          return { data: selected()[0] ?? null, error: null };
        },
        then(resolve: any) {
          if (controls.readErrorTable === table) return Promise.resolve({ data: null, error: { code: '08006' } }).then(resolve);
          return Promise.resolve({ data: selected().slice(start, end + 1), error: null }).then(resolve);
        },
      };
      return q;
    },
    async rpc(name: string, params: Row) {
      if (name === 'sis_setup_student_account') {
        if (controls.guardMissing || controls.readErrorTable === 'guard') return { data: null, error: { code: 'PGRST202' } };
        if (controls.blockedTable && controls.blockedStudent === params.p_student_id) return {
          data: { ready: false, reason: 'linked_records', table: controls.blockedTable }, error: null,
        };
        if (params.p_apply) {
          if (controls.directoryRejected) return { data: null, error: { code: '42501' } };
          assert(![...identities.values()].some(identity => identity.email === params.p_email), 'Auth deletion must precede SQL deletion');
          mutations.push(`debt:${params.p_student_id}`, `directory:${params.p_student_id}`);
          directory.delete(params.p_student_id); profiles.delete(params.p_student_id);
        }
        return { data: { ready: true, deleted: params.p_apply }, error: null };
      }
      assert.equal(name, 'sis_account_diagnostics');
      const profile = profiles.get(params.p_student_id), account = directory.get(params.p_student_id);
      const authCandidates = [...identities.values()].filter(identity => identity.id === params.p_student_id ||
        identity.email.toLowerCase() === account?.email.toLowerCase()).map(identity => ({ id: identity.id,
        emailMatchesDirectory: identity.email.toLowerCase() === account?.email.toLowerCase(),
        emailMatchesProfile: identity.email.toLowerCase() === profile?.email.toLowerCase() }));
      return { data: { authCandidates }, error: controls.diagnosticError ? {} : null };
    },
    auth: { admin: {
      getUserById: async (id: string) => ({ data: { user: identities.get(id) }, error: null }),
      deleteUser: async (id: string) => {
        mutations.push(`auth:${id}`);
        if (controls.authThrows) throw new Error('PRIVATE_PROVIDER_DETAIL');
        if (controls.authRejected) return { error: { message: 'PRIVATE_PROVIDER_DETAIL' } };
        identities.delete(id); return { error: null };
      },
    } },
  } as unknown as SupabaseClient;
  return { client, directory, profiles, identities, mutations, reads, controls };
}

async function confirmed<T>(work: () => Promise<T>): Promise<T> {
  const args = process.argv, ref = process.env.SISLMS_SUPABASE_PROJECT_REF, url = process.env.SUPABASE_URL;
  process.argv = [...args, '--confirm'];
  process.env.SISLMS_SUPABASE_PROJECT_REF = 'setup-test'; process.env.SUPABASE_URL = 'https://setup-test.supabase.co';
  try { return await work(); }
  finally {
    process.argv = args;
    if (ref === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF; else process.env.SISLMS_SUPABASE_PROJECT_REF = ref;
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
  }
}

test('setup account removal requires confirmation and a matching project before any reads or writes', async () => {
  const f = fixture();
  await assert.rejects(cleanupSetupStudentAccounts(f.client), /requires confirmed SIS setup/);
  await confirmed(async () => {
    process.env.SISLMS_SUPABASE_PROJECT_REF = 'different';
    await assert.rejects(cleanupSetupStudentAccounts(f.client), /Refusing to run/);
  });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.mutations, []);
});

test('setup removes only non-seeded SIS students and resolves distinct legacy Auth IDs', async (t) => confirmed(async () => {
  t.mock.method(console, 'log', () => {});
  const f = fixture();
  const identity = f.identities.get(second)!;
  f.identities.delete(second); f.identities.set(legacyAuth, { ...identity, id: legacyAuth });
  assert.equal(await cleanupSetupStudentAccounts(f.client), 2);
  for (const id of [manual, second]) { assert(!f.directory.has(id)); assert(!f.profiles.has(id)); }
  for (const id of [seeded, admin, librarian, outside]) { assert(f.directory.has(id)); assert(f.identities.has(id)); }
  assert(!f.identities.has(manual)); assert(!f.identities.has(legacyAuth));
  assert.deepEqual(f.mutations.filter(name => name.startsWith('auth:')), [`auth:${manual}`, `auth:${legacyAuth}`]);
  assert.equal(await cleanupSetupStudentAccounts(f.client), 0, 'Repeating completed cleanup is harmless');
}));

test('a borrower, reservation, replacement charge or staff-invitation link blocks the entire cleanup batch', async () => confirmed(async () => {
  for (const table of ['borrow_records', 'reservations', 'library_replacement_charges', 'staff_invitations']) {
    const f = fixture(); f.controls.blockedTable = table;
    await assert.rejects(cleanupSetupStudentAccounts(f.client), new RegExp(`linked ${table}`));
    assert.deepEqual(f.mutations, [], 'The earlier eligible student must also remain untouched');
  }
}));

test('ambiguous or unavailable identity evidence stops setup without deleting accounts', async () => confirmed(async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.profiles.get(manual)!.email = 'different@example.invalid'; },
    (f: ReturnType<typeof fixture>) => { f.directory.get(outside)!.email = f.directory.get(manual)!.email; },
    (f: ReturnType<typeof fixture>) => { f.identities.get(manual)!.email = 'different@example.invalid'; },
    (f: ReturnType<typeof fixture>) => { f.controls.diagnosticError = true; },
    (f: ReturnType<typeof fixture>) => {
      const identity = f.identities.get(manual)!; f.identities.delete(manual); f.identities.set(outside, { ...identity, id: outside });
    },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(cleanupSetupStudentAccounts(f.client), /SIS setup stopped/);
    assert.deepEqual(f.mutations, []);
  }
}));

test('unavailable reads or an unapplied cleanup migration block deletion before Auth changes', async (t) => confirmed(async () => {
  t.mock.method(console, 'log', () => {});
  for (const table of ['profiles', 'guard']) {
    const f = fixture(); f.controls.readErrorTable = table;
    await assert.rejects(cleanupSetupStudentAccounts(f.client), /could not (read|verify)/);
    assert.deepEqual(f.mutations, []);
  }
  const f = fixture(); f.controls.guardMissing = true;
  await assert.rejects(cleanupSetupStudentAccounts(f.client), /Apply the setup-account cleanup migration/);
  assert.deepEqual(f.mutations, []);
}));

test('a role change after preflight cannot delete a newly promoted staff account', async () => confirmed(async () => {
  const f = fixture();
  f.controls.beforeRecheck = () => { f.directory.get(manual)!.role = 'Admin'; };
  await assert.rejects(cleanupSetupStudentAccounts(f.client), /ownership changed/);
  assert.deepEqual(f.mutations, []);
}));

test('Auth rejection keeps the directory/profile, and a later SQL failure can be resumed without orphaning ownership evidence', async (t) => confirmed(async () => {
  t.mock.method(console, 'log', () => {});
  const rejected = fixture(); rejected.controls.authRejected = true;
  await assert.rejects(cleanupSetupStudentAccounts(rejected.client), error => error instanceof Error &&
    /Auth deletion could not be confirmed/.test(error.message) && !error.message.includes('PRIVATE'));
  assert(rejected.directory.has(manual)); assert(rejected.profiles.has(manual)); assert(rejected.identities.has(manual));
  assert.equal(rejected.mutations.length, 1);
  const thrown = fixture(); thrown.controls.authThrows = true;
  await assert.rejects(cleanupSetupStudentAccounts(thrown.client), error => error instanceof Error &&
    /Auth deletion could not be confirmed/.test(error.message) && !error.message.includes('PRIVATE'));
  assert(thrown.directory.has(manual)); assert(thrown.profiles.has(manual));
  const retry = fixture(); retry.controls.directoryRejected = true;
  await assert.rejects(cleanupSetupStudentAccounts(retry.client), /student record deletion could not be confirmed/);
  assert(!retry.identities.has(manual)); assert(retry.directory.has(manual)); assert(retry.profiles.has(manual));
  retry.controls.directoryRejected = false;
  assert.equal(await cleanupSetupStudentAccounts(retry.client), 2);
  assert.equal(retry.mutations.filter(name => name === `auth:${manual}`).length, 1);
}));

test('setup cleans accounts before reset and seed, and stops immediately if either destructive stage fails', async (t) => confirmed(async () => {
  t.mock.method(console, 'log', () => {});
  for (const failAt of ['', 'cleanup', 'reset']) {
    const calls: string[] = [];
    const step = async (name: string) => { calls.push(name); if (failAt === name) throw new Error('Test failure'); };
    const work = setupSISDatabase({ cleanup: async () => { await step('cleanup'); return 2; },
      reset: () => step('reset'), seed: () => step('seed') });
    if (failAt) await assert.rejects(work, /Test failure/); else await work;
    assert.deepEqual(calls, failAt === 'cleanup' ? ['cleanup'] : failAt === 'reset' ? ['cleanup', 'reset'] : ['cleanup', 'reset', 'seed']);
  }
}));
