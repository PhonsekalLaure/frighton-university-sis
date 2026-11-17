import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedDatabase } from '../src/scripts/seed.js';
import { admins } from '../src/seed-data/admins.js';
import { students } from '../src/seed-data/students.js';
import { legacyTermCodes, terms } from '../src/seed-data/terms.js';
import { courses } from '../src/seed-data/courses.js';
import { sections } from '../src/seed-data/sections.js';
import { academicRecords } from '../src/seed-data/academicRecords.js';

for (const useLegacyTerms of [false, true]) test(`first and repeat seeds preserve ten students and term identities (${useLegacyTerms ? 'seasonal terms' : 'empty catalog'})`, async (t) => {
  // Exercise the whole seeder without a database or password output.
  t.mock.method(console, 'log', () => {});
  const directory = new Map<string, Record<string, any>>();
  const identities = new Map<string, { id: string }>();
  const writes: Array<{ table: string; rows: Record<string, any>[] }> = [];
  const termRows = useLegacyTerms ? Object.keys(legacyTermCodes).map((code, index) => ({ id: `term-${index}`, code })) : [];
  const recordRows = new Map<string, Record<string, any>>();
  const removedIds: string[] = [];
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
      let update: any;
      let deleting = false;
      const constraints = new Map<string, unknown[]>();
      const q: any = {
        upsert: (rows: any) => {
          const values = Array.isArray(rows) ? rows : [rows];
          writes.push({ table, rows: values });
          if (table === 'users') for (const row of values) directory.set(row.email, row);
          if (table === 'academic_terms') for (const row of values) {
            const prior = termRows.find(term => term.code === row.code);
            if (!prior) termRows.push({ id: `term-${termRows.length}`, code: row.code });
          }
          if (table === 'academic_records') for (const row of values) {
            const key = `${row.student_id}/${row.section_id}`;
            recordRows.set(key, { id: recordRows.get(key)?.id ?? `record-${recordRows.size}`, ...row });
          }
          if (table === 'student_accounts') result = { id: `account-${writes.length}` };
          return q;
        },
        insert: (row: any) => { writes.push({ table, rows: [row] }); return q; },
        select: () => {
          if (table === 'academic_terms') result = termRows;
          if (table === 'courses') result = courses.map(course => ({ id: course.courseCode, course_code: course.courseCode }));
          if (table === 'course_sections') result = sections.map((section, i) => ({
            id: `section-${i}`, section_number: section.sectionNumber, term_id: termRows.find(term => term.code === section.termCode)!.id,
            course: { course_code: section.courseCode },
          }));
          return q;
        },
        update: (values: any) => { update = values; return q; },
        delete: () => { deleting = true; return q; },
        in: (column: string, values: unknown[]) => { constraints.set(column, values); return q; },
        eq: (column: string, value: string) => { if (column === 'email') email = value; constraints.set(column, [value]); return q; },
        maybeSingle: async () => ({ data: table === 'users' ? directory.get(email) ?? null : null, error: null }),
        single: async () => ({ data: result, error: null }),
        then: (resolve: any) => {
          const matches = (row: Record<string, any>) => [...constraints].every(([column, values]) => values.includes(row[column]));
          if (table === 'academic_terms' && update) for (const row of termRows.filter(matches)) Object.assign(row, update);
          if (table === 'academic_records') {
            const matching = [...recordRows.values()].filter(matches);
            if (deleting) for (const row of matching) {
              removedIds.push(row.id); recordRows.delete(`${row.student_id}/${row.section_id}`);
            }
            else result = matching;
          }
          return Promise.resolve({ data: result, error: null }).then(resolve);
        },
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
      assert.equal(termRows.length, terms.length, 'Seasonal terms are renamed rather than duplicated');
      assert.deepEqual(termRows.map(term => term.id), ['term-0', 'term-1', 'term-2', 'term-3'], 'Term identities are preserved');
      assert.deepEqual(termRows.map(term => term.code), terms.map(term => term.code));
      assert.equal([...recordRows.values()].filter(row => studentIds.has(row.student_id)).length, academicRecords.length);
      const profiles = writes.filter(write => write.table === 'profiles').flatMap(write => write.rows);
      assert.equal(profiles.length, 10);
      assert.ok(profiles.every(row => row.role === 'student' && studentIds.has(row.id)));
      for (const write of writes) {
        for (const row of write.rows) {
          if ('student_id' in row) assert.ok(studentIds.has(row.student_id), `${write.table} must reference a student`);
        }
      }
      if (run === 0) {
        const studentId = [...studentIds][0];
        recordRows.set(`${studentId}/old-section`, { id: 'obsolete-fixture-assignment', student_id: studentId, section_id: 'old-section' });
        recordRows.set('outside/old-section', { id: 'unrelated-assignment', student_id: 'outside', section_id: 'old-section' });
      }
    }
    assert.equal(created, 13, 'repeat seed reuses the shared Auth identities');
    assert.equal(updated, 13);
    assert.deepEqual(removedIds, ['obsolete-fixture-assignment']);
    assert(recordRows.has('outside/old-section'), 'Non-fixture student records are preserved');
  } finally {
    if (previousRef === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF;
    else process.env.SISLMS_SUPABASE_PROJECT_REF = previousRef;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
  }
});

test('ambiguous seasonal/canonical term mappings stop before account or password writes', async () => {
  let writes = 0;
  const client = { from: () => ({ select: () => ({ in: async () => ({ data: [
    { id: 'old', code: 'FALL-2026' }, { id: 'new', code: 'AY2026-2027-T1' },
  ], error: null }) }) }), auth: { admin: { createUser: () => { writes++; }, updateUserById: () => { writes++; } } } };
  const oldRef = process.env.SISLMS_SUPABASE_PROJECT_REF, oldUrl = process.env.SUPABASE_URL;
  process.env.SISLMS_SUPABASE_PROJECT_REF = 'seed-test'; process.env.SUPABASE_URL = 'https://seed-test.supabase.co';
  try {
    await assert.rejects(seedDatabase(client as unknown as SupabaseClient), /Both FALL-2026 and AY2026-2027-T1 exist/);
    assert.equal(writes, 0);
  } finally {
    if (oldRef === undefined) delete process.env.SISLMS_SUPABASE_PROJECT_REF; else process.env.SISLMS_SUPABASE_PROJECT_REF = oldRef;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
  }
});
