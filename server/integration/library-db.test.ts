import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { libraryDatabase } from './databaseHarness.js';

async function reviewFixtures() {
  const db = await libraryDatabase();
  await db.exec(`
    INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Staff','Member','review-staff@test','x','Librarian'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SIS','Student','review-student@test','x','Students'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Legacy','Student','review-legacy@test','x','Students');
    INSERT INTO profiles(id,student_number,first_name,last_name,email)
    VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','REVIEW-1','SIS','Student','review-student@test');
    INSERT INTO books(books_id,title,author,copies)
    VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Review title','Author',1);
  `);
  return db;
}

test('legacy borrowers without SIS profiles can still return existing loans', async () => {
  const db = await reviewFixtures();
  try {
    // Represents a historical loan present before the new debt trigger was installed.
    await db.exec(`ALTER TABLE borrow_records DISABLE TRIGGER library_loan_debt_changed;
      INSERT INTO borrow_records(id,student_id,book_id,issued_by,due_date)
      VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_date+14);
      UPDATE books SET copies=0;
      ALTER TABLE borrow_records ENABLE TRIGGER library_loan_debt_changed;`);
    await db.query('SELECT return_book($1,$2,false)', [
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]);
    assert.equal((await db.query<any>('SELECT copies FROM books')).rows[0].copies, 1);
    // An archived legacy title may also have an outstanding reservation. Returning
    // another copy must not be mistaken for a new archive action.
    await db.exec(`SELECT create_self_service_reservation('REVIEW-1','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      INSERT INTO borrow_records(id,student_id,book_id,issued_by,due_date)
      VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_date+14);
      ALTER TABLE books DISABLE TRIGGER library_stock_floor;
      UPDATE books SET is_active=false;
      ALTER TABLE books ENABLE TRIGGER library_stock_floor;`);
    await db.query('SELECT return_book($1,$2,false)', [
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]);
    assert.equal((await db.query<any>('SELECT copies FROM books')).rows[0].copies, 2);
  } finally {
    await db.close();
  }
});

