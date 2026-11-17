import type { StudentAccountSeed } from './types.js';

export const studentAccounts: readonly StudentAccountSeed[] = [
  // Completed cashier statements make the Billing UI's term-history view useful.
  { studentNumber: 'STU-2026-0002', termCode: 'AY2025-2026-T1', baseTuition: 4800, mandatoryFees: 300, scholarships: 0, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0003', termCode: 'AY2025-2026-T1', baseTuition: 4600, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0004', termCode: 'AY2025-2026-T1', baseTuition: 5200, mandatoryFees: 350, scholarships: 1300, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0006', termCode: 'AY2025-2026-T1', baseTuition: 4600, mandatoryFees: 250, scholarships: 400, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0007', termCode: 'AY2025-2026-T1', baseTuition: 4800, mandatoryFees: 300, scholarships: 400, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0008', termCode: 'AY2025-2026-T1', baseTuition: 5200, mandatoryFees: 350, scholarships: 900, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0010', termCode: 'AY2025-2026-T1', baseTuition: 4600, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2025-11-15' },
  { studentNumber: 'STU-2026-0002', termCode: 'AY2025-2026-T2', baseTuition: 4900, mandatoryFees: 300, scholarships: 0, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0003', termCode: 'AY2025-2026-T2', baseTuition: 4700, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0004', termCode: 'AY2025-2026-T2', baseTuition: 5300, mandatoryFees: 350, scholarships: 1400, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0006', termCode: 'AY2025-2026-T2', baseTuition: 4700, mandatoryFees: 250, scholarships: 450, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0007', termCode: 'AY2025-2026-T2', baseTuition: 4900, mandatoryFees: 300, scholarships: 500, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0008', termCode: 'AY2025-2026-T2', baseTuition: 5300, mandatoryFees: 350, scholarships: 950, status: 'paid', dueDate: '2026-04-15' },
  { studentNumber: 'STU-2026-0010', termCode: 'AY2025-2026-T2', baseTuition: 4700, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2026-04-15' },

  { studentNumber: 'STU-2026-0001', termCode: 'AY2026-2027-T1', baseTuition: 4500, mandatoryFees: 350, scholarships: 500, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0002', termCode: 'AY2026-2027-T1', baseTuition: 5100, mandatoryFees: 300, scholarships: 0, status: 'open', dueDate: '2026-10-15' },
  { studentNumber: 'STU-2026-0003', termCode: 'AY2026-2027-T1', baseTuition: 4800, mandatoryFees: 250, scholarships: 0, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0004', termCode: 'AY2026-2027-T1', baseTuition: 5400, mandatoryFees: 400, scholarships: 1500, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0005', termCode: 'AY2026-2027-T1', baseTuition: 4500, mandatoryFees: 350, scholarships: 0, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0006', termCode: 'AY2026-2027-T1', baseTuition: 4800, mandatoryFees: 250, scholarships: 500, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0007', termCode: 'AY2026-2027-T1', baseTuition: 5100, mandatoryFees: 300, scholarships: 600, status: 'open', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0008', termCode: 'AY2026-2027-T1', baseTuition: 5400, mandatoryFees: 400, scholarships: 1000, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0009', termCode: 'AY2026-2027-T1', baseTuition: 4500, mandatoryFees: 350, scholarships: 1000, status: 'paid', dueDate: '2026-11-15' },
  { studentNumber: 'STU-2026-0010', termCode: 'AY2026-2027-T1', baseTuition: 4800, mandatoryFees: 250, scholarships: 0, status: 'open', dueDate: '2026-11-15' },
];
