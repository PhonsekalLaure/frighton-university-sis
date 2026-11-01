import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedDatabase } from '../src/scripts/seed.js';
import { admins } from '../src/seed-data/admins.js';
import { students } from '../src/seed-data/students.js';
import { terms } from '../src/seed-data/terms.js';
import { courses } from '../src/seed-data/courses.js';
import { sections } from '../src/seed-data/sections.js';

test('first and repeat seeds keep admins in users and student data restricted to ten students', async (t) => {
  // Exercise the whole seeder without a database or password output.
  t.mock.method(console, 'log', () => {});
  const directory = new Map<string, Record<string, any>>();
  const identities = new Map<string, { id: string }>();
  const writes: Array<{ table: string; rows: Record<string, any>[] }> = [];
  let created = 0;
  let updated = 0;
  const client = {
    auth: { admin: {
      createUser: async () => {
        const user = { id: `auth-${++created}` };
        identities.set(user.id, user);
        return { data: { user }, error: null };
      },
      getUserById: async (id: string) => ({ data: { user: identities.get(id) }, error: null }),
      updateUserById: async (id: string) => {
        updated++;
        return { data: { user: identities.get(id) }, error: null };
      },
    } },
    from: (table: string) => {
      let email = '';
      let result: any = null;
      const q: any = {
        upsert: (rows: any) => {
          const values = Array.isArray(rows) ? rows : [rows];
          writes.push({ table, rows: values });
          if (table === 'users') for (const row of values) directory.set(row.email, row);
          if (table === 'student_accounts') result = { id: `account-${writes.length}` };
          return q;
        },
        insert: (row: any) => { writes.push({ table, rows: [row] }); return q; },
        select: () => {
          if (table === 'academic_terms') result = terms.map(term => ({ id: term.code, code: term.code }));
          if (table === 'courses') result = courses.map(course => ({ id: course.courseCode, course_code: course.courseCode }));
          if (table === 'course_sections') result = sections.map((section, i) => ({
            id: `section-${i}`, section_number: section.sectionNumber, term_id: section.termCode,
            course: { course_code: section.courseCode },
          }));
          return q;
        },
        eq: (column: string, value: string) => { if (column === 'email') email = value; return q; },
        maybeSingle: async () => ({ data: table === 'users' ? directory.get(email) ?? null : null, error: null }),
        single: async () => ({ data: result, error: null }),
        then: (resolve: any) => Promise.resolve({ data: result, error: null }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;

  const previousRef = process.env.SISLMS_SUPABASE_PROJECT_REF;
  const previousUrl = process.env.SUPABASE_URL;
  process.env.SISLMS_SUPABASE_PROJECT_REF = 'seed-test';
  process.env.SUPABASE_URL = 'https://seed-test.supabase.co';
  try {
    for (let run = 0; run < 2; run++) {
      writes.length = 0;
      await seedDatabase(client);
      const adminRows = [...directory.values()].filter(row => row.role === 'Admin');
      assert.equal(adminRows.length, admins.length);
      assert.ok(adminRows.every(row => row.is_active && identities.has(row.users_id)));
      const studentIds = new Set([...directory.values()].filter(row => row.role === 'Students').map(row => row.users_id));
      assert.equal(studentIds.size, 10);
      assert.equal(students.length, 10);
      const profiles = writes.filter(write => write.table === 'profiles').flatMap(write => write.rows);
      assert.equal(profiles.length, 10);
      assert.ok(profiles.every(row => row.role === 'student' && studentIds.has(row.id)));
      for (const write of writes) {
        for (const row of write.rows) {
          if ('student_id' in row) assert.ok(studentIds.has(row.student_id), `${write.table} must reference a student`);
        }
      }
    }
    assert.equal(created, 13, 'repeat seed reuses the shared Auth identities');
    assert.equal(updated, 13);
  } finally {
    if (previousRef === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF;
    else process.env.SISLMS_SUPABASE_PROJECT_REF = previousRef;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
  }
});
