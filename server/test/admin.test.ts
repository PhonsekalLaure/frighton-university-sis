import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { AdminService } from '../src/services/adminService.js';
import { AdminError, filters, studentInput, uuid } from '../src/services/adminValidation.js';
import { createAdminRouter } from '../src/routes/adminRoutes.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { protectCookieRequests } from '../src/middlewares/auth.js';
import { config } from '../src/config/env.js';
import { createApp } from '../src/app.js';

const actor = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const authId = '33333333-3333-4333-8333-333333333333';
const profile = { id: studentId, email: 'student@example.edu', firstName: 'Ada', lastName: 'Student',
  studentNumber: 'STU-2026-1234', isActive: true, department: 'Science', program: 'BS Science', yearLevel: 1, academicStatus: 'active' };
const input = { firstName: 'Ada', lastName: 'Student', email: profile.email,
  department: 'Science', program: 'BS Science', yearLevel: 1, academicStatus: 'active' as const };
const sqlFailure = { code: 'P0001', message: 'Internal database failure details' };

function fixture(options: { rpcError?: any; updateError?: boolean; rollbackError?: boolean; mailError?: boolean;
  duplicate?: boolean; cleanupError?: boolean; populated?: boolean; missingAuth?: boolean; lostReply?: boolean;
  unknownCommit?: boolean; inviteError?: boolean; missingStudent?: boolean; replyCode?: string;
  retrySuccess?: boolean; committedReadError?: boolean; auditAvatarUrl?: string; unconfirmed?: boolean;
  inactive?: boolean; noInvite?: boolean; wrongInviteIdentity?: boolean; mailUnknown?: boolean;
  rateDenied?: boolean; rateUnavailable?: boolean; migrationMissing?: boolean; deliveryUnknown?: boolean;
  finishLost?: boolean; finishUnavailable?: boolean; claimFails?: boolean;
  generatedUser?: Record<string, unknown> } = {}) {
  const calls: Array<{ name: string; params?: any }> = [];
  let currentAuthEmail = profile.email;
  let currentStudent: Record<string, any> = { ...profile, isActive: !options.inactive };
  let writeCalls = 0;
  let committed: any = null;
  let invitation: any = options.deliveryUnknown ? { status: 'unknown', canRetry: false } : null;
  let finishCalls = 0;
  const query = (table: string) => {
    let single = false;
    const q: any = {};
    for (const name of ['select', 'ilike', 'eq', 'is', 'gte', 'lte', 'order', 'range']) q[name] = (...params: any[]) => {
      calls.push({ name: `${table}.${name}`, params }); return q;
    };
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: any, reject: any) => {
      let data: any = single ? null : [];
      if (table === 'users' && options.duplicate) data = [{ users_id: 'other' }];
      if (table === 'admin_audit_logs' && single && committed) data = committed;
      if (table === 'profiles') data = single ? { id: studentId, student_number: profile.studentNumber } : [];
      if (table === 'academic_terms') data = options.populated ? { id: 'term-1', name: 'Current', code: '2026-1' } : null;
      if (table === 'academic_records' && options.populated) data = [{ id: 'record-1', grade: 'A', is_current: true,
        section: { term_id: 'term-1', section_number: '01', schedule: 'Thu 09:00', room: 'A',
          course: { course_code: 'CS101', title: 'Computing', credits: 3 },
          term: { id: 'term-1', name: 'Current', code: '2026-1', start_date: '2026-08-01', is_active: true } } }];
      if (table === 'student_holds' && options.populated) data = [{ id: 'hold-1', hold_type: 'library_debt', reason: 'Library debt',
        placed_by_system: 'LMS', placed_at: '2026-10-01', resolved_at: null }];
      if (table === 'student_accounts' && options.populated) data = single
        ? { id: 'account-1', base_tuition: 100, mandatory_fees: 0, scholarships: 0, status: 'open' }
        : [{ id: 'account-1', base_tuition: 100, mandatory_fees: 0, scholarships: 0, status: 'open',
          term: { id: 'term-1', name: 'Current', code: '2026-1', start_date: '2026-08-01', is_active: true },
          payments: [{ id: 'payment-1', amount: 20, receipt_status: 'completed', paid_at: '2026-10-01' }] }];
      if (table === 'student_payments' && options.populated) data = [{ amount: 20 }];
      return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 }).then(resolve, reject);
    };
    return q;
  };
  const client: any = {
    from: query,
    rpc: async (name: string, params: any) => {
      calls.push({ name, params });
      if (name === 'sis_reserve_account_request') return { data: { allowed: !options.rateDenied, retryAfter: 60 },
        error: options.rateUnavailable ? { code: '08006' } : null };
      if (name === 'admin_get_student' || name === 'admin_begin_student_change') return { data: { ...currentStudent },
        error: options.missingStudent ? { code: 'P0002' }
          : name === 'admin_get_student' && committed && options.committedReadError ? sqlFailure : null };
      if (name === 'admin_student_auth') return { data: options.missingAuth ? null : params.p_email === currentAuthEmail
        ? { id: authId, invitedAt: options.noInvite ? null : '2026-01-01',
          emailConfirmedAt: options.unconfirmed ? null : '2026-01-02', lastSignInAt: '2026-10-01' } : null, error: null };
      if (name === 'admin_invitation_ready') return { data: true, error: options.migrationMissing ? { code: 'PGRST202' } : null };
      if (name === 'admin_invitation_status') return { data: invitation, error: null };
      if (name === 'admin_claim_student_invitation') {
        if (options.claimFails) return { data: null, error: { code: '08006' } };
        invitation = { status: 'sending', canRetry: false };
        return { data: { email: profile.email, authId }, error: null };
      }
      if (name === 'admin_finish_student_invitation') {
        finishCalls++;
        invitation = { status: params.p_status, canRetry: params.p_status !== 'unknown' };
        if (options.finishUnavailable || (options.finishLost && finishCalls === 1)) return { data: null, error: { code: '08006' } };
        return { data: invitation, error: null };
      }
      if (name === 'admin_write_student' || name === 'admin_queue_student_invitation') {
        writeCalls++;
        if (options.unknownCommit) return { data: null, error: writeCalls === 1 ? { message: 'Lost response' } : sqlFailure };
        const target = { ...currentStudent, ...params.p_values, id: params.p_student_id };
        if (options.lostReply) {
          if (name === 'admin_queue_student_invitation') invitation = { status: 'queued', canRetry: true };
          currentStudent = target;
          committed = { actor_id: actor, student_id: params.p_student_id, action: params.p_action,
            target: { ...target, avatarUrl: options.auditAvatarUrl ?? target.avatarUrl } };
          if (options.retrySuccess && writeCalls > 1) return { data: committed.target, error: null };
          return { data: null, error: { code: options.replyCode, message: 'Lost transport response' } };
        }
        if (!options.rpcError) {
          currentStudent = target;
          if (name === 'admin_queue_student_invitation') invitation = { status: 'queued', canRetry: true };
        }
        return { data: target, error: options.rpcError ?? null };
      }
      if (name === 'admin_dashboard') return { data: { metrics: {}, currentTerm: null, recentActivity: [] }, error: null };
      return { data: null, error: null };
    },
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, params: any) => {
          calls.push({ name: 'smtp', params: { email, ...params } });
          if (options.mailUnknown) throw new Error('Sensitive provider details must not escape');
          return { data: { user: { id: options.wrongInviteIdentity ? actor : authId } }, error: options.mailError ? { status: 400 } : null };
        },
        generateLink: async ({ email, options: params = {} }: any) => {
          calls.push({ name: 'invite', params: { email, ...params } });
          if (options.inviteError) return { data: {}, error: { status: 500 } };
          return { data: { properties: { hashed_token: 'synthetic_invitation_token_1234567890', verification_type: 'invite' }, user: { id: options.wrongInviteIdentity ? actor : authId, email, user_metadata: params.data,
            invited_at: new Date().toISOString(), created_at: new Date().toISOString(), email_confirmed_at: null,
            ...options.generatedUser } }, error: null };
        },
        updateUserById: async (id: string, params: any) => {
          calls.push({ name: 'auth.update', params: { id, ...params } });
          const rollback = params.email === profile.email;
          if ((rollback && options.rollbackError) || (!rollback && options.updateError)) return { data: {}, error: { status: 500 } };
          currentAuthEmail = params.email;
          return { data: { user: { id, email: params.email } }, error: null };
        },
        deleteUser: async (id: string) => { calls.push({ name: 'auth.delete', params: id }); return { error: options.cleanupError ? {} : null }; },
      },
      resetPasswordForEmail: async (email: string, params: any) => {
        calls.push({ name: 'recovery', params: { email, ...params } });
        if (options.mailUnknown) throw new Error('Sensitive provider error must not escape');
        return { error: options.mailError ? { status: 400 } : null };
      },
    },
  };
  return { service: new AdminService(client), client, calls, get writeCalls() { return writeCalls; },
    get state() { return { authEmail: currentAuthEmail, student: currentStudent }; } };
}

