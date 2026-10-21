export type UserRole = 'student' | 'instructor' | 'registrar' | 'admin';
export type AcademicStatus = 'active' | 'probation' | 'suspended' | 'graduated' | 'withdrawn';
export type EnrollmentStatus = 'enrolled' | 'dropped' | 'waitlisted' | 'completed';
export type HoldType = 'library_debt' | 'academic_probation' | 'financial_delinquency' | 'disciplinary';

export interface Profile {
  id: string;
  student_number: string;
  frighton_id?: string;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
  academic_status: AcademicStatus;
  department?: string;
  avatar_url?: string;
  created_at: string;
}

export interface AcademicTerm {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Course {
  id: string;
  course_code: string;
  title: string;
  description: string;
  credits: number;
  department: string;
  is_active: boolean;
}

export interface CourseSection {
  id: string;
  course_id: string;
  term_id: string;
  instructor_id?: string;
  section_number: string;
  schedule: string;
  room: string;
  capacity: number;
  course?: Course;
}

export interface StudentHold {
  id: string;
  student_id: string;
  hold_type: HoldType;
  reason: string;
  placed_by_system: string;
  placed_at: string;
  resolved_at?: string | null;
}
