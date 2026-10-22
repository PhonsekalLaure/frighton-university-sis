import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { getAdminPortalClient } from '../config/supabase.js';
import { getDashboard } from './dashboardService.js';
import { getSchedule } from './scheduleService.js';
import { getGrades } from './gradesService.js';
import { getBilling } from './billingService.js';
import { getHolds } from './holdsService.js';
import { AdminError, type AuditAction, type StudentInput } from './adminValidation.js';

type Row = Record<string, any>;
type Client = Pick<SupabaseClient, 'rpc' | 'from' | 'auth'>;
const escapedEmail = (value: string) => value.replace(/[\\%_]/g, '\\$&');
function databaseError(error: Row | null): AdminError {
  const code = error?.code ?? '';
  const status = code === '23505' ? 409 : code === '42501' ? 403 : code === 'P0002' ? 404
    : code === '55P03' ? 409 : /^(22|23)/.test(code) ? 400 : 503;
  const message = status === 409 ? 'Email or student number already exists, or another account change is in progress.'
    : status === 404 ? 'Student not found.' : status === 403 ? 'Administrator access required.'
      : status === 400 ? 'Invalid student data.' : 'Administration service is temporarily unavailable. Please try again.';
  const result = new AdminError(status, message);
  // Only explicit transaction rejections or known pre-execution failures permit
  // compensation. Connection failures, 08007/40003, and unfamiliar codes do not
  // prove that the write rolled back, even if they contain a valid SQLSTATE.
  const definiteFailure = /^(22|23|42)/.test(code) || [
    'P0001', 'P0002', '55P03', '40001', '40P01',
    'PGRST000', 'PGRST002', 'PGRST003', 'PGRST202', 'PGRST203',
  ].includes(code);
  result.outcomeUnknown = !definiteFailure;
  return result;
}
function auditEvent(row: Row) {
  return { id: row.id, actorId: row.actor_id, actor: row.actor, action: row.action,
    studentId: row.student_id, target: row.target, changes: row.changes, createdAt: row.created_at };
}

/** Injected client keeps lifecycle tests isolated from real accounts and mail delivery. */
export class AdminService {
  constructor(private readonly injectedClient?: Client) {}
  private get client(): Client { return this.injectedClient ?? getAdminPortalClient(); }

  private async rpc(name: string, params: Row): Promise<any> {
    try {
      const { data, error } = await this.client.rpc(name, params);
      if (error) throw databaseError(error);
      return data;
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw databaseError(null);
    }
  }