describe('Admin validation', () => {
  test('validates fields, trims input, and rejects unsafe/immutable fields', () => {
    assert.equal(studentInput({ ...input, email: ' ADA@EXAMPLE.EDU ' }, true).email, 'ada@example.edu');
    for (const body of [{ ...input, studentNumber: 'STU-X' }, { ...input, yearLevel: 5 }, { ...input, program: ' ' },
      { ...input, role: 'admin' }, { ...input, password: 'secret' }, { ...input, avatarUrl: 'javascript:alert(1)' }]) {
      assert.throws(() => studentInput(body, true), AdminError);
    }
    assert.throws(() => studentInput({ studentNumber: profile.studentNumber }), /immutable/);
    assert.throws(() => studentInput({}), /at least one/);
    assert.throws(() => studentInput({ firstName: null }), /valid/);
    assert.equal(studentInput({ middleName: '  ' }).middleName, null);
    assert.throws(() => uuid('not-an-id'), /UUID/);
  });
  test('validates filters, bounded pagination, timestamps, and repeated parameters', () => {
    assert.deepEqual(filters({}), { page: 1, pageSize: 25 });
    assert.deepEqual(filters({ q: ' Ada ', pageSize: '100', accessStatus: 'inactive' }),
      { page: 1, pageSize: 100, q: 'Ada', accessStatus: 'inactive' });
    for (const value of [{ page: '0' }, { pageSize: '101' }, { q: ['x', 'y'] }, { foo: 'x' }, { academicStatus: 'enrolled' }]) {
      assert.throws(() => filters(value), AdminError);
    }
    assert.throws(() => filters({ action: 'delete' }, true), /action/);
    assert.throws(() => filters({ from: '2026-10-22' }, true), /ISO/);
    assert.throws(() => filters({ from: '2026-02-30T00:00:00Z' }, true), /calendar/);
    assert.throws(() => filters({ from: '2026-10-22T00:00:00Z', to: '2026-10-21T00:00:00Z' }, true), /later/);
  });
});

