import type { HoldSeed } from './types.js';

export const holds: readonly HoldSeed[] = [
  { studentNumber: 'STU-2026-0002', holdType: 'library_debt', reason: 'Overdue Rare Manuscripts (Grimoire Collection Vol. II) (Outstanding Balance: $45)', placedBySystem: 'Frighton LMS', placedAt: '2026-10-08T16:00:00Z' },
  { studentNumber: 'STU-2026-0002', holdType: 'financial_delinquency', reason: 'Tuition balance outstanding past grace period', placedBySystem: 'Frighton SIS', placedAt: '2026-10-16T08:00:00Z' },
  { studentNumber: 'STU-2026-0003', holdType: 'academic_probation', reason: 'Cumulative GPA below 2.0 prerequisite for Major clearance', placedBySystem: 'Frighton SIS', placedAt: '2026-09-01T12:00:00Z' },
  { studentNumber: 'STU-2026-0006', holdType: 'library_debt', reason: 'Overdue Sleepy Hollow Cartography Manuscript', placedBySystem: 'Frighton LMS', placedAt: '2026-09-01T10:00:00Z', resolvedAt: '2026-09-15T10:00:00Z' },
  { studentNumber: 'STU-2026-0008', holdType: 'disciplinary', reason: 'Unauthorized nocturnal laboratory access', placedBySystem: 'Frighton SIS', placedAt: '2026-10-05T22:30:00Z' },
];
