import type { TermSeed } from './types.js';

export const terms: readonly TermSeed[] = [
  { code: 'AY2025-2026-T1', name: 'First Term, AY 2025–2026', startDate: '2025-08-11', endDate: '2025-12-19', isActive: false },
  { code: 'AY2025-2026-T2', name: 'Second Term, AY 2025–2026', startDate: '2026-01-12', endDate: '2026-05-22', isActive: false },
  { code: 'AY2026-2027-T1', name: 'First Term, AY 2026–2027', startDate: '2026-08-10', endDate: '2026-12-18', isActive: true },
  { code: 'AY2026-2027-T2', name: 'Second Term, AY 2026–2027', startDate: '2027-01-11', endDate: '2027-05-21', isActive: false },
];

// Rename the old fixtures in place to preserve academic/billing references.
export const legacyTermCodes: Readonly<Record<string, string>> = {
  'FALL-2025': 'AY2025-2026-T1', 'SPRING-2026': 'AY2025-2026-T2',
  'FALL-2026': 'AY2026-2027-T1', 'SPRING-2027': 'AY2026-2027-T2',
};