describe('Admin account lifecycle', () => {
  test('migration readiness is checked before generating identities or student records', async () => {
    const f = fixture({ missingAuth: true, migrationMissing: true });
    await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 503);
    assert.equal(f.calls.some(call => call.name === 'invite' || call.name === 'smtp'), false);
    assert.equal(f.writeCalls, 0);
  });
  test('SMTP rejection and uncertain delivery preserve the committed student and expose separate delivery state', async () => {
    for (const option of [{ mailError: true }, { mailUnknown: true }]) {
      const f = fixture({ missingAuth: true, ...option });
      const result = await f.service.create(actor, input);
      assert.equal(result.student.email, input.email);
      assert.equal(result.invitation.status, option.mailError ? 'failed' : 'unknown');
      assert.equal(result.invitation.canRetry, Boolean(option.mailError));
      assert.equal(f.calls.filter(call => call.name === 'smtp').length, 1);
      assert.equal(f.calls.some(call => call.name === 'auth.delete'), false);
    }
  });
  test('no email is sent before a confirmed student commit, including unresolved commit responses', async () => {
    for (const options of [{ rpcError: { code: '23505' } }, { unknownCommit: true }]) {
      const f = fixture({ missingAuth: true, ...options });
      await assert.rejects(() => f.service.create(actor, input));
      assert.equal(f.calls.some(call => call.name === 'smtp'), false);
    }
  });
  test('lost delivery status acknowledgements retry only the idempotent database update', async () => {
    for (const options of [{ finishLost: true }, { finishUnavailable: true }, { lostReply: true }]) {
      const f = fixture({ missingAuth: true, ...options });
      const result = await f.service.create(actor, input);
      assert.equal(result.student.email, input.email);
      assert.equal(f.calls.filter(call => call.name === 'smtp').length, 1);
      assert.equal(f.calls.some(call => call.name === 'auth.delete'), false);
    }
  });
  test('unknown delivery survives refresh and prevents a resend before generating a fresh link', async () => {
    const f = fixture({ unconfirmed: true, deliveryUnknown: true });
    await assert.rejects(() => f.service.resendInvitation(actor, studentId), (e: any) => e.code === 'email_delivery_unknown');
    assert.equal(f.calls.some(call => call.name === 'invite' || call.name === 'smtp'), false);
    const result = await f.service.detail(actor, studentId);
    assert.equal(result.student.invitation.status, 'unknown');
  });
  test('a lost claim response leaves a committed account without attempting SMTP', async () => {
    const f = fixture({ missingAuth: true, claimFails: true });
    const result = await f.service.create(actor, input);
    assert.equal(result.student.email, input.email);
    assert.equal(f.calls.some(call => call.name === 'smtp' || call.name === 'auth.delete'), false);
  });
  test('invites without a password and provisions once using a transaction RPC', async () => {
    const f = fixture({ missingAuth: true });
    const result = await f.service.create(actor, input);
    assert.equal(result.student.email, input.email);
    const invite = f.calls.find(x => x.name === 'invite')!;
    assert.equal(invite.params.redirectTo, new URL('/set-password', config.clientUrl).toString());
    assert.equal('password' in invite.params, false);
    const write = f.calls.find(x => x.name === 'admin_queue_student_invitation')!;
    assert.equal(write.params.p_student_id, authId);
    assert.equal(write.params.p_action, 'student.account.created');
    assert.equal('studentNumber' in write.params.p_values, false);
    assert.ok(f.calls.findIndex(x => x.name === 'invite') < f.calls.findIndex(x => x.name === 'admin_queue_student_invitation'));
    assert.equal(JSON.stringify(write.params).includes('synthetic_invitation_token'), false);
    const delivery = f.calls.find(x => x.name === 'smtp')!;
    assert.equal(delivery.params.email, input.email);
    assert.equal(delivery.params.redirectTo, new URL('/set-password', config.clientUrl).toString());
    assert.equal(delivery.params.data, undefined);
    assert.equal(result.invitation.status, 'accepted');
    assert.ok(f.calls.findIndex(x => x.name === 'admin_queue_student_invitation') < f.calls.findIndex(x => x.name === 'smtp'));
    assert.equal(f.writeCalls, 1);
  });
  test('duplicate directory and existing Auth accounts do not send invitations', async () => {
    for (const f of [fixture({ duplicate: true }), fixture()]) {
      await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 409);
      assert.equal(f.calls.some(x => x.name === 'invite'), false);
    }
  });
  test('creation ownership does not depend on synchronized application and Auth clocks', async () => {
    for (const offset of [-40_000, 40_000, -300_000]) {
      const f = fixture({ missingAuth: true, generatedUser: { created_at: new Date(Date.now() + offset).toISOString() } });
      const result = await f.service.create(actor, input);
      assert.equal(result.student.email, input.email);
      assert.equal(result.invitation.status, 'accepted');
      assert.equal(f.writeCalls, 1);
      assert.equal(f.calls.some(call => call.name === 'auth.delete'), false);
    }
  });
  test('ownership requires the current operation, matching email and an unconfirmed invitation', async () => {
    for (const generatedUser of [
      { user_metadata: {} }, { user_metadata: { sis_provisioning_operation_id: actor } },
      { email: 'someone-else@example.edu' }, { email_confirmed_at: new Date().toISOString() }, { invited_at: null },
    ]) {
      const f = fixture({ missingAuth: true, generatedUser });
      await assert.rejects(() => f.service.create(actor, input), (e: any) => e.code === 'identity_inconsistent');
      assert.equal(f.writeCalls, 0);
      assert.equal(f.calls.some(call => call.name === 'smtp' || call.name === 'auth.delete'), false);
    }
  });
  test('invitation errors do not provision or delete Auth identities', async () => {
    const f = fixture({ missingAuth: true, inviteError: true });
    await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 503);
    assert.equal(f.writeCalls, 0);
    assert.equal(f.calls.some(x => x.name === 'auth.delete'), false);
  });
  test('known provisioning failure deletes only the newly invited identity', async () => {
    const f = fixture({ missingAuth: true, rpcError: { code: '23505' } });
    await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 409);
    assert.deepEqual(f.calls.filter(x => x.name === 'auth.delete').map(x => x.params), [authId]);
  });
  test('cleanup failure is reported as 503', async () => {
    const f = fixture({ missingAuth: true, rpcError: sqlFailure, cleanupError: true });
    await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 503 && /cleanup/.test(e.message));
  });
  test('lost commit responses are reconciled without deleting a provisioned account', async () => {
    const f = fixture({ missingAuth: true, lostReply: true });
    assert.equal((await f.service.create(actor, input)).student.email, input.email);
    assert.equal(f.writeCalls, 2);
    assert.equal(f.calls.some(x => x.name === 'auth.delete'), false);
  });
  test('unknown SQLSTATE and connection outcomes reconcile committed email changes without rollback', async () => {
    for (const code of ['08006', '08007', '40003', 'PGRST001', 'ZZ999']) {
      const f = fixture({ lostReply: true, replyCode: code });
      const result = await f.service.update(actor, studentId, { email: 'new@example.edu' });
      assert.equal(result.student.email, 'new@example.edu', code);
      assert.equal(f.state.student.email, f.state.authEmail, code);
      assert.equal(f.writeCalls, 2, code);
      assert.equal(f.calls.filter(x => x.name === 'auth.update').length, 1, code);
      assert.ok(f.calls.some(x => x.name === 'admin_audit_logs.eq'), code);
    }
  });
  test('unresolved SQLSTATE outcomes retain identities and never roll Auth back', async () => {
    for (const code of ['08006', '08007', '40003', 'PGRST001', 'ZZ999']) {
      const f = fixture({ rpcError: { code } });
      await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), (e: any) => e.status === 503);
      assert.equal(f.calls.filter(x => x.name === 'auth.update').length, 1, code);
      assert.equal(f.calls.some(x => x.name === 'admin_end_student_change'), false, code);
      const created = fixture({ missingAuth: true, rpcError: { code } });
      await assert.rejects(() => created.service.create(actor, input), (e: any) => e.status === 503);
      assert.equal(created.calls.some(x => x.name === 'auth.delete'), false, code);
    }
  });
  test('definite SQL and pre-execution failures still compensate failed email changes', async () => {
    for (const code of ['23505', '23502', '42501', '55P03', '40001', '40P01', 'P0001', 'PGRST202']) {
      const f = fixture({ rpcError: { code } });
      await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), AdminError);
      assert.deepEqual(f.calls.filter(x => x.name === 'auth.update').map(x => x.params.email),
        ['new@example.edu', profile.email], code);
      assert.equal(f.writeCalls, 1, code);
    }
  });
  test('replayed or reconciled responses reload signed URLs from the profile, not the audit snapshot', async () => {
    const avatarUrl = 'https://example.invalid/avatar.png?token=REVIEW_ONLY_TOKEN#fragment';
    for (const retrySuccess of [false, true]) {
      const f = fixture({ lostReply: true, replyCode: '08007', retrySuccess,
        auditAvatarUrl: 'https://example.invalid/avatar.png' });
      const result = await f.service.update(actor, studentId, { avatarUrl });
      assert.equal(result.student.avatarUrl, avatarUrl);
      assert.ok(f.calls.some(x => x.name === 'admin_get_student'));
    }
  });
  test('a failed profile reload after confirmed commit cannot trigger email rollback', async () => {
    const f = fixture({ lostReply: true, replyCode: '08007', committedReadError: true });
    await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), (e: any) => e.status === 503);
    assert.equal(f.state.student.email, f.state.authEmail);
    assert.equal(f.calls.filter(x => x.name === 'auth.update').length, 1);
    assert.equal(f.calls.some(x => x.name === 'admin_end_student_change'), false);
  });
  test('an uncertain write followed by a known error still avoids destructive compensation', async () => {
    const f = fixture({ missingAuth: true, unknownCommit: true });
    await assert.rejects(() => f.service.create(actor, input), (e: any) => e.status === 503);
    assert.equal(f.calls.some(x => x.name === 'auth.delete'), false);
    const edited = fixture({ unknownCommit: true });
    await assert.rejects(() => edited.service.update(actor, studentId, { email: 'new@example.edu' }), (e: any) => e.status === 503);
    assert.equal(edited.calls.filter(x => x.name === 'auth.update').length, 1);
    assert.equal(edited.calls.some(x => x.name === 'admin_end_student_change'), false);
  });
  test('profile-only edits never call Auth email APIs', async () => {
    const f = fixture();
    assert.equal((await f.service.update(actor, studentId, { firstName: 'Grace' })).student.firstName, 'Grace');
    assert.equal(f.calls.some(x => x.name === 'auth.update'), false);
  });
  test('email change resolves a distinct Auth UUID and commits after Auth succeeds', async () => {
    const f = fixture();
    await f.service.update(actor, studentId, { email: 'new@example.edu' });
    assert.equal(f.calls.find(x => x.name === 'auth.update')!.params.id, authId);
    assert.ok(f.calls.findIndex(x => x.name === 'auth.update') < f.calls.findIndex(x => x.name === 'admin_write_student'));
  });
  test('database rejection rolls back Auth email and releases the lease', async () => {
    const f = fixture({ rpcError: sqlFailure });
    await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), (e: any) => e.status === 503);
    assert.deepEqual(f.calls.filter(x => x.name === 'auth.update').map(x => x.params.email), ['new@example.edu', profile.email]);
    assert.equal(f.calls.at(-1)!.name, 'admin_end_student_change');
  });
  test('Auth failure prevents the database mutation', async () => {
    const f = fixture({ updateError: true });
    await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), (e: any) => e.status === 503);
    assert.equal(f.writeCalls, 0);
  });
  test('rollback failure returns 503 and retains the lease for review', async () => {
    const f = fixture({ rpcError: sqlFailure, rollbackError: true });
    await assert.rejects(() => f.service.update(actor, studentId, { email: 'new@example.edu' }), /requires administrator review/);
    assert.equal(f.calls.some(x => x.name === 'admin_end_student_change'), false);
  });
  test('activation actions accept no profile fields', async () => {
    const f = fixture();
    await f.service.access(actor, studentId, false);
    await f.service.access(actor, studentId, true);
    assert.deepEqual(f.calls.filter(x => x.name === 'admin_write_student').map(x => [x.params.p_action, x.params.p_values]),
      [['student.access.deactivated', {}], ['student.access.reactivated', {}]]);
  });
  test('recovery is audited only after successful email submission', async () => {
    const f = fixture();
    await f.service.recovery(actor, studentId);
    assert.ok(f.calls.findIndex(x => x.name === 'recovery') < f.calls.findIndex(x => x.name === 'admin_write_student'));
    const failed = fixture({ mailError: true });
    await assert.rejects(() => failed.service.recovery(actor, studentId), /could not be sent/);
    assert.equal(failed.writeCalls, 0);
  });
  test('mail success followed by audit failure is reported without resending mail', async () => {
    const f = fixture({ rpcError: sqlFailure });
    await assert.rejects(() => f.service.recovery(actor, studentId), (e: any) => e.status === 503 && /audit recording failed/.test(e.message));
    assert.equal(f.calls.filter(x => x.name === 'recovery').length, 1);
  });
  test('missing student returns 404 before loading any domain records', async () => {
    const f = fixture({ missingStudent: true });
    await assert.rejects(() => f.service.detail(actor, studentId), (e: any) => e.status === 404);
    assert.equal(f.calls.length, 1);
  });
  test('resends a pending invitation without provisioning, metadata replacement, or deleting identities', async () => {
    const f = fixture({ unconfirmed: true });
    await f.service.resendInvitation(actor, studentId);
    assert.equal(f.calls.filter(x => x.name === 'smtp').length, 1);
    assert.equal(f.calls.some(x => x.name === 'auth.delete' || x.name === 'auth.update'), false);
    assert.equal(f.calls.find(x => x.name === 'smtp')!.params.data, undefined);
    assert.equal(f.calls.find(x => x.name === 'admin_queue_student_invitation')!.params.p_action, 'student.invitation.resent');
    assert.equal(f.writeCalls, 1);
    assert.ok(f.calls.findIndex(x => x.name === 'sis_reserve_account_request') < f.calls.findIndex(x => x.name === 'smtp'));
  });
  test('ineligible resends and unconfirmed recoveries never send mail', async () => {
    for (const options of [{}, { unconfirmed: true, noInvite: true }, { unconfirmed: true, inactive: true }]) {
      const f = fixture(options);
      await assert.rejects(() => f.service.resendInvitation(actor, studentId), (e: any) => e.status === 409);
      assert.equal(f.calls.some(x => x.name === 'invite'), false);
      assert.equal(f.writeCalls, 0);
    }
    const pending = fixture({ unconfirmed: true });
    await assert.rejects(() => pending.service.recovery(actor, studentId), (e: any) => e.code === 'invitation_pending');
    assert.equal(pending.calls.some(x => x.name === 'recovery'), false);
  });
  test('resend identity mismatch requires review and never records success or cleans up an identity', async () => {
    const f = fixture({ unconfirmed: true, wrongInviteIdentity: true });
    const result = await f.service.resendInvitation(actor, studentId);
    assert.equal(result.invitation.status, 'unknown');
    assert.equal(result.invitation.canRetry, false);
    assert.equal(f.writeCalls, 1); // Audit records the queued request, not delivery success.
    assert.equal(f.calls.some(x => x.name === 'auth.delete'), false);
  });
  test('rate denial and rate service failure block all email providers', async () => {
    for (const options of [{ rateDenied: true }, { rateUnavailable: true }]) {
      for (const action of ['create', 'recovery', 'resend'] as const) {
        const f = fixture({ ...options, missingAuth: action === 'create', unconfirmed: action === 'resend' });
        await assert.rejects(() => action === 'create' ? f.service.create(actor, input)
          : action === 'recovery' ? f.service.recovery(actor, studentId) : f.service.resendInvitation(actor, studentId),
        (e: any) => e.status === (options.rateDenied ? 429 : 503));
        assert.equal(f.calls.some(x => ['invite', 'recovery'].includes(x.name)), false);
        assert.equal(f.writeCalls, 0);
      }
    }
  });
  test('unknown mail outcome retains lease, sends once, and records no success event', async () => {
    const f = fixture({ mailUnknown: true });
    await assert.rejects(() => f.service.recovery(actor, studentId), (e: any) => e.code === 'email_delivery_unknown');
    assert.equal(f.calls.filter(x => x.name === 'recovery').length, 1);
    assert.equal(f.calls.some(x => x.name === 'admin_end_student_change'), false);
    assert.equal(f.writeCalls, 0);
  });
  test('lost resend audit response reconciles without a second email', async () => {
    const f = fixture({ unconfirmed: true, lostReply: true });
    await f.service.resendInvitation(actor, studentId);
    assert.equal(f.calls.filter(x => x.name === 'smtp').length, 1);
    assert.equal(f.writeCalls, 2);
  });
  test('student detail reuses domain services for empty and populated SIS records', async () => {
    for (const populated of [false, true]) {
      const f = fixture({ populated });
      const detail = await f.service.detail(actor, studentId);
      assert.deepEqual(Object.keys(detail).sort(), ['billing', 'dashboard', 'grades', 'holds', 'schedule', 'student']);
      assert.equal('id' in detail.student.auth, false);
      assert.equal(detail.billing.isPaymentPortal, false);
      assert.equal(detail.billing.paymentChannel, 'cashier');
      assert.equal(detail.grades.terms.length, populated ? 1 : 0);
      assert.equal(detail.holds.activeHolds.length, populated ? 1 : 0);
      assert.equal(detail.schedule.classes.length, populated ? 1 : 0);
      assert.equal(detail.billing.currentStatement?.outstandingBalance ?? 0, populated ? 80 : 0);
      assert.equal(f.writeCalls, 0);
    }
  });
  test('audit filters and pagination are applied server-side without writes', async () => {
    const f = fixture();
    const result = await f.service.auditLogs({ page: 2, pageSize: 10, studentId, actorId: actor,
      action: 'student.profile.updated', from: '2026-10-01T00:00:00Z', to: '2026-10-22T00:00:00Z' });
    assert.deepEqual(f.calls.find(x => x.name === 'admin_audit_logs.range')!.params, [10, 19]);
    assert.ok(f.calls.some(x => x.name === 'admin_audit_logs.eq' && x.params[0] === 'student_id'));
    assert.equal(result.total, 0);
    assert.equal(f.writeCalls, 0);
  });
});

