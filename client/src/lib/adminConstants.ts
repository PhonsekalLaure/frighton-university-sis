import type { AcademicStatus, AuditAction } from '../types/admin';

export const statuses: AcademicStatus[] = ['active', 'probation', 'suspended', 'graduated', 'withdrawn'];
// Department names used by the university's student and course seed data.
export const departments: readonly string[] = ['Biological Sciences', 'Computer Science', 'Humanities', 'Mathematics'];
export const actionLabels: Record<AuditAction, string> = {
  'student.account.created': 'Account created', 'student.profile.updated': 'Profile updated',
  'student.access.deactivated': 'Access deactivated', 'student.access.reactivated': 'Access reactivated',
  'student.password_recovery.requested': 'Recovery instructions requested', 'student.invitation.resent': 'Invitation resend requested',
};
export const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
