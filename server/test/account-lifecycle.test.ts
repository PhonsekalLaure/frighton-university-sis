import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PasswordService, passwordCompletionInput } from '../src/services/passwordService.js';
import { AccountError, reserveAccountRequest } from '../src/services/accountRateLimit.js';
import { buildSISPasswordTemplate, adminAuthReadiness } from '../src/services/adminEmailTemplates.js';
import { createPasswordRouter } from '../src/routes/passwordRoutes.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { protectCookieRequests } from '../src/middlewares/auth.js';
import { config } from '../src/config/env.js';
import { findUser } from '../src/services/authService.js';

const request = { tokenHash: 'a'.repeat(64), type: 'invite', password: 'safe-long-password-2026' };
function fixture(options: { inactive?: boolean; role?: string; noProfile?: boolean; badProfile?: boolean;
  profileError?: boolean; verifyStatus?: number; updateStatus?: number; updateThrows?: boolean;
  updateWrongId?: boolean; cleanupFails?: boolean; denied?: boolean; rateFails?: boolean } = {}) {
  const calls: Array<{ name: string; params?: any }> = [];
  const account = { users_id: 'directory-uuid', email: 'student@example.edu', role: options.role ?? 'Students',
    is_active: !options.inactive, first_name: 'Test', last_name: 'Student' };
  const authUser = { id: 'different-auth-uuid', email: account.email, email_confirmed_at: '2026-10-22' };
  const consumed = new Set<string>();
  const directory = {
    rpc: async (name: string, params: any) => {
      calls.push({ name, params });
      return { data: { allowed: !options.denied, retryAfter: 42 }, error: options.rateFails ? {} : null };
    },
    from: (table: string) => {
      const query: any = {};
      query.select = () => query;
      query.ilike = (_column: string, email: string) => { assert.equal(email, account.email); return query; };
      query.eq = (_column: string, id: string) => { assert.equal(id, account.users_id); return query; };
      query.maybeSingle = async () => ({ data: table === 'users' ? account : options.noProfile ? null
        : { id: account.users_id, role: 'student', email: options.badProfile ? 'other@example.edu' : account.email },
      error: table === 'profiles' && options.profileError ? {} : null });
      return query;
    },
  } as unknown as SupabaseClient;
  const auth = { auth: {
    verifyOtp: async (params: any) => {
      calls.push({ name: 'verify', params });
      const status = options.verifyStatus ?? (consumed.has(params.token_hash) ? 400 : undefined);
      if (status) return { data: {}, error: { status, message: 'DO_NOT_EXPOSE_PROVIDER_TOKEN' } };
      consumed.add(params.token_hash);
      return { data: { user: authUser, session: { access_token: 'PRIVATE_ACCESS', refresh_token: 'PRIVATE_REFRESH' } }, error: null };
    },
    updateUser: async (params: any) => {
      calls.push({ name: 'update', params });
      if (options.updateThrows) throw new Error('DO_NOT_EXPOSE_PROVIDER_PASSWORD');
      return { data: { user: { ...authUser, id: options.updateWrongId ? 'wrong' : authUser.id } },
        error: options.updateStatus ? { status: options.updateStatus } : null };
    },
    signOut: async (params: any) => { calls.push({ name: 'signOut', params }); return { error: options.cleanupFails ? {} : null }; },
  } } as unknown as SupabaseClient;
  return { calls, directory, authUser, service: new PasswordService(() => auth, directory) };
}

test('password input is validated before any provider or limiter call; passwords are not trimmed', async () => {
  const f = fixture();
  for (const body of [null, [], {}, { ...request, email: 'injected@example.edu' }, { ...request, type: ['invite'] },
    { ...request, type: 'email' }, { ...request, tokenHash: 'short' }, { ...request, password: 'short' },
    { ...request, password: 'x'.repeat(129) }, { ...request, password: null }]) {
    await assert.rejects(() => f.service.complete(body, '127.0.0.1'), (e: any) => e.code === 'invalid_password_request');
  }
  assert.equal(f.calls.length, 0);
  assert.equal(passwordCompletionInput({ ...request, password: '  password with spaces  ' }).password, '  password with spaces  ');
});

test('invite and recovery use isolated verified identity sessions, require normal login, and reject replay', async () => {
  for (const type of ['invite', 'recovery']) {
    const f = fixture();
    assert.deepEqual(await f.service.complete({ ...request, type }, '127.0.0.1'), { requiresLogin: true });
    assert.deepEqual(f.calls.find(x => x.name === 'verify')!.params, { token_hash: request.tokenHash, type });
    assert.deepEqual(f.calls.find(x => x.name === 'signOut')!.params, { scope: 'local' });
    assert.equal(f.calls.filter(x => x.name === 'update').length, 1);
    assert.equal((await findUser(f.authUser as any, f.directory)).id, 'directory-uuid');
    await assert.rejects(() => f.service.complete({ ...request, type }, '127.0.0.1'), (e: any) => e.code === 'invalid_or_expired_link');
    assert.equal(f.calls.filter(x => x.name === 'update').length, 1);
  }
});

