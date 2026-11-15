import type { AcademicStatus } from './index';

export interface StudentProfile {
  id: string;
  studentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  email: string;
  department: string | null;
  program: string | null;
  yearLevel: number | null;
  academicStatus: AcademicStatus;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
