import { getSupabaseAdmin } from '../config/supabase.js';

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export interface GradesClient {
  from: (table: string) => any;
}

export class GradesError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GradesError';
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

const asRows = <T>(value: T[] | null): T[] => value ?? [];
const asRecord = (value: unknown): Record<string, any> | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Record<string, any> : null;
};

function requireData(result: SupabaseResult<any>, resource: string): any {
  if (result.error) throw new Error(`Unable to load ${resource}.`);
  return result.data;
}

function gradeStatus(grade: string | null): 'final' | 'in_progress' | 'withdrawn' | 'not_recorded' {
  if (!grade) return 'not_recorded';
  if (grade === 'IP') return 'in_progress';
  if (grade === 'W') return 'withdrawn';
  return 'final';
}

/**
 * Returns the student's static transcript. Grades are academic-record
 * snapshots; this service intentionally provides no grading write workflow.
 */
export async function getGrades(
  studentId: string,
  client: GradesClient = getSupabaseAdmin() as unknown as GradesClient,
) {
  const [profileResult, recordsResult] = await Promise.all([
    client.from('profiles')
      .select('id')
      .eq('id', studentId)
      .maybeSingle(),
    client.from('academic_records')
      .select(`
        id,
        grade,
        is_current,
        section:course_sections (
          section_number,
          course:courses (course_code, title, credits),
          term:academic_terms (id, code, name, start_date, end_date, is_active)
        )
      `)
      .eq('student_id', studentId),
  ]);

  const profile = requireData(profileResult, 'profile');
  if (!profile) throw new GradesError('Your SIS profile has not been provisioned yet.', 404);

  const records = asRows<Record<string, any>>(requireData(recordsResult, 'academic records'));
  const termsById = new Map<string, Record<string, any>>();
  let attemptedCredits = 0;
  let creditsEarned = 0;
  let gradePointsTotal = 0;

  for (const record of records) {
    const section = asRecord(record.section);
    const course = asRecord(section?.course);
    const termData = asRecord(section?.term);
    if (!section || !course || !termData) continue;

    const credits = Number(course.credits ?? 0);
    const grade = record.grade ? String(record.grade).toUpperCase() : null;
    const point = grade ? gradePoints[grade] : undefined;
    let term = termsById.get(termData.id);
    if (!term) {
      term = {
        id: termData.id,
        code: termData.code,
        name: termData.name,
        startDate: termData.start_date,
        endDate: termData.end_date,
        isActive: termData.is_active,
        attemptedCredits: 0,
        creditsEarned: 0,
        gradePointsTotal: 0,
        courses: [],
      };
      termsById.set(termData.id, term);
    }

    if (point !== undefined) {
      attemptedCredits += credits;
      gradePointsTotal += point * credits;
      term.attemptedCredits += credits;
      term.gradePointsTotal += point * credits;
      if (point > 0) {
        creditsEarned += credits;
        term.creditsEarned += credits;
      }
    }

    term.courses.push({
      id: record.id,
      courseCode: course.course_code,
      title: course.title,
      credits,
      sectionNumber: section.section_number,
      grade,
      gradeStatus: gradeStatus(grade),
      isCurrent: Boolean(record.is_current),
    });
  }

  const terms = [...termsById.values()]
    .map((term) => {
      term.courses.sort((left: Record<string, any>, right: Record<string, any>) =>
        String(left.courseCode).localeCompare(String(right.courseCode))
      );
      return {
        id: term.id,
        code: term.code,
        name: term.name,
        startDate: term.startDate,
        endDate: term.endDate,
        isActive: term.isActive,
        gpa: term.attemptedCredits
          ? Number((term.gradePointsTotal / term.attemptedCredits).toFixed(2))
          : null,
        attemptedCredits: term.attemptedCredits,
        creditsEarned: term.creditsEarned,
        courses: term.courses,
      };
    })
    .sort((left, right) => String(right.startDate).localeCompare(String(left.startDate)));

  return {
    summary: {
      cumulativeGpa: attemptedCredits ? Number((gradePointsTotal / attemptedCredits).toFixed(2)) : null,
      attemptedCredits,
      creditsEarned,
    },
    terms,
  };
}