test('inactive, nonstudent, missing, and mismatched SIS profiles never update passwords', async () => {
  for (const options of [{ inactive: true }, { role: 'Admin' }, { role: 'Librarian' }, { noProfile: true }, { badProfile: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.service.complete(request, '127.0.0.1'), (e: any) => e.status === 403);
    assert.equal(f.calls.some(x => x.name === 'update'), false);
    assert.equal(f.calls.filter(x => x.name === 'signOut').length, 1);
  }
});

test('provider rejection, unavailable verification, and uncertain updates have safe stable errors without retries', async () => {
  for (const [options, status, code] of [
    [{ verifyStatus: 400 }, 400, 'invalid_or_expired_link'], [{ verifyStatus: 503 }, 503, 'verification_unavailable'],
    [{ verifyStatus: 429 }, 429, 'rate_limited'], [{ updateStatus: 429 }, 429, 'password_update_throttled'],
    [{ updateStatus: 422 }, 400, 'password_update_rejected'], [{ updateStatus: 500 }, 503, 'password_update_unknown'],
    [{ updateThrows: true }, 503, 'password_update_unknown'], [{ updateWrongId: true }, 503, 'password_update_unknown'],
    [{ profileError: true }, 503, 'account_verification_unavailable'],
  ] as const) {
    const f = fixture(options);
    await assert.rejects(() => f.service.complete(request, '127.0.0.1'), (e: any) => e.status === status && e.code === code && !e.message.includes('DO_NOT_EXPOSE'));
    assert.ok(f.calls.filter(x => x.name === 'update').length <= 1);
    assert.equal(f.calls.filter(x => x.name === 'verify').length, 1);
  }
  assert.deepEqual(await fixture({ cleanupFails: true }).service.complete(request, '127.0.0.1'), { requiresLogin: true });
});

test('database-backed rate protection hashes identifiers, honors cooldowns, and fails closed', async () => {
  const f = fixture();
  await reserveAccountRequest('admin_mail', ' STUDENT@EXAMPLE.EDU ', 'admin-id', f.directory);
  const params = f.calls[0].params;
  assert.match(params.p_key, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(params).includes('example.edu'), false);
  assert.equal(params.p_actor_id, 'admin-id');
  for (const options of [{ denied: true }, { rateFails: true }]) {
    const blocked = fixture(options);
    await assert.rejects(() => blocked.service.complete(request, '192.0.2.12'), (e: any) =>
      e.status === (options.denied ? 429 : 503) && (!options.denied || e.retryAfter === 42));
    assert.equal(blocked.calls.some(x => x.name === 'verify'), false);
    assert.equal(JSON.stringify(blocked.calls).includes('192.0.2.12'), false);
  }
});

test('password HTTP endpoint enforces origin, never consumes GET links, clears cookies, and never exposes tokens', async () => {
  const f = fixture();
  const app = express().use(protectCookieRequests, express.json())
    .use('/api/auth/password', createPasswordRouter(f.service)).use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/password/complete`;
  const post = (body: string, origin = config.clientUrl) => fetch(base, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' }, body });
  try {
    assert.equal((await fetch(base + '?token_hash=DO_NOT_CONSUME')).status, 404);
    assert.equal((await post(JSON.stringify(request), 'https://evil.invalid')).status, 403);
    const invalid = await post('{"password":"DO_NOT_EXPOSE"');
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.text()).includes('DO_NOT_EXPOSE'), false);
    assert.equal(f.calls.length, 0);
    const success = await post(JSON.stringify(request));
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { requiresLogin: true });
    const cookies = success.headers.get('set-cookie')!;
    assert.match(cookies, /sis_access=;/);
    assert.match(cookies, /sis_refresh=;/);
    assert.equal(cookies.includes('PRIVATE'), false);
    assert.equal(f.calls.find(x => x.name === 'sis_reserve_account_request')!.params.p_key,
      createHash('sha256').update('127.0.0.1').digest('hex'), 'Untrusted forwarded-IP header is ignored');
    const deniedService = new PasswordService(() => { throw new Error('must not verify'); }, fixture({ denied: true }).directory);
    const failed = express().use(express.json()).use(createPasswordRouter(deniedService)).use(errorHandler);
    const blockedServer = failed.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => blockedServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(blockedServer.address() as AddressInfo).port}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '42');
      assert.equal((await response.json()).code, 'rate_limited');
    } finally { await new Promise<void>(resolve => blockedServer.close(() => resolve())); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('staged templates preserve the complete non-SIS body and match only the exact SIS redirect', () => {
  const original = '<h1>LMS invitation</h1><a href="{{ .ConfirmationURL }}">Continue</a>';
  for (const type of ['invite', 'recovery'] as const) {
    const result = buildSISPasswordTemplate(original, 'https://sis.example.edu/set-password', type);
    assert.ok(result.startsWith('{{ if eq .RedirectTo "https://sis.example.edu/set-password" }}'));
    assert.ok(result.endsWith(`{{ else }}${original}{{ end }}`));
    assert.ok(result.includes(`token_hash={{ .TokenHash }}&amp;type=${type}`));
  }
  assert.throws(() => buildSISPasswordTemplate(original, 'https://sis.example.edu/set-password?next=evil', 'invite'));
  const checks = adminAuthReadiness({ uri_allow_list: 'https://sis.example.edu/**', password_min_length: 6 }, 'https://sis.example.edu/set-password');
  assert.equal(checks.exactRedirectAllowed, false);
  assert.equal(checks.passwordPolicyCompatible, true); // The backend enforces its stronger 12-character minimum.
  assert.equal(checks.customSMTPConfigured, false);
});

test('multiple service instances consult the shared reservation instead of private process counters', async () => {
  let reserved = 0;
  const shared = { rpc: async () => ({ data: { allowed: ++reserved <= 20, retryAfter: 900 }, error: null }) } as any;
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, () => reserveAccountRequest('password_complete', '127.0.0.1', undefined, shared)));
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 20);
  assert.equal(attempts.filter(x => x.status === 'rejected' && x.reason instanceof AccountError && x.reason.status === 429).length, 10);
});
