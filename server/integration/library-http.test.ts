import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { libraryDatabase } from './databaseHarness.js';
import { config as sisConfig } from '../src/config/env.js';
import { config as lmsConfig } from '../../../Frighton Univeristy LMS/server/src/config/env.js';
import { createApp as sisApp } from '../src/app.js';
import { createApp as lmsApp } from '../../../Frighton Univeristy LMS/server/src/app.js';
import { runLibraryMaintenance } from '../../../Frighton Univeristy LMS/server/src/services/libraryMaintenance.js';
import { getSupabaseAdmin as lmsDb } from '../../../Frighton Univeristy LMS/server/src/config/supabase.js';
import { lmsRequest } from '../src/services/lmsClient.js';
import { latestDebt } from '../src/services/libraryDebt.js';

test('two real HTTP applications: eligibility, ownership, contention, staff fulfilment, charges, and durable sync', async () => {
  const db = await libraryDatabase();
  const servers: ReturnType<express.Express['listen']>[] = [];
  const staff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    a = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    b = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    book = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const identities: Record<string, { id: string; email: string }> = {
    a: { id: a, email: 'a@test.edu' },
    b: { id: b, email: 'b@test.edu' },
    staff: { id: staff, email: 'staff@test.edu' },
  };
  let failHolds = false;
  async function listen(app: express.Express) {
    const s = app.listen(0, '127.0.0.1');
    servers.push(s);
    await once(s, 'listening');
    return 'http://127.0.0.1:' + (s.address() as AddressInfo).port;
  }
  try {
    await db.exec(`INSERT INTO users(users_id,first_name,last_name,email,password,role) VALUES('${staff}','Staff','Member','staff@test.edu','x','Librarian'),('${a}','A','Student','a@test.edu','x','Students'),('${b}','B','Student','b@test.edu','x','Students');
 INSERT INTO profiles(id,student_number,first_name,last_name,email) VALUES('${a}','TEST-A','A','Student','a@test.edu'),('${b}','TEST-B','B','Student','b@test.edu');
 INSERT INTO books(books_id,title,author,copies) VALUES('${book}','Test Book','Author',1);`);
    // Minimal PostgREST/Auth protocol adapter backed by actual isolated PostgreSQL.
    const rest = express();
    rest.use(express.json());
    rest.get('/auth/v1/user', (req, res) => {
      const u = identities[(req.get('authorization') ?? '').replace('Bearer ', '')];
      if (!u) {
        res.status(401).json({ message: 'Invalid token' });
        return;
      }
      res.json({ ...u, email_confirmed_at: '2026-01-01T00:00:00Z' });
    });
    rest.all('/rest/v1/:table', async (req, res) => {
      try {
        const table = req.params.table;
        if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid table');
        if (table === 'student_holds' && failHolds) {
          res.status(400).json({ code: 'AUDIT_FAIL', message: 'Holds unavailable' });
          return;
        }
        const args: any[] = [],
          conditions: string[] = [];
        const parameter = (v: any) => {
          args.push(v);
          return '$' + args.length;
        };
        for (const [key, raw] of Object.entries(req.query)) {
          if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
          if (key === 'or') continue; // Fixtures have one current loan; API unit tests cover catalog filters.
          if (!/^[a-z_]+$/.test(key) || typeof raw !== 'string') throw new Error('Unsupported filter');
          if (raw === 'is.null') conditions.push(key + ' IS NULL');
          else if (raw === 'not.is.null') conditions.push(key + ' IS NOT NULL');
          else {
            const dot = raw.indexOf('.'),
              op = raw.slice(0, dot),
              value = raw.slice(dot + 1);
            const operators: Record<string, string> = { eq: '=', gt: '>', gte: '>=', ilike: 'ILIKE' };
            if (!operators[op]) throw new Error('Unsupported operator');
            conditions.push(key + ' ' + operators[op] + ' ' + parameter(value));
          }
        }
        const fields =
          table === 'profiles' && String(req.query.select).includes('user:')
            ? "*,(SELECT jsonb_build_object('role',u.role,'is_active',u.is_active) FROM users u WHERE u.users_id=profiles.id) AS user"
            : '*';
        const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const orders =
          typeof req.query.order === 'string'
            ? req.query.order
                .split(',')
                .map((x) => {
                  const [k, d] = x.split('.');
                  if (!/^[a-z_]+$/.test(k)) throw new Error('Invalid order');
                  return k + (d === 'desc' ? ' DESC' : ' ASC');
                })
                .join(',')
            : '';
        const total = await db.query<any>('SELECT count(*)::integer AS count FROM ' + table + where, args);
        const limit = Math.min(Number(req.query.limit ?? 1000), 1000),
          offset = Number(req.query.offset ?? 0);
        const result = await db.query(
          'SELECT ' +
            fields +
            ' FROM ' +
            table +
            where +
            (orders ? ' ORDER BY ' + orders : '') +
            ' LIMIT ' +
            limit +
            ' OFFSET ' +
            offset,
          args,
        );
        for (const row of result.rows as any[])
          if (row.due_date instanceof Date) row.due_date = row.due_date.toISOString().slice(0, 10);
        res.set(
          'Content-Range',
          offset + '-' + (offset + result.rows.length - 1) + '/' + total.rows[0].count,
        );
        if (req.get('accept')?.includes('vnd.pgrst.object')) {
          if (result.rows.length !== 1) {
            res
              .status(406)
              .json({ code: 'PGRST116', details: result.rows.length + ' rows', message: 'No row' });
            return;
          }
          res.json(result.rows[0]);
        } else res.json(result.rows);
      } catch (e: any) {
        res.status(400).json({ message: e.message, code: e.code ?? 'TEST_ADAPTER' });
      }
    });
    rest.post('/rest/v1/rpc/:fn', async (req, res) => {
      try {
        const name = req.params.fn;
        if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid RPC');
        const keys = Object.keys(req.body ?? {});
        if (keys.some((k) => !/^p_[a-z_]+$/.test(k))) throw new Error('Invalid RPC args');
        const result = await db.query<any>(
          'SELECT to_jsonb(f) AS value FROM public.' +
            name +
            '(' +
            keys.map((k, i) => k + '=> $' + (i + 1)).join(',') +
            ') f',
          keys.map((k) => req.body[k]),
        );
        const proc = await db.query<any>('SELECT proretset FROM pg_proc WHERE proname=$1', [name]);
        const rows = result.rows.map((x) => x.value);
        res.json(proc.rows[0]?.proretset ? rows : (rows[0] ?? null));
      } catch (e: any) {
        res.status(400).json({ message: e.message, code: e.code ?? 'TEST_ADAPTER' });
      }
    });
    const api = await listen(rest);
    for (const c of [sisConfig, lmsConfig]) {
      c.supabase.url = api;
      c.supabase.serviceRoleKey = 'isolated-dummy';
      c.supabase.anonKey = 'isolated-anon';
    }
    sisConfig.lms.enabled = true;
    sisConfig.lms.apiKey = 'isolated-inbound';
    sisConfig.lms.serviceKey = 'isolated-outbound';
    lmsConfig.sis.apiKey = sisConfig.lms.apiKey;
    lmsConfig.service.apiKey = sisConfig.lms.serviceKey;
    const sis = await listen(sisApp()),
      lms = await listen(lmsApp());
    sisConfig.lms.apiUrl = lms;
    lmsConfig.sis.apiUrl = sis;
    const request = (base: string, path: string, user = 'a', method = 'GET', body?: unknown) =>
      fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: base === sis ? sisConfig.clientUrl : lmsConfig.clientUrl,
          Authorization: 'Bearer ' + user,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await fetch(sis + '/api/v1/library/me')).status, 401);
    assert.equal((await request(sis, '/api/v1/library/me', 'staff')).status, 403);
    assert.equal((await fetch(lms + '/service/v1/books')).status, 401);
    assert.equal(
      (
        await request(sis, '/api/v1/library/reservations', 'a', 'POST', {
          studentNumber: 'TEST-B',
          bookId: book,
        })
      ).status,
      400,
    );
    const catalog = await request(sis, '/api/v1/library/books');
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).items[0].availableCopies, 1);
    failHolds = true;
    const blocked = await request(sis, '/api/v1/library/reservations', 'a', 'POST', { bookId: book });
    assert.equal(blocked.status, 503);
    failHolds = false;
    await db.query('UPDATE users SET is_active=false WHERE users_id=$1', [a]);
    assert.equal((await request(sis, '/api/v1/library/me')).status, 403);
    await db.query('UPDATE users SET is_active=true WHERE users_id=$1', [a]);
    const reserved = await request(sis, '/api/v1/library/reservations', 'a', 'POST', { bookId: book });
    assert.equal(reserved.status, 201, await reserved.clone().text());
    const reservation = await reserved.json();
    assert.equal(reservation.status, 'ready_for_pickup');
    assert.ok(reservation.book.coverUrl.startsWith('/api/v1/library/'));
    assert.equal(
      (await request(sis, '/api/v1/library/reservations/' + reservation.id, 'b', 'DELETE')).status,
      404,
    );
    assert.equal(
      (await request(sis, '/api/v1/library/reservations/' + reservation.id, 'a', 'DELETE')).status,
      204,
    );
    assert.equal(
      (await request(sis, '/api/v1/library/reservations/' + reservation.id, 'a', 'DELETE')).status,
      204,
    );
    const checkoutRace = await Promise.all([
      request(sis, '/api/v1/library/reservations', 'a', 'POST', { bookId: book }),
      request(lms, '/api/v1/loans/borrow', 'staff', 'POST', { studentNumber: 'TEST-B', bookId: book }),
    ]);
    assert.deepEqual(checkoutRace.map((r) => r.status).sort(), [201, 409]);
    if (checkoutRace[0].status === 201) {
      const r = await checkoutRace[0].json();
      assert.equal((await request(sis, '/api/v1/library/reservations/' + r.id, 'a', 'DELETE')).status, 204);
    } else {
      const { loan } = await checkoutRace[1].json();
      assert.equal(
        (
          await request(lms, '/api/v1/loans/' + loan.id + '/return', 'staff', 'POST', {
            fineCollected: false,
          })
        ).status,
        200,
      );
    }
    const raced = await Promise.all(
      ['a', 'b'].map((u) => request(sis, '/api/v1/library/reservations', u, 'POST', { bookId: book })),
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
    const winner = raced[0].status === 201 ? 'a' : 'b';
    const student = winner === 'a' ? 'TEST-A' : 'TEST-B';
    const winnerId = winner === 'a' ? a : b;
    const issued = await request(lms, '/api/v1/loans/borrow', 'staff', 'POST', {
      studentNumber: student,
      bookId: book,
    });
    assert.equal(issued.status, 201, await issued.clone().text());
    const loan = (await issued.json()).loan;
    assert.equal(
      (await request(sis, '/api/v1/library/reservations', winner, 'POST', { bookId: book })).status,
      403,
    );
    await db.query(
      "UPDATE borrow_records SET due_date=(now() AT TIME ZONE 'Asia/Manila')::date-14 WHERE id=$1",
      [loan.id],
    );
    await runLibraryMaintenance(lmsDb());
    assert.equal(
      (
        await db.query<any>(
          'SELECT count(*)::integer AS n FROM student_holds WHERE student_id=$1 AND resolved_at IS NULL',
          [winnerId],
        )
      ).rows[0].n,
      1,
    );
    const assessed = await request(lms, '/api/v1/replacement-charges', 'staff', 'POST', {
      studentNumber: student,
      reason: 'Replacement',
      amount: 200,
    });
    assert.equal(assessed.status, 201, await assessed.clone().text());
    const charge = await assessed.json();
    const account = await request(sis, '/api/v1/library/me', winner);
    assert.equal(account.status, 200);
    const accountData = await account.json();
    assert.equal(accountData.loans[0].dueAt.slice(-6), '+08:00');
    assert.equal(accountData.unpaidFines.length, 2);
    lmsConfig.sis.apiUrl = 'http://127.0.0.1:1';
    assert.equal(
      (await request(lms, '/api/v1/loans/' + loan.id + '/return', 'staff', 'POST', { fineCollected: true }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(lms, '/api/v1/replacement-charges/' + charge.id + '/settle', 'staff', 'POST', {
          reference: 'RECEIPT-TEST',
        })
      ).status,
      200,
    );
    await runLibraryMaintenance(lmsDb());
    assert.ok(
      (
        await db.query<any>(
          'SELECT count(*)::integer AS n FROM library_debt_outbox WHERE delivered_version<version',
        )
      ).rows[0].n > 0,
    );
    lmsConfig.sis.apiUrl = sis;
    await db.exec('UPDATE library_debt_outbox SET next_attempt_at=now()');
    await runLibraryMaintenance(lmsDb());
    assert.equal(
      (await db.query<any>('SELECT count(*)::integer AS n FROM student_holds WHERE resolved_at IS NULL'))
        .rows[0].n,
      0,
    );
    // A legacy active loan with no catalog link must not take the entire account offline.
    const legacyLoan = await db.query<any>(
      'INSERT INTO borrow_records(student_id,issued_by,book_id,due_date) VALUES($1,$2,NULL,current_date+14) RETURNING id',
      [a, staff],
    );
    const legacyAccount = await request(sis, '/api/v1/library/me', 'a');
    assert.equal(legacyAccount.status, 200, await legacyAccount.clone().text());
    assert.equal((await legacyAccount.json()).loans[0].book.title, 'Unavailable library item');
    await db.query('UPDATE borrow_records SET return_date=now() WHERE id=$1', [legacyLoan.rows[0].id]);
    // Bad upstream payloads fail closed; no private implementation message is forwarded.
    const malformed = express();
    malformed.get('/service/v1/books', (_q, r) => r.json({ items: [] }));
    const bad = await listen(malformed);
    sisConfig.lms.apiUrl = bad;
    assert.equal((await request(sis, '/api/v1/library/books')).status, 503);
    malformed.get('/service/v1/students/:number/debt', (_q, r) => r.json({ private: 'malformed' }));
    await assert.rejects(latestDebt(student), { status: 503 });
    await assert.rejects(lmsRequest('/missing'), { status: 404 });
    sisConfig.lms.apiUrl = lms;
    sisConfig.lms.enabled = false;
    assert.equal((await request(sis, '/api/v1/library/me')).status, 503);
  } finally {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    await db.close();
  }
});
