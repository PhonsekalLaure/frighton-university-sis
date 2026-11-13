import type { AcademicStatus, Student } from '../types/admin';

export interface FormValues {
  firstName: string; middleName: string; lastName: string; email: string; studentNumber: string;
  department: string; program: string; yearLevel: string; academicStatus: AcademicStatus; avatarUrl: string;
}
export const fieldLimits = { firstName: 100, middleName: 100, lastName: 100, email: 254, department: 100, program: 150, avatarUrl: 2048 };
export function studentValues(student?: Student): FormValues {
  return {
    firstName: student?.firstName ?? '', middleName: student?.middleName ?? '', lastName: student?.lastName ?? '',
    email: student?.email ?? '', studentNumber: student?.studentNumber ?? '', department: student?.department ?? '',
    program: student?.program ?? '', yearLevel: student ? student.yearLevel?.toString() ?? '' : '1',
    academicStatus: student?.academicStatus ?? 'active', avatarUrl: student?.avatarUrl ?? '',
  };
}

function normalize(values: FormValues, creating: boolean): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = { academicStatus: values.academicStatus };
  for (const [key, limit] of Object.entries(fieldLimits)) {
    const value = values[key as keyof typeof fieldLimits];
    if ([...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || value.trim().length > limit) throw new Error(`${key} must contain no control characters and at most ${limit} characters.`);
    const trimmed = value.trim();
    if (!trimmed && (['firstName', 'lastName', 'email'].includes(key) || (creating && ['department', 'program'].includes(key)))) throw new Error(`${key} is required.`);
    if (trimmed || !creating) result[key] = trimmed || null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email))) throw new Error('Enter a valid university email.');
  result.email = String(result.email).toLowerCase();
  if (values.yearLevel === '') {
    if (creating) throw new Error('Year level is required.');
    result.yearLevel = null;
  } else {
    const year = Number(values.yearLevel);
    if (!Number.isInteger(year) || year < 1 || year > 4) throw new Error('Year level must be an integer from 1 to 4.');
    result.yearLevel = year;
  }
  if (result.avatarUrl) {
    try {
      const url = new URL(String(result.avatarUrl));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new Error('Avatar URL must use HTTP or HTTPS without credentials.'); }
  }
  return result;
}

export function studentPayload(values: FormValues, baseline?: Student) {
  const normalized = normalize(values, !baseline);
  if (!baseline) return normalized;
  // Existing nullable fields may be blank; normalize with edit rules.
  const before = normalize(studentValues(baseline), false);
  return Object.fromEntries(Object.entries(normalized).filter(([key, value]) => value !== before[key]));
}
