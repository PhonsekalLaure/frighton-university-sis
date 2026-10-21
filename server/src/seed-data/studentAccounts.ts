import type { StudentAccountSeed } from './types.js';

export const studentAccounts: readonly StudentAccountSeed[] = [
  { studentNumber: 'STU-2026-0001', termCode: 'FALL-2026', baseTuition: 4500, mandatoryFees: 350, scholarships: 500, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0002', termCode: 'FALL-2026', baseTuition: 5100, mandatoryFees: 300, scholarships: 0, status: 'open', dueDate: '2026-10-15' },
  { studentNumber: 'STU-2026-0003', termCode: 'FALL-2026', baseTuition: 4800, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0004', termCode: 'FALL-2026', baseTuition: 5400, mandatoryFees: 400, scholarships: 1500, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0005', termCode: 'FALL-2026', baseTuition: 4500, mandatoryFees: 350, scholarships: 0, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0006', termCode: 'FALL-2026', baseTuition: 4800, mandatoryFees: 250, scholarships: 500, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0007', termCode: 'FALL-2026', baseTuition: 5100, mandatoryFees: 300, scholarships: 600, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0008', termCode: 'FALL-2026', baseTuition: 5400, mandatoryFees: 400, scholarships: 1000, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0009', termCode: 'FALL-2026', baseTuition: 4500, mandatoryFees: 350, scholarships: 1000, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0010', termCode: 'FALL-2026', baseTuition: 4800, mandatoryFees: 250, scholarships: 0, status: 'open', dueDate: '2026-11-15' },
];
