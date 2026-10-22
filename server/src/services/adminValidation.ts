export class AdminError extends Error {
  outcomeUnknown = false;
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

export const academicStatuses = ['active', 'probation', 'suspended', 'graduated', 'withdrawn'] as const;
export const auditActions = ['student.account.created', 'student.profile.updated', 'student.access.deactivated',
  'student.access.reactivated', 'student.password_recovery.requested', 'student.invitation.resent'] as const;
export type AuditAction = typeof auditActions[number];
export interface StudentInput {
  firstName?: string; middleName?: string | null; lastName?: string; email?: string;
  department?: string | null; program?: string | null; yearLevel?: number | null;
  academicStatus?: typeof academicStatuses[number]; avatarUrl?: string | null; studentNumber?: string;
}
const limits: Record<string, number> = {
  firstName: 100, middleName: 100, lastName: 100, email: 254, department: 100, program: 150,
  avatarUrl: 2048, studentNumber: 50, q: 100,
};
export function uuid(value: unknown, field = 'studentId'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AdminError(400, `${field} must be a UUID.`);
  }
  return value;
}
function text(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.trim().length > limits[field] || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AdminError(400, `Enter a valid ${field} (maximum ${limits[field]} characters).`);
  }
  const result = value.trim();
  if (!result && !nullable) throw new AdminError(400, `${field} is required.`);
  return result || null;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminError(400, 'Send a JSON object.');
  return value as Record<string, unknown>;
}
export function studentInput(body: unknown, creating = false): StudentInput {
  const source = object(body);
  const allowed = ['firstName', 'middleName', 'lastName', 'email', 'department', 'program', 'yearLevel', 'academicStatus', 'avatarUrl'];
  if (creating) allowed.push('studentNumber');
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new AdminError(400, 'Unknown or immutable student field.');
  if (!Object.keys(source).length) throw new AdminError(400, 'Provide at least one profile field.');
  if (creating && ['firstName', 'lastName', 'email', 'studentNumber', 'department', 'program', 'yearLevel', 'academicStatus']
    .some(key => source[key] === undefined || source[key] === null || source[key] === '')) {
    throw new AdminError(400, 'Name, email, student number, department, program, year level, and academic status are required.');
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'yearLevel') {
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4)) {
        throw new AdminError(400, 'yearLevel must be an integer from 1 to 4 or null.');
      }
      result[key] = value;
    } else if (key === 'academicStatus') {
      if (!academicStatuses.includes(value as any)) throw new AdminError(400, 'Invalid academicStatus.');
      result[key] = value;
    } else {
      result[key] = text(value, key, ['middleName', 'department', 'program', 'avatarUrl'].includes(key));
    }
  }
  if (result.email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email))) throw new AdminError(400, 'Enter a valid email address.');
    result.email = String(result.email).toLowerCase();
  }
  if (result.studentNumber !== undefined && !/^STU-\d{4}-\d{4,}$/.test(String(result.studentNumber))) {
    throw new AdminError(400, 'studentNumber must match STU-YYYY-NNNN or a longer numeric sequence.');
  }
  if (result.avatarUrl) {
    try {
      const url = new URL(String(result.avatarUrl));
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new AdminError(400, 'avatarUrl must be an HTTP or HTTPS URL without credentials.'); }
  }
  if (creating && ['department', 'program'].some(key => result[key] === null)) {
    throw new AdminError(400, 'Department and program are required.');
  }
  return result as StudentInput;
}
export function emptyBody(body: unknown): void {
  if (body !== undefined && Object.keys(object(body)).length) throw new AdminError(400, 'This action does not accept profile fields.');
}
export function filters(query: unknown, audit = false): Record<string, unknown> {
  const source = object(query);
  const allowed = audit ? ['page', 'pageSize', 'action', 'studentId', 'actorId', 'from', 'to']
    : ['page', 'pageSize', 'q', 'accessStatus', 'academicStatus', 'department'];
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new AdminError(400, 'Unknown filter.');
  const result: Record<string, any> = { page: 1, pageSize: 25 };
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') throw new AdminError(400, `${key} must be a single value.`);
    if (['page', 'pageSize'].includes(key)) {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > (key === 'pageSize' ? 100 : 1000000)) {
        throw new AdminError(400, `Invalid ${key}.`);
      }
      result[key] = Number(value);
    } else if (['studentId', 'actorId'].includes(key)) result[key] = uuid(value, key);
    else if (['from', 'to'].includes(key)) {
      if (value.length > 35 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new AdminError(400, `${key} must be an ISO timestamp with a timezone.`);
      }
      if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new AdminError(400, `${key} must contain a valid calendar date.`);
      }
      result[key] = new Date(value).toISOString();
    } else if (key === 'accessStatus') {
      if (!['active', 'inactive'].includes(value)) throw new AdminError(400, 'Invalid accessStatus.');
      result[key] = value;
    } else if (key === 'academicStatus') {
      if (!academicStatuses.includes(value as any)) throw new AdminError(400, 'Invalid academicStatus.');
      result[key] = value;
    } else if (key === 'action') {
      if (!auditActions.includes(value as AuditAction)) throw new AdminError(400, 'Invalid audit action.');
      result[key] = value;
    } else result[key] = text(value, key);
  }
  if (result.from && result.to && result.from > result.to) throw new AdminError(400, 'from must not be later than to.');
  return result;
}
