import type { PaymentSeed } from './types.js';

export const payments: readonly PaymentSeed[] = [
  { studentNumber: 'STU-2026-0001', termCode: 'FALL-2026', amount: 1000, referenceNumber: 'REC-2026-0001', receiptStatus: 'completed', paidAt: '2026-09-05T14:20:00Z' },
  { studentNumber: 'STU-2026-0003', termCode: 'FALL-2026', amount: 5050, referenceNumber: 'REC-2026-0003', receiptStatus: 'completed', paidAt: '2026-09-02T09:15:00Z' },
  { studentNumber: 'STU-2026-0004', termCode: 'FALL-2026', amount: 4300, referenceNumber: 'REC-2026-0004', receiptStatus: 'completed', paidAt: '2026-08-28T11:45:00Z' },
  { studentNumber: 'STU-2026-0005', termCode: 'FALL-2026', amount: 2000, referenceNumber: 'REC-2026-0005', receiptStatus: 'completed', paidAt: '2026-09-10T16:30:00Z' },
  { studentNumber: 'STU-2026-0006', termCode: 'FALL-2026', amount: 4550, referenceNumber: 'REC-2026-0006', receiptStatus: 'completed', paidAt: '2026-08-30T10:00:00Z' },
  { studentNumber: 'STU-2026-0007', termCode: 'FALL-2026', amount: 2400, referenceNumber: 'REC-2026-0007', receiptStatus: 'completed', paidAt: '2026-09-08T13:10:00Z' },
  { studentNumber: 'STU-2026-0008', termCode: 'FALL-2026', amount: 4800, referenceNumber: 'REC-2026-0008', receiptStatus: 'completed', paidAt: '2026-09-01T15:00:00Z' },
  { studentNumber: 'STU-2026-0009', termCode: 'FALL-2026', amount: 3850, referenceNumber: 'REC-2026-0009', receiptStatus: 'completed', paidAt: '2026-09-03T08:30:00Z' },
  { studentNumber: 'STU-2026-0010', termCode: 'FALL-2026', amount: 1500, referenceNumber: 'REC-2026-0010', receiptStatus: 'completed', paidAt: '2026-09-12T17:00:00Z' },
];
