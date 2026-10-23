export type AcademicStatus = 'active' | 'probation' | 'suspended' | 'graduated' | 'withdrawn';
export type AccountStatus = 'open' | 'paid' | 'void';
export type HoldType = 'library_debt' | 'academic_probation' | 'financial_delinquency' | 'disciplinary';

export interface TermSeed { code: string; name: string; startDate: string; endDate: string; isActive: boolean; }
export interface CourseSeed { courseCode: string; title: string; description: string; credits: number; department: string; }
export interface SectionSeed { courseCode: string; termCode: string; sectionNumber: string; instructorName: string; instructorEmail: string; schedule: string; room: string; }
export interface AdminSeed { adminNumber: string; firstName: string; middleName?: string; lastName: string; email: string; department: string; }
export interface StudentSeed { studentNumber: string; firstName: string; middleName?: string; lastName: string; email: string; department: string; program: string; yearLevel: number; academicStatus: AcademicStatus; avatarUrl: string; }
export interface StudentAccountSeed { studentNumber: string; termCode: string; baseTuition: number; mandatoryFees: number; scholarships: number; status: AccountStatus; dueDate: string; }
export interface PaymentSeed { studentNumber: string; termCode: string; amount: number; referenceNumber: string; receiptStatus: 'pending' | 'completed' | 'void'; paidAt: string; }
export interface AcademicRecordSeed { studentNumber: string; courseCode: string; termCode: string; sectionNumber: string; grade: string; isCurrent: boolean; }
export interface HoldSeed { studentNumber: string; holdType: HoldType; reason: string; placedBySystem: string; placedAt: string; resolvedAt?: string; }
