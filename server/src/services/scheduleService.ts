import { getSupabaseAdmin } from '../config/supabase.js';

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export interface ScheduleClient {
  from: (table: string) => any;
}

export class ScheduleError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ScheduleError';
  }
}

const asRows = <T>(value: T[] | null): T[] => value ?? [];
const asRecord = (value: unknown): Record<string, any> | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Record<string, any> : null;
};

function requireData(result: SupabaseResult<any>, resource: string): any {
  if (result.error) throw new Error(`Unable to load ${resource}.`);
  return result.data;
}

/**
 * Returns the authenticated student's current-term academic assignments. This
 * is a published schedule, not an enrollment or registration record.
 */
export async function getSchedule(
  studentId: string,
  client: ScheduleClient = getSupabaseAdmin() as unknown as ScheduleClient,
) {
  const [profileResult, termResult] = await Promise.all([
    client.from('profiles')
      .select('id')
      .eq('id', studentId)
      .maybeSingle(),
    client.from('academic_terms')
      .select('id, code, name, start_date, end_date')
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  const profile = requireData(profileResult, 'profile');
  if (!profile) throw new ScheduleError('Your SIS profile has not been provisioned yet.', 404);

  const currentTerm = requireData(termResult, 'current academic term');
  if (!currentTerm) {
    return { currentTerm: null, classes: [] };
  }

  const recordsResult = await client.from('academic_records')
    .select(`
      id,
      section:course_sections (
        term_id,
        section_number,
        schedule,
        room,
        instructor_name,
        instructor_email,
        course:courses (course_code, title, credits)
      )
    `)
    .eq('student_id', studentId)
    .eq('is_current', true);

  const records = asRows<Record<string, any>>(requireData(recordsResult, 'current academic assignments'));
  const classes = records.flatMap((record) => {
    const section = asRecord(record.section);
    const course = asRecord(section?.course);
    if (!section || !course || section.term_id !== currentTerm.id) return [];

    return [{
      id: record.id,
      courseCode: course.course_code,
      title: course.title,
      credits: Number(course.credits),
      sectionNumber: section.section_number,
      schedule: section.schedule,
      room: section.room,
      instructor: {
        name: section.instructor_name,
        email: section.instructor_email,
      },
    }];
  });

  classes.sort((left, right) => {
    const scheduleComparison = String(left.schedule ?? '').localeCompare(String(right.schedule ?? ''));
    return scheduleComparison || String(left.courseCode ?? '').localeCompare(String(right.courseCode ?? ''));
  });

  return {
    currentTerm: {
      id: currentTerm.id,
      code: currentTerm.code,
      name: currentTerm.name,
      startDate: currentTerm.start_date,
      endDate: currentTerm.end_date,
    },
    classes,
  };
}
