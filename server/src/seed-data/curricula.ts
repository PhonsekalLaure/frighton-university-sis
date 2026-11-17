import type { StudentSeed } from './types.js';

interface Curriculum {
  key: string; department: string; yearLevel: number; facultyOffset: number; room: string;
  current: readonly string[]; previous?: readonly [readonly string[], readonly string[]];
}

// First-year students start with the current term. Continuing students also have
// two completed terms from the previous academic year.
export const curricula: readonly Curriculum[] = [
  { key: 'BIO1', department: 'Biological Sciences', yearLevel: 1, facultyOffset: 0, room: 'Science Hall 101',
    current: ['BIO-110', 'CHEM-101', 'MATH-101', 'GE-101', 'GE-102', 'PE-101'] },
  { key: 'BIO4', department: 'Biological Sciences', yearLevel: 4, facultyOffset: 1, room: 'Science Hall 401',
    current: ['BIO-410', 'BIO-420', 'BIO-430', 'RES-401', 'GE-104', 'GE-106'],
    previous: [
      ['BIO-310', 'BIO-320', 'BIO-330', 'CHEM-210', 'GE-103', 'GE-105'],
      ['BIO-340', 'BIO-350', 'BIO-360', 'STAT-201', 'RES-301', 'HUM-101'],
    ] },
  { key: 'CS2', department: 'Computer Science', yearLevel: 2, facultyOffset: 0, room: 'Computing Hall 201',
    // The probation fixture is retaking Purposive Communication after an F.
    current: ['CS-201', 'CS-210', 'CS-220', 'MATH-180', 'GE-101', 'STAT-201'],
    previous: [
      ['CS-101', 'CS-102', 'MATH-101', 'GE-101', 'GE-102', 'PE-101'],
      ['CS-103', 'CS-104', 'MATH-110', 'GE-103', 'GE-105', 'PE-102'],
    ] },
  { key: 'CS3', department: 'Computer Science', yearLevel: 3, facultyOffset: 1, room: 'Computing Hall 301',
    current: ['CS-301', 'CS-310', 'CS-320', 'CS-330', 'MATH-210', 'GE-106'],
    previous: [
      ['CS-201', 'CS-210', 'CS-220', 'MATH-180', 'GE-104', 'STAT-201'],
      ['CS-230', 'CS-240', 'CS-250', 'MATH-220', 'RES-201', 'GE-105'],
    ] },
  { key: 'HUM2', department: 'Humanities', yearLevel: 2, facultyOffset: 0, room: 'Humanities Hall 201',
    current: ['HUM-201', 'HIST-205', 'HUM-210', 'RES-201', 'GE-104', 'GE-106'],
    previous: [
      ['HUM-101', 'HIST-101', 'SOC-101', 'GE-101', 'GE-102', 'PE-101'],
      ['HUM-102', 'PHIL-101', 'PSY-101', 'GE-103', 'GE-105', 'PE-102'],
    ] },
  { key: 'HUM3', department: 'Humanities', yearLevel: 3, facultyOffset: 1, room: 'Humanities Hall 301',
    current: ['HUM-301', 'HIST-305', 'HUM-310', 'RES-301', 'HIST-310', 'HUM-320'],
    previous: [
      ['HUM-201', 'HIST-205', 'HUM-210', 'RES-201', 'GE-104', 'GE-106'],
      ['HUM-220', 'HIST-220', 'HUM-230', 'RES-202', 'SOC-201', 'GE-105'],
    ] },
  { key: 'MATH1', department: 'Mathematics', yearLevel: 1, facultyOffset: 0, room: 'Mathematics Hall 101',
    current: ['MATH-101', 'MATH-110', 'CS-101', 'GE-101', 'GE-102', 'PE-101'] },
  { key: 'MATH4', department: 'Mathematics', yearLevel: 4, facultyOffset: 1, room: 'Mathematics Hall 401',
    current: ['MATH-410', 'MATH-420', 'MATH-430', 'MATH-440', 'RES-402', 'GE-106'],
    previous: [
      ['MATH-310', 'MATH-320', 'MATH-330', 'MATH-340', 'CS-201', 'GE-104'],
      ['MATH-350', 'MATH-360', 'MATH-370', 'MATH-380', 'RES-301', 'GE-105'],
    ] },
];

export function curriculumFor(student: StudentSeed) {
  const curriculum = curricula.find(item => item.department === student.department && item.yearLevel === student.yearLevel);
  if (!curriculum) throw new Error(`No seed curriculum for ${student.studentNumber}.`);
  return curriculum;
}
