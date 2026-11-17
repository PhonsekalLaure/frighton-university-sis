import { curriculumFor } from './curricula.js';
import { students } from './students.js';
import type { AcademicRecordSeed } from './types.js';

const finalGrades = ['A-', 'B+', 'B', 'A', 'B+', 'A-'] as const;
const probationGrades = [
  ['C', 'C', 'D', 'F', 'D', 'B-'],
  ['C', 'C-', 'D', 'D', 'D', 'B-'],
] as const;

export const academicRecords: readonly AcademicRecordSeed[] = students.flatMap((student, studentIndex) => {
  const curriculum = curriculumFor(student);
  const plans = [
    ...(curriculum.previous ? [
      { termCode: 'AY2025-2026-T1', subjects: curriculum.previous[0], isCurrent: false },
      { termCode: 'AY2025-2026-T2', subjects: curriculum.previous[1], isCurrent: false },
    ] : []),
    { termCode: 'AY2026-2027-T1', subjects: curriculum.current, isCurrent: true },
  ];
  return plans.flatMap((plan, termIndex) => plan.subjects.map((courseCode, subjectIndex) => ({
    studentNumber: student.studentNumber, courseCode, termCode: plan.termCode,
    sectionNumber: `${curriculum.key}-01`, isCurrent: plan.isCurrent,
    grade: plan.isCurrent ? 'IP' : student.academicStatus === 'probation'
      ? probationGrades[termIndex][subjectIndex]
      : finalGrades[(studentIndex + termIndex + subjectIndex) % finalGrades.length],
  })));
});
