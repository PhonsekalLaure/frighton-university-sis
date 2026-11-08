import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { libraryBootstrapSql } from './databaseHarness.js';

// This opt-in suite targets a disposable, task-created loopback cluster only.
const port = process.env.LIBRARY_REVIEW_PG_PORT;
test('native PostgreSQL: concurrent reservations, checkout, and stock edits', { skip: !port }, async (t) => {
  assert.match(port!, /^\d{4,5}$/);
  const bin = process.env.LIBRARY_REVIEW_PSQL ?? 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
  function run(sql: string, marker?: string) {
    const child = spawn(
      bin,
      [
        '-X',
        '-q',
        '-A',
        '-t',
        '-h',
        '127.0.0.1',
        '-p',
        port!,
        '-U',
        'library_review',
        '-d',
        'library_review_test',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { windowsHide: true },
    );
    let stdout = '',
      stderr = '';
    let signal!: () => void;
    const ready = new Promise<void>((r) => {
      signal = r;
    });
    const done = new Promise<string>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (marker && stdout.includes(marker)) signal();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        signal();
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr));
      });
    });
    child.stdin.end(sql);
    return { done, ready };
  }
  const exec = (sql: string) => run(sql).done;
  const directory = await exec("SELECT current_setting('data_directory');");
  assert.ok(
    directory.replaceAll('\\', '/').endsWith('/frighton-library-pg-review/data'),
    'Refusing to touch a cluster outside the disposable review directory',
  );
  assert.equal(await exec('SELECT current_database();'), 'library_review_test');
  await exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const sql of await libraryBootstrapSql()) await exec(sql);
  await exec(`INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Staff','Member','native-staff@test','x','Librarian'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','A','Student','native-a@test','x','Students'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','B','Student','native-b@test','x','Students');
    INSERT INTO profiles(id,student_number,first_name,last_name,email) VALUES
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','NATIVE-A','A','Student','native-a@test'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','NATIVE-B','B','Student','native-b@test');
    INSERT INTO books(books_id,title,author,copies) VALUES
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Concurrency title','Author',1);`);
  const book = "'dddddddd-dddd-4ddd-8ddd-dddddddddddd'";
  const staff = "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'";
  await t.test('last-copy reservation serializes competitors', async () => {
    const first = run(
      `BEGIN; SELECT create_self_service_reservation('NATIVE-A',${book}); SELECT 'LOCKED'; SELECT pg_sleep(0.5); COMMIT;`,
      'LOCKED',
    );
    await first.ready;
    const competing = exec(`SELECT create_self_service_reservation('NATIVE-B',${book});`);
    await assert.rejects(competing, /No copies/);
    await first.done;
    assert.equal(await exec("SELECT count(*) FROM reservations WHERE status='active';"), '1');
  });
  await t.test('stock edits cannot erase an allocation committed while they waited', async () => {
    await exec("UPDATE reservations SET status='cancelled';");
    const reservation = run(
      `BEGIN; SELECT create_self_service_reservation('NATIVE-A',${book}); SELECT 'LOCKED'; SELECT pg_sleep(0.5); COMMIT;`,
      'LOCKED',
    );
    await reservation.ready;
    await assert.rejects(exec('UPDATE books SET copies=0;'), /reserved copies/);
    await reservation.done;
    assert.equal(await exec('SELECT available FROM catalog_books;'), '0');
  });
  await t.test('checkout cannot take the last copy allocated by a concurrent reservation', async () => {
    await exec("UPDATE reservations SET status='cancelled';");
    const reservation = run(
      `BEGIN; SELECT create_self_service_reservation('NATIVE-A',${book}); SELECT 'LOCKED'; SELECT pg_sleep(0.5); COMMIT;`,
      'LOCKED',
    );
    await reservation.ready;
    await assert.rejects(exec(`SELECT borrow_book('NATIVE-B',${book},${staff});`), /No unreserved/);
    await reservation.done;
    assert.equal(await exec('SELECT count(*) FROM borrow_records;'), '0');
  });
  await t.test('two checkouts for one borrower cannot create two active loans', async () => {
    await exec("UPDATE reservations SET status='cancelled'; UPDATE books SET copies=2;");
    const first = run(
      `BEGIN; SELECT borrow_book('NATIVE-A',${book},${staff}); SELECT 'LOCKED'; SELECT pg_sleep(0.5); COMMIT;`,
      'LOCKED',
    );
    await first.ready;
    await assert.rejects(
      exec(`SELECT borrow_book('NATIVE-A',${book},${staff});`),
      /already has an active loan/,
    );
    await first.done;
    assert.equal(await exec('SELECT count(*) FROM borrow_records WHERE return_date IS NULL;'), '1');
    assert.equal(await exec('SELECT copies FROM books;'), '1');
  });
});
