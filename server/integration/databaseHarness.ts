import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
export async function libraryBootstrapSql() {
  const statements = [
    `DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
 END $$;
 CREATE TYPE public.sis_user_role AS ENUM ('student','admin');
 CREATE TYPE public.academic_status AS ENUM ('active','probation','suspended','inactive');
 CREATE TYPE public.hold_type AS ENUM ('library_debt','academic_probation','financial_delinquency','disciplinary');
 CREATE TYPE public.account_status AS ENUM ('open','closed','overdue');
 CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`,
  ];
  const root = new URL('../../../Frighton Univeristy LMS/', import.meta.url);
  const markdown = await readFile(new URL('schema.md', root), 'utf8');
  statements.push(markdown.match(/```sql\r?\n([\s\S]*?)```/)![1].replace(/^CREATE EXTENSION.*$/gm, ''));
  for (const name of [
    '003_reservations',
    '004_circulation',
    '005_catalog',
    '006_reservation_api',
    '007_reservation_student_search',
  ])
    statements.push(await readFile(new URL('supabase/migrations/' + name + '.sql', root), 'utf8'));
  for (const [source, mirror] of [
    ['008_single_active_loan', '20261108000100_lms_single_active_loan'],
    ['009_library_self_service', '20261108000200_lms_library_self_service'],
  ]) {
    const original = await readFile(new URL('supabase/migrations/' + source + '.sql', root), 'utf8');
    const shared = await readFile(
      new URL('../../supabase/migrations/' + mirror + '.sql', import.meta.url),
      'utf8',
    );
    if (original !== shared) throw new Error('Shared-project migration differs from LMS source: ' + source);
  }
  for (const name of [
    '20261108000000_library_debt_sync',
    '20261108000100_lms_single_active_loan',
    '20261108000200_lms_library_self_service',
  ])
    statements.push(
      await readFile(new URL('../../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8'),
    );
  return statements;
}
export async function libraryDatabase() {
  const db = new PGlite();
  for (const sql of await libraryBootstrapSql()) await db.exec(sql);
  return db;
}
