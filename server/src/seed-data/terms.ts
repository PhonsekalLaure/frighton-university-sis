import type { TermSeed } from './types.js';

export const terms: readonly TermSeed[] = [
  { code: 'FALL-2025', name: 'Fall Semester 2025', startDate: '2025-09-01', endDate: '2025-12-20', isActive: false },
  { code: 'SPRING-2026', name: 'Spring Semester 2026', startDate: '2026-01-15', endDate: '2026-05-25', isActive: false },
  { code: 'FALL-2026', name: 'Fall Semester 2026', startDate: '2026-09-01', endDate: '2026-12-20', isActive: true },
  { code: 'SPRING-2027', name: 'Spring Semester 2027', startDate: '2027-01-15', endDate: '2027-05-25', isActive: false },
];
