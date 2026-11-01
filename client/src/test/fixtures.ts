import type { BillingData, BillingStatement, DashboardData, GradesData, HoldsData, ScheduleData, SignedInUser } from '../types/dashboard';
import type { AdminDashboard, AuditEvent, Page, Student, StudentDetail } from '../types/admin';

export const studentUser: SignedInUser = { id: '11111111-1111-4111-8111-111111111111', fullName: 'Demo Student', email: 'student@example.invalid', role: 'student' };
export const adminUser: SignedInUser = { id: '22222222-2222-4222-8222-222222222222', fullName: 'Demo Admin', email: 'admin@example.invalid', role: 'admin' };
export const term = { id: 'term-current', code: '2026-FALL', name: 'Fall 2026', startDate: '2026-08-01', endDate: '2026-12-20', isActive: true };
export const student: Student = {
  id: studentUser.id, fullName: studentUser.fullName, firstName: 'Demo', middleName: null, lastName: 'Student',
  email: studentUser.email, studentNumber: 'STU-2026-0042', department: 'Computer Studies', program: 'BS Computer Science',
  yearLevel: 1, academicStatus: 'active', avatarUrl: null, isActive: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
};
export const dashboard: DashboardData = {
  profile: { id: student.id, studentNumber: student.studentNumber, fullName: student.fullName, email: student.email, program: student.program!, department: student.department!, yearLevel: 1, academicStatus: 'active' },
  currentTerm: term, metrics: { currentAcademicCredits: 3, cumulativeGpa: 4, creditsEarned: 3, activeHolds: 1 },
  billing: { status: 'open', dueDate: '2026-11-15', totalBilled: 1100, totalPaid: 100, outstandingBalance: 1000 },
  activeHolds: [], todaySchedule: [],
};
export const schedule: ScheduleData = { currentTerm: term, classes: [{ id: 'class-1', courseCode: 'CS101', title: 'Programming', credits: 3, sectionNumber: 'A', schedule: 'Mon 09:00', room: 'Lab 1', instructor: { name: 'Demo Instructor', email: 'instructor@example.invalid' } }] };
export const grades: GradesData = { summary: { cumulativeGpa: 4, attemptedCredits: 3, creditsEarned: 3 }, terms: [{ ...term, gpa: 4, attemptedCredits: 3, creditsEarned: 3, courses: [{ id: 'grade-1', courseCode: 'CS101', title: 'Programming', credits: 3, sectionNumber: 'A', grade: 'A', gradeStatus: 'final', isCurrent: false }] }] };
export const holds: HoldsData = {
  activeHolds: [{ id: 'hold-active', holdType: 'library_debt', reason: 'Overdue item', placedBySystem: 'Frighton LMS', placedAt: '2026-10-20T16:00:00Z', resolvedAt: null }],
  resolvedHolds: [{ id: 'hold-resolved', holdType: 'disciplinary', reason: 'Cleared conduct review', placedBySystem: 'Student Affairs', placedAt: '2026-09-01T00:00:00Z', resolvedAt: '2026-09-04T00:00:00Z' }],
};
export const currentStatement: BillingStatement = {
  id: 'statement-current', term, accountStatus: 'open', statementStatus: 'partially_paid', dueDate: '2026-11-15',
  charges: { tuition: 1000, mandatoryFees: 100, scholarships: 0 }, totalAssessed: 1100, totalPaid: 100, outstandingBalance: 1000,
  payments: [{ id: 'payment-current', amount: 100, referenceNumber: 'CURRENT-RECEIPT', receiptStatus: 'completed', paidAt: '2026-10-20T16:30:00Z', paymentChannel: 'cashier' }],
};
export const oldStatement: BillingStatement = {
  ...currentStatement, id: 'statement-old', term: { ...term, id: 'term-old', code: '2025-FALL', name: 'Fall 2025', startDate: '2025-08-01', endDate: '2025-12-20', isActive: false },
  payments: [{ ...currentStatement.payments[0], id: 'payment-old', referenceNumber: 'OLD-RECEIPT' }],
};
export const billing: BillingData = {
  isPaymentPortal: false, paymentChannel: 'cashier', paymentNotice: 'Pay at the university cashier.', officialReceiptNotice: 'Keep the official cashier receipt.',
  currentStatement, statements: [currentStatement, oldStatement],
};
export const detail: StudentDetail = { student: { ...student, auth: { invitedAt: '2026-08-01T00:00:00Z', emailConfirmedAt: '2026-08-01T01:00:00Z', lastSignInAt: null } }, dashboard, schedule, grades, holds, billing };
export const event: AuditEvent = {
  id: 'audit-1', actorId: adminUser.id, actor: { ...adminUser }, studentId: student.id, target: student,
  action: 'student.profile.updated', changes: { department: { before: null, after: 'Computer Studies' } }, createdAt: '2026-10-20T16:30:00Z',
};
export const adminDashboard: AdminDashboard = { metrics: { totalStudents: 10, activeStudents: 10, inactiveStudents: 0, probationStudents: 0, studentsWithActiveHolds: 1 }, currentTerm: term, recentActivity: [] };
export function page<T>(items: T[], extra: Partial<Page<T>> = {}): Page<T> { return { items, total: items.length, page: 1, pageSize: 25, totalPages: items.length ? 1 : 0, ...extra }; }
