import type { BillingData, DashboardData, GradesData, HoldsData, ScheduleData } from './dashboard';

export type AcademicStatus = 'active' | 'probation' | 'suspended' | 'graduated' | 'withdrawn';
export type AuditAction = 'student.account.created' | 'student.profile.updated' | 'student.access.deactivated' | 'student.access.reactivated' | 'student.password_recovery.requested' | 'student.invitation.resent';
export interface Student { id: string; studentNumber: string; firstName: string; middleName: string | null; lastName: string; fullName: string; email: string; department: string | null; program: string | null; yearLevel: number | null; academicStatus: AcademicStatus; avatarUrl: string | null; isActive: boolean; createdAt: string; updatedAt: string; }
export type StudentListItem = Student & { activeHoldCount: number };
export interface StudentAuth { invitedAt: string | null; emailConfirmedAt: string | null; lastSignInAt: string | null; }
export interface StudentDetail { student: Student & { auth: StudentAuth }; dashboard: DashboardData; schedule: ScheduleData; grades: GradesData; holds: HoldsData; billing: BillingData; }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number; }
export interface AuditEvent { id: string; actorId: string; actor: { id: string; fullName: string; email: string }; action: AuditAction; studentId: string; target: Student; changes: Record<string, { before: unknown; after: unknown }>; createdAt: string; }
export interface AdminDashboard { metrics: { totalStudents: number; activeStudents: number; inactiveStudents: number; probationStudents: number; studentsWithActiveHolds: number }; currentTerm: DashboardData['currentTerm']; recentActivity: AuditEvent[]; }
