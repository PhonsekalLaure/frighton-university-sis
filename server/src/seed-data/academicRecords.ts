import type { AcademicRecordSeed } from './types.js';

// Final grades are historical, static transcript snapshots. Fall 2026 contains
// only in-progress assignments and is the sole active schedule term.
export const academicRecords: readonly AcademicRecordSeed[] = [
  { studentNumber: 'STU-2026-0002', courseCode: 'HIST-105', termCode: 'FALL-2025', sectionNumber: '01', grade: 'A', isCurrent: false },
  { studentNumber: 'STU-2026-0003', courseCode: 'CS-220', termCode: 'FALL-2025', sectionNumber: '01', grade: 'D', isCurrent: false },
  { studentNumber: 'STU-2026-0004', courseCode: 'CS-101', termCode: 'FALL-2025', sectionNumber: '01', grade: 'A', isCurrent: false },
  { studentNumber: 'STU-2026-0005', courseCode: 'HIST-105', termCode: 'FALL-2025', sectionNumber: '01', grade: 'B+', isCurrent: false },
  { studentNumber: 'STU-2026-0008', courseCode: 'CS-101', termCode: 'FALL-2025', sectionNumber: '01', grade: 'B', isCurrent: false },
  { studentNumber: 'STU-2026-0004', courseCode: 'CS-220', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'A-', isCurrent: false },
  { studentNumber: 'STU-2026-0006', courseCode: 'CS-220', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'B+', isCurrent: false },
  { studentNumber: 'STU-2026-0007', courseCode: 'HIST-105', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'A-', isCurrent: false },
  { studentNumber: 'STU-2026-0008', courseCode: 'CS-220', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'A', isCurrent: false },
  { studentNumber: 'STU-2026-0009', courseCode: 'CS-101', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'A', isCurrent: false },
  { studentNumber: 'STU-2026-0010', courseCode: 'CS-220', termCode: 'SPRING-2026', sectionNumber: '01', grade: 'B', isCurrent: false },

  { studentNumber: 'STU-2026-0001', courseCode: 'CS-101', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0001', courseCode: 'HIST-105', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0002', courseCode: 'CS-101', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0003', courseCode: 'HIST-105', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0004', courseCode: 'CS-220', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0005', courseCode: 'CS-101', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0006', courseCode: 'CS-220', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0007', courseCode: 'HIST-105', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0008', courseCode: 'CS-220', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0009', courseCode: 'CS-101', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
  { studentNumber: 'STU-2026-0010', courseCode: 'CS-220', termCode: 'FALL-2026', sectionNumber: '01', grade: 'IP', isCurrent: true },
];
