import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resetSISData } from '../src/scripts/reset.js';
import { libraryDatabase } from './databaseHarness.js';

test('SIS reset handles synchronized debt and preserves shared identities and LMS history', async (t) => {
  const db = await libraryDatabase();
  const previousArgs = [...process.argv];
  const previousRef = process.env.SISLMS_SUPABASE_PROJECT_REF;
  const previousUrl = process.env.SUPABASE_URL;
  const student = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const staff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const book = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const deletions: string[] = [];
  let failDebtDelete = false;
  // Only DELETE ... primary_key IS NOT NULL is implemented. The production
  // reset executes unchanged, against real FK constraints and service grants.
  const client = {
    from: (table: string) => ({
      delete: () => ({
        not: async (column: string, operator: string, value: unknown) => {
          assert.match(table, /^[a-z_]+$/);
          assert.match(column, /^[a-z_]+$/);
          assert.equal(operator, 'is');
          assert.equal(value, null);
          deletions.push(table);
          if (failDebtDelete && table === 'sis_library_debt_state') {
            return { count: null, error: { message: 'Debt state unavailable' } };
          }
          try {
            const result = await db.query(`DELETE FROM public.${table} WHERE ${column} IS NOT NULL RETURNING *`);
            return { count: result.rows.length, error: null };
          } catch (error) {
            return { count: null, error: { message: (error as Error).message } };
          }
        },
      }),
    }),
  } as unknown as SupabaseClient;
  t.mock.method(console, 'log', () => {});
  try {
    await db.exec(`
      INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES
        ('${staff}','Library','Staff','reset-staff@test','x','Librarian'),
        ('${student}','Reset','Student','reset-student@test','x','Students');
      INSERT INTO profiles(id,student_number,first_name,last_name,email)
        VALUES('${student}','RESET-1','Reset','Student','reset-student@test');
      INSERT INTO books(books_id,title,author,copies) VALUES('${book}','Reset test','Author',2);
      SELECT create_self_service_reservation('RESET-1','${book}');
      SELECT borrow_book('RESET-1','${book}','${staff}');
      SELECT record_library_replacement('RESET-1','Replacement',100,NULL,'${staff}');
      INSERT INTO academic_terms(code,name,start_date,end_date) VALUES('RESET','Reset term','2026-01-01','2026-06-01');
      INSERT INTO courses(course_code,title,credits,department) VALUES('RESET','Reset course',3,'Test');
      INSERT INTO course_sections(course_id,term_id)
        SELECT c.id,t.id FROM courses c CROSS JOIN academic_terms t;
      INSERT INTO academic_records(student_id,section_id)
        SELECT '${student}',id FROM course_sections;
      INSERT INTO student_accounts(student_id,term_id) SELECT '${student}',id FROM academic_terms;
      INSERT INTO student_payments(account_id,amount,reference_number)
        SELECT id,100,'RESET-PAYMENT' FROM student_accounts;
      SELECT apply_library_debt('RESET-1',1,1,100,'Replacement charge');
      SET ROLE service_role;
    `);
    const preserved = ['users', 'books', 'borrow_records', 'reservations', 'library_replacement_charges', 'library_debt_outbox'];
    const snapshots = await Promise.all(preserved.map(async (table) => (await db.query(`SELECT * FROM ${table}`)).rows));
    assert.ok(snapshots.every((rows) => rows.length > 0), 'every preserved table has real fixture data');
    process.env.SISLMS_SUPABASE_PROJECT_REF = 'reset-test';
    process.env.SUPABASE_URL = 'https://reset-test.supabase.co';

    process.argv = previousArgs.filter((arg) => arg !== '--confirm');
    await assert.rejects(resetSISData(client), /Re-run with/);
    assert.deepEqual(deletions, []);
    process.argv.push('--confirm');
    process.env.SUPABASE_URL = 'https://wrong-project.supabase.co';
    await assert.rejects(resetSISData(client), /Refusing to run against project/);
    assert.deepEqual(deletions, []);
    process.env.SUPABASE_URL = 'https://reset-test.supabase.co';

    failDebtDelete = true;
    await assert.rejects(resetSISData(client), /Failed to clear sis_library_debt_state: Debt state unavailable/);
    assert.deepEqual(deletions, ['sis_library_debt_state']);
    assert.equal((await db.query('SELECT * FROM academic_records')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM profiles')).rows.length, 1);
    failDebtDelete = false;
    deletions.length = 0;

    await resetSISData(client);
    const resetTables = [...deletions];
    assert.equal(resetTables[0], 'sis_library_debt_state');
    for (const table of resetTables) {
      assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0, `${table} is cleared`);
    }
    for (const [i, table] of preserved.entries()) {
      assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows, snapshots[i], `${table} is unchanged`);
    }
    await resetSISData(client); // An empty/repeated reset also succeeds.
    // Setup can recreate the same SIS profile and receive a fresh authoritative
    // snapshot without deleting/recreating the shared LMS borrower identity.
    await db.exec(`RESET ROLE;
      INSERT INTO profiles(id,student_number,first_name,last_name,email)
        VALUES('${student}','RESET-1','Reset','Student','reset-student@test');
      SELECT apply_library_debt('RESET-1',2,1,100,'Replacement charge');`);
    assert.equal((await db.query('SELECT version FROM sis_library_debt_state')).rows[0].version, 2);
    assert.equal((await db.query('SELECT * FROM student_holds WHERE resolved_at IS NULL')).rows.length, 1);
  } finally {
    process.argv = previousArgs;
    if (previousRef === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF;
    else process.env.SISLMS_SUPABASE_PROJECT_REF = previousRef;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    await db.close();
  }
});
