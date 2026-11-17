import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { libraryDatabase } from './databaseHarness.js';
import { cleanupSetupStudentAccounts } from '../src/scripts/setupStudentAccounts.js';
import { students } from '../src/seed-data/students.js';

test('setup cleanup respects real SIS foreign keys and preserves LMS history and staff', async (t) => {
  const db = await libraryDatabase();
  const args = process.argv, ref = process.env.SISLMS_SUPABASE_PROJECT_REF, url = process.env.SUPABASE_URL;
  const manual = '11111111-1111-4111-8111-111111111111';
  const seeded = '22222222-2222-4222-8222-222222222222';
  const staff = '33333333-3333-4333-8333-333333333333';
  const book = '44444444-4444-4444-8444-444444444444';
  const blocked = '55555555-5555-4555-8555-555555555555';
  const removedAuth: string[] = [];
  t.mock.method(console, 'log', () => {});
  const identifier = (value: string) => { assert.match(value, /^[a-z_]+$/); return value; };
  const client = {
    from(table: string) {
      identifier(table);
      let columns = '*', deleting = false, head = false, offset = 0, limit = 10000, ordering = '';
      const filters: Array<{ column: string; operator: string; value: unknown }> = [];
      let alternatives: Array<{ column: string; value: string }> = [];
      const execute = async () => {
        const values: unknown[] = [];
        const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
        const where = filters.map(filter => `${identifier(filter.column)} ${filter.operator} ${bind(filter.value)}`);
        if (alternatives.length) where.push(`(${alternatives.map(filter => `${identifier(filter.column)}=${bind(filter.value)}`).join(' OR ')})`);
        const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        try {
          const sql = deleting ? `DELETE FROM public.${table}${condition} RETURNING *`
            : `SELECT ${columns} FROM public.${table}${condition}${ordering} LIMIT ${limit} OFFSET ${offset}`;
          const result = await db.query(sql, values);
          return { data: result.rows, count: head || deleting ? result.rows.length : null, error: null };
        } catch (error) { return { data: null, count: null, error: { code: (error as { code?: string }).code } }; }
      };
      const q: any = {
        select(value: string, options?: { head?: boolean }) { value.split(',').forEach(identifier); columns = value; head = Boolean(options?.head); return q; },
        eq(column: string, value: unknown) { filters.push({ column, operator: '=', value }); return q; },
        ilike(column: string, value: string) { filters.push({ column, operator: 'ILIKE', value }); return q; },
        order(column: string) { ordering = ` ORDER BY ${identifier(column)}`; return q; },
        range(start: number, end: number) { offset = start; limit = end - start + 1; return q; },
        or(value: string) { alternatives = value.split(',').map(part => { const [column, expected] = part.split('.eq.'); return { column, value: expected }; }); return q; },
        delete() { deleting = true; return q; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve: any) { return execute().then(resolve); },
      };
      return q;
    },
    async rpc(name: string, params: { p_student_id: string }) {
      if (name === 'sis_setup_student_account') {
        const args = params as typeof params & { p_email: string; p_apply: boolean };
        try {
          const result = await db.query<{ result: unknown }>('SELECT public.sis_setup_student_account($1,$2,$3) AS result',
            [args.p_student_id, args.p_email, args.p_apply]);
          return { data: result.rows[0].result, error: null };
        } catch (error) { return { data: null, error: { code: (error as { code?: string }).code } }; }
      }
      assert.equal(name, 'sis_account_diagnostics');
      return { data: { authCandidates: [{ id: params.p_student_id, emailMatchesDirectory: true, emailMatchesProfile: true }] }, error: null };
    },
    auth: { admin: {
      async getUserById(id: string) {
        const result = await db.query<{ email: string }>('SELECT email FROM users WHERE users_id=$1', [id]);
        return { data: { user: { id, email: result.rows[0].email } }, error: null };
      },
      async deleteUser(id: string) { removedAuth.push(id); await db.query('DELETE FROM auth.users WHERE id=$1', [id]); return { error: null }; },
    } },
  } as unknown as SupabaseClient;
  try {
    process.argv = [...args, '--confirm']; process.env.SISLMS_SUPABASE_PROJECT_REF = 'setup-test';
    process.env.SUPABASE_URL = 'https://setup-test.supabase.co';
    // The shared library fixture starts from the older LMS schema. Apply the
    // actual SIS profile-FK alignment before testing the SIS setup lifecycle.
    const alignment = await readFile(new URL('../../supabase/migrations/20261020155029_sis_link_profiles_to_shared_users.sql', import.meta.url), 'utf8');
    await db.exec(alignment.slice(0, alignment.indexOf('-- The shared public.users')));
    await db.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);');
    await db.exec(await readFile(new URL('../../supabase/migrations/20261117000000_setup_student_account_cleanup.sql', import.meta.url), 'utf8'));
    await db.query(`INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES
      ($1,'Manual','Student','manual@test.invalid','x','Students'),
      ($2,'Seeded','Student',$4,'x','Students'),($3,'Library','Staff','staff@test.invalid','x','Librarian')`,
    [manual, seeded, staff, students[0].email]);
    await db.query(`INSERT INTO profiles(id,student_number,first_name,last_name,email) VALUES
      ($1,'MANUAL-1','Manual','Student','manual@test.invalid'),($2,'SEEDED-1','Seeded','Student',$3)`, [manual, seeded, students[0].email]);
    await db.query('INSERT INTO sis_library_debt_state(student_id) VALUES($1)', [manual]);
    await db.exec('INSERT INTO auth.users(id,email) SELECT users_id,email FROM users;');
    // The worker publishes zero-debt snapshots even for students with no loans.
    await db.query('SELECT refresh_library_debt($1)', [manual]);
    await db.query("INSERT INTO books(books_id,title,author,copies) VALUES($1,'Preserved book','Author',2)", [book]);
    await db.query("SELECT borrow_book('SEEDED-1',$1,$2)", [book, staff]);
    const preserved = ['books', 'borrow_records', 'reservations', 'library_replacement_charges', 'library_debt_outbox'];
    const snapshots = await Promise.all(preserved.map(async table => (await db.query(`SELECT * FROM ${table}`)).rows
      .filter((row: any) => table !== 'library_debt_outbox' || row.student_id !== manual)));
    const preview = async () => (await db.query<{ result: { ready: boolean; reason?: string } }>(
      'SELECT sis_setup_student_account($1,$2,false) AS result', [manual, 'manual@test.invalid'])).rows[0].result;
    await db.exec('CREATE TABLE public.extra_account_history(student_id uuid REFERENCES public.users(users_id) ON DELETE CASCADE);');
    await db.query('INSERT INTO extra_account_history(student_id) VALUES($1)', [manual]);
    assert.equal((await preview()).reason, 'linked_records', 'New FK tables are protected without editing the CLI');
    await db.exec('DROP TABLE extra_account_history;');
    await db.query("UPDATE library_debt_outbox SET payload=payload||'{\"amount\":10,\"qualifyingDebtCount\":1}' WHERE student_id=$1", [manual]);
    assert.equal((await preview()).reason, 'outbox_nonzero');
    await db.query('SELECT refresh_library_debt($1)', [manual]);
    await db.query("UPDATE library_debt_outbox SET locked_until=now()+interval '1 minute',claim_token=gen_random_uuid() WHERE student_id=$1", [manual]);
    assert.equal((await preview()).reason, 'outbox_in_flight');
    assert.equal(removedAuth.length, 0);
    await db.query('UPDATE library_debt_outbox SET locked_until=NULL,claim_token=NULL WHERE student_id=$1', [manual]);
    assert.equal((await preview()).ready, true);
    const authGuard = await db.query<{ result: { reason: string } }>('SELECT sis_setup_student_account($1,$2,true) AS result', [manual, 'manual@test.invalid']);
    assert.equal(authGuard.rows[0].result.reason, 'auth_still_exists');
    assert.equal((await db.query('SELECT * FROM library_debt_outbox WHERE student_id=$1', [manual])).rows.length, 1, 'Preview/rejected apply leave sync work intact');
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.sis_setup_student_account(uuid,text,boolean)','EXECUTE') AS allowed")).rows[0].allowed, false);
    await assert.rejects(db.query('DELETE FROM users WHERE users_id=$1', [manual]), /foreign key/i,
      'SIS debt state must be cleared before the users -> profiles cascade');
    assert.equal(await cleanupSetupStudentAccounts(client), 1);
    assert.deepEqual(removedAuth, [manual]);
    assert.equal((await db.query('SELECT * FROM users WHERE users_id=$1', [manual])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM profiles WHERE id=$1', [manual])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM sis_library_debt_state WHERE student_id=$1', [manual])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM library_debt_outbox WHERE student_id=$1', [manual])).rows.length, 0, 'Only the removed account zero-debt snapshot is discarded');
    assert.equal((await db.query('SELECT * FROM users')).rows.length, 2, 'Seeded borrower and librarian remain');
    for (const [index, table] of preserved.entries()) assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows, snapshots[index], `${table} unchanged`);

    await db.query("INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES($1,'Blocked','Student','blocked@test.invalid','x','Students')", [blocked]);
    await db.query("INSERT INTO profiles(id,student_number,first_name,last_name,email) VALUES($1,'BLOCKED-1','Blocked','Student','blocked@test.invalid')", [blocked]);
    await db.query("SELECT create_reservation('BLOCKED-1',$1,$2)", [book, staff]);
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'blocked@test.invalid')", [blocked]);
    await assert.rejects(cleanupSetupStudentAccounts(client), /linked reservations/);
    assert.deepEqual(removedAuth, [manual], 'Linked student Auth was never deleted');
    assert.equal((await db.query('SELECT * FROM users WHERE users_id=$1', [blocked])).rows.length, 1);
  } finally {
    process.argv = args;
    if (ref === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF; else process.env.SISLMS_SUPABASE_PROJECT_REF = ref;
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    await db.close();
  }
});