  async dashboard(actorId: string) {
    const result = await this.rpc('admin_dashboard', { p_actor_id: actorId });
    return { ...result, recentActivity: result.recentActivity.map(auditEvent) };
  }
  async students(actorId: string, filters: Row) {
    return this.rpc('admin_list_students', { p_actor_id: actorId, p_filters: filters });
  }
  async student(actorId: string, studentId: string) {
    return this.rpc('admin_get_student', { p_actor_id: actorId, p_student_id: studentId });
  }
  private async authIdentity(actorId: string, email: string): Promise<Row | null> {
    return this.rpc('admin_student_auth', { p_actor_id: actorId, p_email: email });
  }
  async detail(actorId: string, studentId: string) {
    const student = await this.student(actorId, studentId);
    try {
      const [auth, dashboard, schedule, grades, holds, billing] = await Promise.all([
        this.authIdentity(actorId, student.email), getDashboard(studentId, this.client),
        getSchedule(studentId, this.client), getGrades(studentId, this.client),
        getHolds(studentId, this.client), getBilling(studentId, this.client),
      ]);
      return { student: { ...student, auth: auth ? { invitedAt: auth.invitedAt,
        emailConfirmedAt: auth.emailConfirmedAt, lastSignInAt: auth.lastSignInAt } : null },
      dashboard, schedule, grades, holds, billing };
    } catch { throw new AdminError(503, 'Unable to load the complete student record. Please try again.'); }
  }
  async auditLogs(filters: Row) {
    try {
      let query = this.client.from('admin_audit_logs')
        .select('id,actor_id,actor,action,student_id,target,changes,created_at', { count: 'exact' });
      for (const [filter, column] of [['action', 'action'], ['studentId', 'student_id'], ['actorId', 'actor_id']]) {
        if (filters[filter]) query = query.eq(column, filters[filter]);
      }
      if (filters.from) query = query.gte('created_at', filters.from);
      if (filters.to) query = query.lte('created_at', filters.to);
      const start = (filters.page - 1) * filters.pageSize;
      const { data, error, count } = await query.order('created_at', { ascending: false })
        .order('id', { ascending: false }).range(start, start + filters.pageSize - 1);
      if (error) throw databaseError(error);
      return { items: (data ?? []).map(auditEvent), page: filters.page, pageSize: filters.pageSize,
        total: count ?? 0, totalPages: Math.ceil((count ?? 0) / filters.pageSize) };
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw databaseError(null);
    }
  }
  private async checkDuplicates(email: string, studentNumber?: string, excludingId?: string) {
    const queries = [this.client.from('users').select('users_id').ilike('email', escapedEmail(email)),
      this.client.from('profiles').select('id').ilike('email', escapedEmail(email))];
    if (studentNumber) queries.push(this.client.from('profiles').select('id').eq('student_number', studentNumber));
    try {
      for (const query of queries) {
        const { data, error } = await query;
        if (error) throw databaseError(error);
        if ((data ?? []).some((row: Row) => (row.users_id ?? row.id) !== excludingId)) {
          throw new AdminError(409, 'Email or student number already exists.');
        }
      }
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw databaseError(null);
    }
  }
  private async write(actorId: string, studentId: string, operationId: string, action: AuditAction, values: StudentInput = {}) {
    const params = { p_actor_id: actorId, p_student_id: studentId, p_operation_id: operationId,
      p_action: action, p_values: values };
    let uncertain = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const student = await this.rpc('admin_write_student', params);
        // A replay returns an audit snapshot, whose URLs are deliberately redacted.
        return attempt === 0 ? student : await this.committedStudent(actorId, studentId);
      }
      catch (error) {
        if (!(error instanceof AdminError) || (!error.outcomeUnknown && !uncertain)) throw error;
        uncertain = true;
        if (attempt === 0) continue;
        // A lost HTTP response must not cause deletion/rollback of a committed account.
        try {
          const { data, error: readError } = await this.client.from('admin_audit_logs')
            .select('actor_id,student_id,action').eq('id', operationId).maybeSingle();
          if (!readError && data?.actor_id === actorId && data?.student_id === studentId && data?.action === action) {
            return await this.committedStudent(actorId, studentId);
          }
        } catch { /* Preserve the uncertain outcome below. */ }
        error.outcomeUnknown = true;
        throw error;
      }
    }
  }
  private async committedStudent(actorId: string, studentId: string) {
    try { return await this.student(actorId, studentId); }
    catch {
      const error = new AdminError(503, 'The account change committed, but its updated record could not be loaded. Refresh the account before retrying.');
      error.outcomeUnknown = true; // Never compensate a known commit after a read failure.
      throw error;
    }
  }
  async create(actorId: string, input: StudentInput) {
    await this.checkDuplicates(input.email!, input.studentNumber);
    if (await this.authIdentity(actorId, input.email!)) throw new AdminError(409, 'An authentication account already uses this email.');
    const operationId = randomUUID();
    const startedAt = Date.now();
    let user;
    try {
      const { data, error } = await this.client.auth.admin.inviteUserByEmail(input.email!, {
        redirectTo: new URL('/set-password', config.clientUrl).toString(),
        data: { first_name: input.firstName, last_name: input.lastName, sis_provisioning_operation_id: operationId },
      });
      if (error || !data.user) {
        throw new AdminError(['email_exists', 'user_already_exists', 'email_already_registered'].includes(error?.code ?? '') ? 409 : 503,
          'Unable to invite the student. Check email availability and authentication service configuration.');
      }
      user = data.user;
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw new AdminError(503, 'The invitation could not be confirmed. Check the account before retrying.');
    }
    // Never compensate by deleting an identity whose ownership is uncertain.
    const ownsInvite = user.user_metadata?.sis_provisioning_operation_id === operationId &&
      Date.parse(user.created_at) >= startedAt - 1000 && Boolean(user.invited_at);
    if (!ownsInvite) throw new AdminError(503, 'Invitation ownership could not be confirmed. Account provisioning requires review.');
    try {
      return { student: await this.write(actorId, user.id, operationId, 'student.account.created', input) };
    } catch (error) {
      if (error instanceof AdminError && error.outcomeUnknown) {
        console.error('SIS provisioning outcome requires review', { operationId, authUserId: user.id });
        throw error;
      }
      try {
        const { data, error: lookupError } = await this.client.from('users').select('users_id').eq('users_id', user.id).maybeSingle();
        if (lookupError || data) throw new Error('Directory state could not be safely compensated.');
        const { error: cleanupError } = await this.client.auth.admin.deleteUser(user.id);
        if (cleanupError) throw cleanupError;
      } catch {
        console.error('SIS invitation cleanup requires review', { operationId, authUserId: user.id });
        throw new AdminError(503, 'Account provisioning failed and invitation cleanup requires administrator review.');
      }
      throw error;
    }
  }
  private async change(actorId: string, studentId: string, action: AuditAction, input: StudentInput = {}) {
    const operationId = randomUUID();
    const before = await this.rpc('admin_begin_student_change', {
      p_actor_id: actorId, p_student_id: studentId, p_operation_id: operationId,
    });
    let changedAuth: Row | null = null;
    let release = true;
    let recoverySent = false;
    try {
      if (action === 'student.profile.updated' && input.email && input.email !== before.email) {
        await this.checkDuplicates(input.email, undefined, studentId);
        const auth = await this.authIdentity(actorId, before.email);
        if (!auth) throw new AdminError(503, 'The student has no matching authentication identity.');
        if (await this.authIdentity(actorId, input.email)) throw new AdminError(409, 'An authentication account already uses this email.');
        changedAuth = auth;
        // Record the attempted change before awaiting; network errors can follow a successful Auth update.
        const { data, error } = await this.client.auth.admin.updateUserById(auth.id, { email: input.email });
        if (error || data.user?.email?.toLowerCase() !== input.email) {
          throw new AdminError(error?.status === 422 ? 409 : 503, 'Unable to update the authentication email.');
        }
      }
      if (action === 'student.password_recovery.requested') {
        if (!await this.authIdentity(actorId, before.email)) throw new AdminError(503, 'The student has no matching authentication identity.');
        const { error } = await this.client.auth.resetPasswordForEmail(before.email, {
          redirectTo: new URL('/set-password', config.clientUrl).toString(),
        });
        if (error) throw new AdminError(503, 'Password recovery could not be sent. Please try again later.');
        recoverySent = true;
      }
      const student = await this.write(actorId, studentId, operationId, action, input);
      return { student };
    } catch (error) {
      if (recoverySent) console.error('SIS recovery email submitted but audit outcome requires review', { operationId, studentId });
      if (error instanceof AdminError && error.outcomeUnknown) {
        release = false;
        console.error('SIS account change outcome requires review', { operationId, studentId });
        throw new AdminError(503, 'The account change outcome could not be confirmed. Review the account before retrying.');
      }
      if (changedAuth) {
        try {
          const { data, error: rollbackError } = await this.client.auth.admin.updateUserById(changedAuth.id, { email: before.email });
          if (rollbackError || data.user?.email?.toLowerCase() !== before.email.toLowerCase()) throw new Error('Rollback failed.');
        } catch {
          release = false;
          console.error('SIS authentication email rollback requires review', { operationId, studentId });
          throw new AdminError(503, 'Email synchronization failed and requires administrator review.');
        }
      }
      if (recoverySent) throw new AdminError(503, 'Recovery email was requested, but audit recording failed. Review the account before retrying.');
      if (error instanceof AdminError) throw error;
      throw new AdminError(503, 'The account change could not be completed. Please try again.');
    } finally {
      if (release) {
        try { await this.rpc('admin_end_student_change', { p_student_id: studentId, p_operation_id: operationId }); }
        catch { console.error('SIS account lease release failed', { operationId, studentId }); }
      }
    }
  }
  update(actorId: string, studentId: string, input: StudentInput) {
    return this.change(actorId, studentId, 'student.profile.updated', input);
  }
  access(actorId: string, studentId: string, active: boolean) {
    return this.change(actorId, studentId, active ? 'student.access.reactivated' : 'student.access.deactivated');
  }
  async recovery(actorId: string, studentId: string) {
    await this.change(actorId, studentId, 'student.password_recovery.requested');
    return { message: 'Password recovery instructions requested.' };
  }
}