test('aggregate debt may exceed the per-charge limit without losing the SIS hold', async () => {
  const db = await reviewFixtures();
  try {
    for (let i = 0; i < 2; i++)
      await db.query('SELECT record_library_replacement($1,$2,$3,NULL,$4)', [
        'REVIEW-1',
        'Replacement',
        9999999999.99,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]);
    const d = (
      await db.query<any>("SELECT refresh_library_debt('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') AS debt")
    ).rows[0].debt;
    await db.query('SELECT apply_library_debt($1,$2,$3,$4,$5)', [
      d.studentNumber,
      d.version,
      d.qualifyingDebtCount,
      d.amount,
      d.reason,
    ]);
    assert.equal(
      (await db.query<any>('SELECT count(*)::integer AS n FROM student_holds WHERE resolved_at IS NULL'))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test('archiving a book cannot strand an allocated pickup reservation', async () => {
  const db = await reviewFixtures();
  try {
    await db.query(
      "SELECT create_self_service_reservation('REVIEW-1','dddddddd-dddd-4ddd-8ddd-dddddddddddd')",
    );
    await assert.rejects(db.query('UPDATE books SET is_active=false'), /reservation/i);
    assert.equal((await db.query<any>('SELECT active FROM catalog_books')).rows[0].active, true);
  } finally {
    await db.close();
  }
});

test('isolated PostgreSQL: allocation, expiry, fulfilment, debt versions, and worker claims', async () => {
  const db = await libraryDatabase();
  try {
    const q = async (sql: string, args: any[] = []) => (await db.query<any>(sql, args)).rows;
    const scalar = async (sql: string, args: any[] = []) => (await q(sql, args))[0].value;
    const staff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      a = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      b = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      book = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.exec(`INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES('${staff}','Staff','Member','staff@test','x','Librarian'),('${a}','A','Student','a@test','x','Students'),('${b}','B','Student','b@test','x','Students');
 INSERT INTO profiles(id,student_number,first_name,last_name,email) VALUES('${a}','TEST-A','A','Student','a@test'),('${b}','TEST-B','B','Student','b@test');
 INSERT INTO books(books_id,title,author,copies) VALUES('${book}','Test Book','Author',1);`);
    const reserve = () =>
      scalar('SELECT to_jsonb(create_self_service_reservation($1,$2)) AS value', ['TEST-A', book]);
    const r = await reserve();
    assert.equal(r.reserved_by, a);
    assert.equal(await scalar('SELECT available AS value FROM catalog_books WHERE id=$1', [book]), 0);
    await assert.rejects(reserve(), /already exists/);
    await assert.rejects(q('SELECT create_self_service_reservation($1,$2)', ['TEST-B', book]), /No copies/);
    await assert.rejects(q('SELECT borrow_book($1,$2,$3)', ['TEST-B', book, staff]), /No unreserved/);
    await assert.rejects(q('UPDATE books SET copies=0 WHERE books_id=$1', [book]), /reserved copies/);
    await assert.rejects(q('SELECT cancel_self_service_reservation($1,$2)', ['TEST-B', r.id]), /not found/);
    await q('SELECT cancel_self_service_reservation($1,$2)', ['TEST-A', r.id]);
    await q('SELECT cancel_self_service_reservation($1,$2)', ['TEST-A', r.id]);
    assert.equal(await scalar('SELECT available AS value FROM catalog_books WHERE id=$1', [book]), 1);
    const expired = await reserve();
    await q("UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    assert.equal(await scalar('SELECT available AS value FROM catalog_books WHERE id=$1', [book]), 1);
    await q('SELECT expire_reservations()');
    await q('SELECT expire_reservations()');
    const pickup = await reserve();
    const loan = await scalar('SELECT to_jsonb(borrow_book($1,$2,$3)) AS value', ['TEST-A', book, staff]);
    assert.equal(
      await scalar('SELECT status AS value FROM reservations WHERE id=$1', [pickup.id]),
      'fulfilled',
    );
    assert.equal(await scalar('SELECT copies AS value FROM books WHERE books_id=$1', [book]), 0);
    await assert.rejects(reserve(), /Return all borrowed/);
    await q("UPDATE borrow_records SET due_date=(now() AT TIME ZONE 'Asia/Manila')::date-13 WHERE id=$1", [
      loan.id,
    ]);
    let debt = await scalar('SELECT refresh_library_debt($1) AS value', [a]);
    assert.equal(debt.qualifyingDebtCount, 0);
    await q("UPDATE borrow_records SET due_date=(now() AT TIME ZONE 'Asia/Manila')::date-14 WHERE id=$1", [
      loan.id,
    ]);
    debt = await scalar('SELECT refresh_library_debt($1) AS value', [a]);
    assert.equal(debt.qualifyingDebtCount, 1);
    assert.equal(debt.amount, 70);
    const apply = (d: any) =>
      scalar('SELECT apply_library_debt($1,$2,$3,$4,$5) AS value', [
        d.studentNumber,
        d.version,
        d.qualifyingDebtCount,
        d.amount,
        d.reason,
      ]);
    await apply(debt);
    await apply(debt);
    assert.equal(
      await scalar('SELECT count(*)::integer AS value FROM student_holds WHERE resolved_at IS NULL'),
      1,
    );
    const charge = await scalar('SELECT to_jsonb(record_library_replacement($1,$2,$3,$4,$5)) AS value', [
      'TEST-A',
      'Replacement',
      200,
      loan.id,
      staff,
    ]);
    debt = await scalar('SELECT refresh_library_debt($1) AS value', [a]);
    assert.equal(debt.qualifyingDebtCount, 2);
    await q('SELECT return_book($1,$2,true)', [loan.id, staff]);
    const returned = await scalar('SELECT refresh_library_debt($1) AS value', [a]);
    assert.equal(returned.qualifyingDebtCount, 1);
    await apply(returned);
    await q('SELECT settle_library_replacement($1,$2,$3)', [charge.id, 'OFFLINE-001', staff]);
    const cleared = await scalar('SELECT refresh_library_debt($1) AS value', [a]);
    assert.equal(cleared.qualifyingDebtCount, 0);
    await apply(cleared);
    await apply(debt);
    assert.equal(
      await scalar('SELECT count(*)::integer AS value FROM student_holds WHERE resolved_at IS NULL'),
      0,
    );
    assert.equal(await scalar('SELECT copies AS value FROM books WHERE books_id=$1', [book]), 1);
    await assert.rejects(q('SELECT return_book($1,$2,true)', [loan.id, staff]), /already been returned/);
    const claims = await q('SELECT * FROM claim_library_debt(10)');
    assert.ok(claims.length);
    assert.equal((await q('SELECT * FROM claim_library_debt(10)')).length, 0);
    for (const c of claims)
      await q('SELECT finish_library_debt($1,$2,$3,false)', [c.student_id, c.version, c.claim_token]);
    assert.equal((await q('SELECT * FROM claim_library_debt(10)')).length, 0);
    await db.exec(
      "UPDATE library_debt_outbox SET next_attempt_at=now(),locked_until=now()-interval '1 second'",
    );
    assert.equal((await q('SELECT * FROM claim_library_debt(10)')).length, claims.length);
    assert.equal(
      await scalar(
        "SELECT has_function_privilege('authenticated','create_self_service_reservation(text,uuid)','EXECUTE') AS value",
      ),
      false,
    );
    // Run existing rollback-only SQL regressions against the migrated schema too.
    for (const name of ['reservations', 'circulation', 'catalog'])
      await db.exec(
        await readFile(
          new URL('../../../Frighton Univeristy LMS/supabase/tests/' + name + '.sql', import.meta.url),
          'utf8',
        ),
      );
  } finally {
    await db.close();
  }
});
