import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('generated numbers continue after existing IDs, imports and deletions; admin lifecycle remains atomic and idempotent', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,invited_at timestamptz,created_at timestamptz,
        email_confirmed_at timestamptz,last_sign_in_at timestamptz,encrypted_password text,raw_user_meta_data jsonb);
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS
        'SELECT coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
      CREATE TABLE public.users(users_id uuid PRIMARY KEY,first_name text,middle_name text,last_name text,email text UNIQUE,
        password text,role text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    `);
    for (const name of [
      '20261020154411_sis_student_admin_portal_schema', '20261020155029_sis_link_profiles_to_shared_users',
      '20261021140908_rename_frighton_id_to_student_number', '20261022044520_admin_portal_backend',
      '20261022055741_admin_audit_url_redaction', '20261022065602_admin_account_completion',
      '20261101000000_shared_admin_directory',
    ]) await db.exec((await migration(name)).replace(/^CREATE EXTENSION.*$/gm, ''));
    const year = (await db.query<{ year: string }>("SELECT to_char(now() AT TIME ZONE 'Asia/Manila','YYYY') AS year")).rows[0].year;
    async function insert(number: string | null) {
      return (await db.query<{ student_number: string }>(`WITH u AS (
        INSERT INTO users(users_id,first_name,last_name,email,password,role)
        VALUES(gen_random_uuid(),'Imported','Student',gen_random_uuid()||'@test.invalid','x','Students') RETURNING *
      ) INSERT INTO profiles(id,student_number,first_name,last_name,email)
        SELECT users_id,$1,first_name,last_name,email FROM u RETURNING student_number`, [number])).rows[0].student_number;
    }
    await insert(`STU-${year}-0042`);
    await insert('STU-1999-9999');
    await db.exec(await migration('20261112000000_generated_student_numbers'));
    assert.equal(await insert(null), `STU-${year}-0043`);
    await db.query('DELETE FROM profiles WHERE student_number=$1', [`STU-${year}-0043`]);
    assert.equal(await insert(null), `STU-${year}-0044`);
    await insert(`STU-${year}-9999`);
    assert.equal(await insert(null), `STU-${year}-10000`);
    await db.exec('BEGIN');
    assert.equal(await insert(null), `STU-${year}-10001`);
    await db.exec('ROLLBACK');
    assert.equal(await insert(null), `STU-${year}-10001`);
    const batch = await Promise.all(Array.from({ length: 6 }, () => insert(null)));
    assert.equal(new Set(batch).size, 6);
    assert.equal(batch.at(-1), `STU-${year}-10007`);
    await db.exec('BEGIN; SET LOCAL plpgsql.check_asserts = on;');
    await db.exec(await readFile(new URL('./admin-database.sql', import.meta.url), 'utf8'));
    await db.exec('ROLLBACK');
    await db.exec(await migration('20261112000200_sis_invitation_delivery'));
    await db.exec('BEGIN; SET LOCAL plpgsql.check_asserts = on;');
    await db.exec(await readFile(new URL('./invitation-database.sql', import.meta.url), 'utf8'));
    await db.exec('ROLLBACK');
    // Supabase owns the real storage schema; this fixture checks bucket configuration SQL.
    await db.exec('CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    await db.exec(await migration('20261112000100_student_photo_storage'));
    const bucket = (await db.query<any>('SELECT * FROM storage.buckets')).rows[0];
    assert.equal(bucket.file_size_limit, 2097152);
    assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  } finally { await db.close(); }
});
