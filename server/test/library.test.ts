import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { config } from '../src/config/env.js';
import { lmsRequest, validLms } from '../src/services/lmsClient.js';
import { isAccount, isDebtSnapshot } from '../src/services/libraryContracts.js';
test('LMS requests use the dedicated credential, sanitize failures, never retry writes, and time out', async () => {
  const old = { ...config.lms };
  let posts = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers['x-sis-api-key'], 'test-outbound');
    assert.equal(req.headers['x-lms-api-key'], undefined);
    if (req.url === '/slow') return;
    if (req.method === 'POST') posts++;
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = req.url === '/ok' ? 200 : 500;
    res.end(
      JSON.stringify(req.url === '/ok' ? { ok: true } : { error: 'private database and credential details' }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.lms.apiUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  config.lms.serviceKey = 'test-outbound';
  config.lms.apiKey = 'test-inbound';
  try {
    assert.deepEqual(await lmsRequest('/ok'), { ok: true });
    await assert.rejects(lmsRequest('/failure', 'POST', { bookId: 'test' }), (e) => {
      assert.equal((e as any).status, 503);
      assert.doesNotMatch((e as Error).message, /private/);
      return true;
    });
    assert.equal(posts, 1);
    const started = Date.now();
    await assert.rejects(lmsRequest('/slow'), { status: 503 });
    assert.ok(Date.now() - started < 6500);
    config.lms.serviceKey = config.lms.apiKey;
    await assert.rejects(lmsRequest('/ok'), { status: 503 });
  } finally {
    Object.assign(config.lms, old);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('upstream contracts reject malformed account dates and debt identity/version', () => {
  assert.throws(
    () =>
      validLms(
        {
          reservations: [],
          loans: [
            {
              id: 'x',
              borrowedAt: '2026-01-01',
              dueAt: '2026-01-01',
              overdueDays: 0,
              book: { id: 'x', title: 'X', authors: [], coverUrl: null },
            },
          ],
          unpaidFines: [],
        },
        isAccount,
      ),
    { status: 503 },
  );
  for (const d of [
    { studentNumber: 'OTHER', version: 1 },
    { studentNumber: 'TEST-A', version: -1 },
    {
      studentNumber: 'TEST-A',
      version: 1,
      qualifyingDebtCount: 0,
      amount: 50,
      currency: 'PHP',
      reason: 'bad',
    },
  ])
    assert.equal(isDebtSnapshot(d, 'TEST-A'), false);
});
