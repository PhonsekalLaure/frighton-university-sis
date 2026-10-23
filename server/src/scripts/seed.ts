import { getSupabaseAdmin } from '../config/supabase.js';
import { admins } from '../seed-data/admins.js';
import { academicRecords } from '../seed-data/academicRecords.js';
import { courses } from '../seed-data/courses.js';
import { holds } from '../seed-data/holds.js';
import { payments } from '../seed-data/payments.js';
import { sections } from '../seed-data/sections.js';
import { studentAccounts } from '../seed-data/studentAccounts.js';
import { students } from '../seed-data/students.js';
import { terms } from '../seed-data/terms.js';
import { assertSISLMSProject } from './projectGuard.js';

const DEFAULT_STUDENT_PASSWORD = 'Student2026!';
const DEFAULT_ADMIN_PASSWORD = 'AdminPortal2026!';

function failOnError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

const makeKey = (...parts: string[]) => parts.join('::');

export async function seedDatabase(): Promise<void> {
  assertSISLMSProject();
  const supabase = getSupabaseAdmin();

  const { error: termsError } = await supabase.from('academic_terms').upsert(
    terms.map((term) => ({
      code: term.code, name: term.name, start_date: term.startDate, end_date: term.endDate, is_active: term.isActive,
    })),
    { onConflict: 'code' }
  );
  failOnError(termsError, 'Upserting terms');

  const { error: coursesError } = await supabase.from('courses').upsert(
    courses.map((course) => ({
      course_code: course.courseCode, title: course.title, description: course.description,
      credits: course.credits, department: course.department,
    })),
    { onConflict: 'course_code' }
  );
  failOnError(coursesError, 'Upserting courses');

  const [{ data: termRows, error: termReadError }, { data: courseRows, error: courseReadError }] = await Promise.all([
    supabase.from('academic_terms').select('id, code'),
    supabase.from('courses').select('id, course_code'),
  ]);
  failOnError(termReadError, 'Reading terms');
  failOnError(courseReadError, 'Reading courses');
  const termIds = new Map((termRows ?? []).map((term) => [term.code, term.id]));
  const courseIds = new Map((courseRows ?? []).map((course) => [course.course_code, course.id]));

  const sectionRows = sections.map((section) => {
    const courseId = courseIds.get(section.courseCode);
    const termId = termIds.get(section.termCode);
    if (!courseId || !termId) throw new Error(`Unknown course or term for ${section.courseCode} ${section.sectionNumber}.`);
    return {
      course_id: courseId, term_id: termId, section_number: section.sectionNumber,
      instructor_name: section.instructorName, instructor_email: section.instructorEmail,
      schedule: section.schedule, room: section.room,
    };
  });
  const { error: sectionsError } = await supabase.from('course_sections').upsert(sectionRows, {
    onConflict: 'course_id,term_id,section_number',
  });
  failOnError(sectionsError, 'Upserting course sections');

  const studentIds = new Map<string, string>();

  for (const admin of admins) {
    const { data: existingDirectoryUser, error: directoryReadError } = await supabase
      .from('users').select('users_id').eq('email', admin.email).maybeSingle();
    failOnError(directoryReadError, `Reading directory user ${admin.email}`);

    let authUser;
    if (existingDirectoryUser) {
      const { data: existingAuth, error: existingAuthError } = await supabase.auth.admin.getUserById(
        existingDirectoryUser.users_id
      );
      failOnError(existingAuthError, `Reading Auth user ${admin.email}`);
      if (!existingAuth.user) throw new Error(`Directory user ${admin.email} has no matching Auth user.`);

      const { data, error } = await supabase.auth.admin.updateUserById(existingAuth.user.id, {
        password: DEFAULT_ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: admin.firstName, last_name: admin.lastName },
      });
      failOnError(error, `Updating Auth user ${admin.email}`);
      if (!data.user) throw new Error(`Updating Auth user ${admin.email} returned no user.`);
      authUser = data.user;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: admin.email,
        password: DEFAULT_ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: admin.firstName, last_name: admin.lastName },
      });
      failOnError(error, `Creating Auth user ${admin.email}`);
      if (!data.user) throw new Error(`Creating Auth user ${admin.email} returned no user.`);
      authUser = data.user;
    }
    if (!authUser) throw new Error(`No Auth user returned for ${admin.email}.`);

    const { error: userError } = await supabase.from('users').upsert({
      users_id: authUser.id, first_name: admin.firstName, middle_name: admin.middleName ?? null,
      last_name: admin.lastName, email: admin.email, password: '[MANAGED_BY_SUPABASE_AUTH]',
      role: 'Admin', is_active: true,
    }, { onConflict: 'users_id' });
    failOnError(userError, `Upserting directory user ${admin.email}`);

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: authUser.id, student_number: admin.adminNumber, first_name: admin.firstName,
      last_name: admin.lastName, email: admin.email, role: 'admin', academic_status: 'active',
      department: admin.department, program: null, year_level: null, avatar_url: null,
    }, { onConflict: 'id' });
    failOnError(profileError, `Upserting profile ${admin.email}`);
  }

  for (const student of students) {
    const { data: existingDirectoryUser, error: directoryReadError } = await supabase
      .from('users').select('users_id').eq('email', student.email).maybeSingle();
    failOnError(directoryReadError, `Reading directory user ${student.email}`);

    let authUser;
    if (existingDirectoryUser) {
      const { data: existingAuth, error: existingAuthError } = await supabase.auth.admin.getUserById(
        existingDirectoryUser.users_id
      );
      failOnError(existingAuthError, `Reading Auth user ${student.email}`);
      if (!existingAuth.user) throw new Error(`Directory user ${student.email} has no matching Auth user.`);

      const { data, error } = await supabase.auth.admin.updateUserById(existingAuth.user.id, {
        password: DEFAULT_STUDENT_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: student.firstName, last_name: student.lastName },
      });
      failOnError(error, `Updating Auth user ${student.email}`);
      if (!data.user) throw new Error(`Updating Auth user ${student.email} returned no user.`);
      authUser = data.user;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: student.email,
        password: DEFAULT_STUDENT_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: student.firstName, last_name: student.lastName },
      });
      failOnError(error, `Creating Auth user ${student.email}`);
      if (!data.user) throw new Error(`Creating Auth user ${student.email} returned no user.`);
      authUser = data.user;
    }
    if (!authUser) throw new Error(`No Auth user returned for ${student.email}.`);

    const { error: userError } = await supabase.from('users').upsert({
      users_id: authUser.id, first_name: student.firstName, middle_name: student.middleName ?? null,
      last_name: student.lastName, email: student.email, password: '[MANAGED_BY_SUPABASE_AUTH]',
      role: 'Students', is_active: true,
    }, { onConflict: 'users_id' });
    failOnError(userError, `Upserting directory user ${student.email}`);

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: authUser.id, student_number: student.studentNumber, first_name: student.firstName,
      last_name: student.lastName, email: student.email, role: 'student', academic_status: student.academicStatus,
      department: student.department, program: student.program, year_level: student.yearLevel, avatar_url: student.avatarUrl,
    }, { onConflict: 'id' });
    failOnError(profileError, `Upserting profile ${student.email}`);
    studentIds.set(student.studentNumber, authUser.id);
  }

  const { data: sectionResults, error: sectionReadError } = await supabase
    .from('course_sections').select('id, section_number, term_id, course:courses(course_code)');
  failOnError(sectionReadError, 'Reading course sections');
  const sectionIds = new Map<string, string>();
  for (const section of sectionResults ?? []) {
    const course = Array.isArray(section.course) ? section.course[0] : section.course;
    if (course?.course_code) sectionIds.set(makeKey(course.course_code, section.term_id, section.section_number), section.id);
  }

  const accountIds = new Map<string, string>();
  for (const account of studentAccounts) {
    const studentId = studentIds.get(account.studentNumber);
    const termId = termIds.get(account.termCode);
    if (!studentId || !termId) throw new Error(`Unknown student or term for account ${account.studentNumber}.`);
    const { data, error } = await supabase.from('student_accounts').upsert({
      student_id: studentId, term_id: termId, base_tuition: account.baseTuition, mandatory_fees: account.mandatoryFees,
      scholarships: account.scholarships, status: account.status, due_date: account.dueDate,
    }, { onConflict: 'student_id,term_id' }).select('id').single();
    failOnError(error, `Upserting account ${account.studentNumber}`);
    if (!data) throw new Error(`Upserting account ${account.studentNumber} returned no account.`);
    accountIds.set(makeKey(account.studentNumber, account.termCode), data.id);
  }

  for (const payment of payments) {
    const accountId = accountIds.get(makeKey(payment.studentNumber, payment.termCode));
    if (!accountId) throw new Error(`Account missing for payment ${payment.referenceNumber}.`);
    const { error } = await supabase.from('student_payments').upsert({
      account_id: accountId, amount: payment.amount, reference_number: payment.referenceNumber,
      receipt_status: payment.receiptStatus, paid_at: payment.paidAt,
    }, { onConflict: 'reference_number' });
    failOnError(error, `Upserting payment ${payment.referenceNumber}`);
  }

  for (const record of academicRecords) {
    const studentId = studentIds.get(record.studentNumber);
    const termId = termIds.get(record.termCode);
    const sectionId = termId ? sectionIds.get(makeKey(record.courseCode, termId, record.sectionNumber)) : undefined;
    if (!studentId || !sectionId) throw new Error(`Unknown student or section for ${record.studentNumber}/${record.courseCode}.`);
    const { error } = await supabase.from('academic_records').upsert({
      student_id: studentId, section_id: sectionId, grade: record.grade, is_current: record.isCurrent,
    }, { onConflict: 'student_id,section_id' });
    failOnError(error, `Upserting record ${record.studentNumber}/${record.courseCode}`);
  }

  for (const hold of holds) {
    const studentId = studentIds.get(hold.studentNumber);
    if (!studentId) throw new Error(`Unknown student for hold ${hold.studentNumber}.`);
    const { data: existingHold, error: holdReadError } = await supabase.from('student_holds').select('id')
      .eq('student_id', studentId).eq('hold_type', hold.holdType).eq('reason', hold.reason).maybeSingle();
    failOnError(holdReadError, `Reading hold ${hold.studentNumber}`);
    if (!existingHold) {
      const { error } = await supabase.from('student_holds').insert({
        student_id: studentId, hold_type: hold.holdType, reason: hold.reason, placed_by_system: hold.placedBySystem,
        placed_at: hold.placedAt, resolved_at: hold.resolvedAt ?? null,
      });
      failOnError(error, `Creating hold ${hold.studentNumber}`);
    }
  }

  console.log(`Seeded ${admins.length} admin accounts, ${students.length} student accounts, ${terms.length} terms, ${courses.length} courses, and ${sections.length} sections.`);
  console.log(`Seeded admin emails: ${admins.map((admin) => admin.email).join(', ')}.`);
  console.log(`All seeded admin passwords are ${DEFAULT_ADMIN_PASSWORD}.`);
  console.log(`All seeded student passwords are ${DEFAULT_STUDENT_PASSWORD}.`);
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
