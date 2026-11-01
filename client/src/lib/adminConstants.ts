import type { AcademicStatus, AuditAction } from '../types/admin';

export const statuses: AcademicStatus[] = ['active', 'probation', 'suspended', 'graduated', 'withdrawn'];
export const actionLabels: Record<AuditAction, string> = {
  'student.account.created': 'Account created', 'student.profile.updated': 'Profile updated',
  'student.access.deactivated': 'Access deactivated', 'student.access.reactivated': 'Access reactivated',
  'student.password_recovery.requested': 'Recovery instructions requested', 'student.invitation.resent': 'Invitation resent',
};
export const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
