export interface SignedInUser {
  fullName: string;
  email: string;
  role: 'student' | 'admin';
}

export interface DashboardData {
  profile: {
    id: string;
    studentNumber: string;
    fullName: string;
    email: string;
    department?: string;
    program?: string;
    yearLevel?: string | number;
    academicStatus?: string;
    avatarUrl?: string | null;
  };
  currentTerm: { id: string; code: string; name: string; startDate: string; endDate: string } | null;
  metrics: { currentAcademicCredits: number; cumulativeGpa: number | null; creditsEarned: number; activeHolds: number };
  billing: { status: string | null; dueDate: string | null; totalBilled: number; totalPaid: number; outstandingBalance: number };
  activeHolds: Array<{ id: string; holdType: string; reason: string; placedBySystem: string; placedAt: string }>;
  todaySchedule: Array<{ courseCode: string; title: string; credits: number; schedule: string | null; room: string | null; instructorName: string | null }>;
}

export interface ScheduleData {
  currentTerm: DashboardData['currentTerm'];
  classes: Array<{ id: string; courseCode: string; title: string; credits: number; sectionNumber: string; schedule: string | null; room: string | null; instructor: { name: string | null; email: string | null } }>;
}

export interface GradesData {
  summary: { cumulativeGpa: number | null; attemptedCredits: number; creditsEarned: number };
  terms: Array<{ id: string; code: string; name: string; startDate: string; endDate: string; isActive: boolean; gpa: number | null; attemptedCredits: number; creditsEarned: number; courses: Array<{ id: string; courseCode: string; title: string; credits: number; sectionNumber: string; grade: string | null; gradeStatus: string; isCurrent: boolean }> }>;
}

export interface BillingStatement {
  id: string;
  term: { id: string; code: string; name: string; startDate: string; endDate: string; isActive: boolean };
  accountStatus: string;
  statementStatus: string;
  dueDate: string | null;
  charges: { tuition: number; mandatoryFees: number; scholarships: number };
  totalAssessed: number;
  totalPaid: number;
  outstandingBalance: number;
  payments: Array<{ id: string; amount: number; referenceNumber: string | null; receiptStatus: string; paidAt: string; paymentChannel: string }>;
}

export interface BillingData {
  isPaymentPortal: false;
  paymentChannel: string;
  paymentNotice: string;
  officialReceiptNotice: string;
  currentStatement: BillingStatement | null;
  statements: BillingStatement[];
}
