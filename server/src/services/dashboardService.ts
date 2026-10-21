import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export interface DashboardClient {
  from: (table: string) => any;
}

export class DashboardError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'DashboardError';
  }
}

const gradePoints: Record<string, number> = {
  A: 4,
  'A-': 3.7,
  'B+': 3.3,
  B: 3,
  'B-': 2.7,
  'C+': 2.3,
  C: 2,
  'C-': 1.7,
  D: 1,
  F: 0,
};

const asNumber = (value: unknown): number => Number(value ?? 0);
const asRows = <T>(value: T[] | null): T[] => value ?? [];
const asRecord = (value: unknown): Record<string, any> | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Record<string, any> : null;
};

function isScheduledToday(schedule: string | null, date: Date): boolean {
  if (!schedule) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'Asia/Manila',
  }).format(date).toLowerCase();
  const shortWeekday = weekday.slice(0, 3);
  const normalized = schedule.toLowerCase();
  return new RegExp(`\\b(${weekday}|${shortWeekday})\\b`, 'i').test(normalized);
}

function requireData(result: SupabaseResult<any>, resource: string): any {
  if (result.error) throw new Error(`Unable to load ${resource}.`);
  return result.data;
}

/**
 * Builds the data used by the authenticated student's SIS dashboard.  It reads
 * academic assignments rather than registration/enrollment records.
 */
export async function getDashboard(
  studentId: string,
  client: DashboardClient = getSupabaseAdmin() as unknown as DashboardClient,
  now: Date = new Date(),
) {
  const [profileResult, termResult, recordsResult, holdsResult] = await Promise.all([
    client.from('profiles')
      .select('id, student_number, first_name, last_name, email, department, program, year_level, academic_status, avatar_url')
      .eq('id', studentId)
      .maybeSingle(),
    client.from('academic_terms')
      .select('id, code, name, start_date, end_date')
      .eq('is_active', true)
      .maybeSingle(),
    client.from('academic_records')
      .select(`
        grade,
        is_current,
        section:course_sections (
          schedule,
          room,
          instructor_name,
          instructor_email,
          course:courses (course_code, title, credits),
          term:academic_terms (id, code, name)
        )
      `)
      .eq('student_id', studentId),
    client.from('student_holds')
      .select('id, hold_type, reason, placed_by_system, placed_at')
      .eq('student_id', studentId)
      .is('resolved_at', null),
  ]);

  const profile = requireData(profileResult, 'profile');
  if (!profile) throw new DashboardError('Your SIS profile has not been provisioned yet.', 404);

  const currentTerm = requireData(termResult, 'current academic term');
  const records = asRows<Record<string, any>>(requireData(recordsResult, 'academic records'));
  const activeHolds = asRows<Record<string, any>>(requireData(holdsResult, 'student holds'));

  let account: Record<string, any> | null = null;
  let payments: Record<string, any>[] = [];
  if (currentTerm) {
    const accountResult = await client.from('student_accounts')
      .select('id, base_tuition, mandatory_fees, scholarships, status, due_date')
      .eq('student_id', studentId)
      .eq('term_id', currentTerm.id)
      .maybeSingle();
    account = requireData(accountResult, 'student account');

    if (account) {
      const paymentResult = await client.from('student_payments')
        .select('amount')
        .eq('account_id', account.id)
        .eq('receipt_status', 'completed');
      payments = asRows<Record<string, any>>(requireData(paymentResult, 'student payments'));
    }
  }

  let attemptedCredits = 0;
  let gradePointsTotal = 0;
  let earnedCredits = 0;
  let currentAcademicCredits = 0;
  const todaySchedule: Array<Record<string, unknown>> = [];

  for (const record of records) {
    const section = asRecord(record.section);
    const course = asRecord(section?.course);
    const term = asRecord(section?.term);
    if (!section || !course) continue;

    const credits = asNumber(course.credits);
    const grade = String(record.grade ?? '').toUpperCase();
    const point = gradePoints[grade];
    if (point !== undefined) {
      attemptedCredits += credits;
      gradePointsTotal += point * credits;
      if (point > 0) earnedCredits += credits;
    }

    const isCurrentAssignment = Boolean(record.is_current) || term?.id === currentTerm?.id;
    if (isCurrentAssignment) {
      currentAcademicCredits += credits;
      if (isScheduledToday(section.schedule ?? null, now)) {
        todaySchedule.push({
          courseCode: course.course_code,
          title: course.title,
          credits,
          schedule: section.schedule,
          room: section.room,
          instructorName: section.instructor_name,
          instructorEmail: section.instructor_email,
        });
      }
    }
  }

  const totalBilled = account
    ? asNumber(account.base_tuition) + asNumber(account.mandatory_fees) - asNumber(account.scholarships)
    : 0;
  const totalPaid = payments.reduce((total, payment) => total + asNumber(payment.amount), 0);

  return {
    profile: {
      id: profile.id,
      studentNumber: profile.student_number,
      fullName: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      email: profile.email,
      department: profile.department,
      program: profile.program,
      yearLevel: profile.year_level,
      academicStatus: profile.academic_status,
      avatarUrl: profile.avatar_url,
    },
    currentTerm: currentTerm ? {
      id: currentTerm.id,
      code: currentTerm.code,
      name: currentTerm.name,
      startDate: currentTerm.start_date,
      endDate: currentTerm.end_date,
    } : null,
    metrics: {
      currentAcademicCredits,
      cumulativeGpa: attemptedCredits ? Number((gradePointsTotal / attemptedCredits).toFixed(2)) : null,
      creditsEarned: earnedCredits,
      activeHolds: activeHolds.length,
    },
    billing: {
      status: account?.status ?? null,
      dueDate: account?.due_date ?? null,
      totalBilled,
      totalPaid,
      outstandingBalance: Math.max(0, totalBilled - totalPaid),
    },
    activeHolds: activeHolds.map((hold) => ({
      id: hold.id,
      holdType: hold.hold_type,
      reason: hold.reason,
      placedBySystem: hold.placed_by_system,
      placedAt: hold.placed_at,
    })),
    todaySchedule,
  };
}