describe('Admin HTTP authorization and contracts', () => {
  test('the production mount requires a session on every admin route', async () => {
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin`;
    try {
      for (const [method, path] of [['GET', '/dashboard'], ['GET', '/students'], ['POST', '/students'],
        ['GET', `/students/${studentId}`], ['PATCH', `/students/${studentId}`],
        ['POST', `/students/${studentId}/deactivate`], ['POST', `/students/${studentId}/reactivate`],
        ['POST', `/students/${studentId}/password-recovery`], ['POST', `/students/${studentId}/invitation-resend`], ['GET', '/audit-logs']]) {
        const response = await fetch(base + path, { method, headers: { origin: config.clientUrl } });
        assert.equal(response.status, 401, `${method} ${path}`);
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  test('all admin endpoints reject missing sessions/students; validation and mutation boundaries hold', async () => {
    const f = fixture();
    const app = express();
    app.use(protectCookieRequests, express.json());
    app.use('/api/v1/admin', createAdminRouter(f.service, (req, res, next) => {
      const role = req.get('x-test-role');
      if (!role) { res.status(401).json({ error: 'Sign in required.' }); return; }
      res.locals.user = { id: actor, role }; next();
    }));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin`;
    const endpoints = [['GET', '/dashboard'], ['GET', '/students'], ['POST', '/students'], ['GET', `/students/${studentId}`],
      ['PATCH', `/students/${studentId}`], ['POST', `/students/${studentId}/deactivate`], ['POST', `/students/${studentId}/reactivate`],
      ['POST', `/students/${studentId}/password-recovery`], ['POST', `/students/${studentId}/invitation-resend`], ['GET', '/audit-logs']];
    const request = (path: string, method = 'GET', role?: string, body?: unknown, origin = config.clientUrl) => fetch(base + path, {
      method, headers: { origin, 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      for (const [method, path] of endpoints) {
        assert.equal((await request(path, method)).status, 401, `${method} ${path}`);
        assert.equal((await request(path, method, 'student')).status, 403, `${method} ${path}`);
      }
      assert.equal((await request('/dashboard', 'GET', 'admin')).status, 200);
      assert.equal((await request('/students?unknown=x', 'GET', 'admin')).status, 400);
      assert.equal((await request('/students/not-a-uuid', 'GET', 'admin')).status, 400);
      assert.equal((await request(`/students/${studentId}`, 'PATCH', 'admin', { role: 'admin' })).status, 400);
      assert.equal((await request(`/students/${studentId}/deactivate`, 'POST', 'admin', { academicStatus: 'suspended' })).status, 400);
      assert.equal((await request(`/students/${studentId}/deactivate`, 'POST', 'admin', {}, 'https://evil.invalid')).status, 403);
      for (const resource of ['grades', 'holds', 'billing', 'schedule', 'payments', 'courses', 'sections']) {
        assert.equal((await request(`/students/${studentId}/${resource}`, 'POST', 'admin', {})).status, 404);
      }
      assert.equal((await request(`/students/${studentId}`, 'DELETE', 'admin')).status, 404);
      assert.equal((await request(`/students/${studentId}/password-recovery`, 'POST', 'admin', {})).status, 202);
      const created = fixture({ missingAuth: true });
      // Service validation is separately covered; the router passes creation status through.
      const statusApp = express().use(express.json()).use(createAdminRouter(created.service, (_req, res, next) => {
        res.locals.user = { id: actor, role: 'admin' }; next();
      })).use(errorHandler);
      const createServer = statusApp.listen(0, '127.0.0.1');
      await new Promise<void>(resolve => createServer.once('listening', resolve));
      try {
        const res = await fetch(`http://127.0.0.1:${(createServer.address() as AddressInfo).port}/students`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
        });
        assert.equal(res.status, 201);
      } finally { await new Promise<void>(resolve => createServer.close(() => resolve())); }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
