import { getSupabaseAdmin } from '../config/supabase.js';

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export interface BillingClient {
  from: (table: string) => any;
}

export class BillingError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'BillingError';
  }
}

const asNumber = (value: unknown): number => Number(value ?? 0);
const asRows = <T>(value: T[] | null): T[] => value ?? [];
const asRecord = (value: unknown): Record<string, any> | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Record<string, any> : null;
};

function requireData(result: SupabaseResult<any>, resource: string): any {
  if (result.error) throw new Error(`Unable to load ${resource}.`);
  return result.data;
}

function statementStatus(
  accountStatus: string,
  outstandingBalance: number,
  totalPaid: number,
  dueDate: string | null,
  today: string,
): 'void' | 'paid' | 'partially_paid' | 'unpaid' | 'overdue' {
  if (accountStatus === 'void') return 'void';
  if (outstandingBalance <= 0) return 'paid';
  if (dueDate && dueDate < today) return 'overdue';
  return totalPaid > 0 ? 'partially_paid' : 'unpaid';
}

function manilaIsoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Returns the authenticated student's read-only cashier statement history.
 *
 * Frontend implementation intent:
 * - Treat `currentStatement` as the prominent balance card for the active term.
 * - Render `statements` as a newest-first term switcher or statement history.
 * - `payments` is a cashier-posted receipt ledger, never a payment form.
 * - `paymentChannel` and `isPaymentPortal` are deliberate product guardrails:
 *   do not render card, wallet, or "Pay now" controls in the SIS.
 * - A statement is informational; the cashier-issued receipt remains the
 *   official proof of payment.
 */
export async function getBilling(
  studentId: string,
  client: BillingClient = getSupabaseAdmin() as unknown as BillingClient,
  now: Date = new Date(),
) {
  const [profileResult, accountsResult] = await Promise.all([
    client.from('profiles')
      .select('id')
      .eq('id', studentId)
      .maybeSingle(),
    client.from('student_accounts')
      .select(`
        id,
        base_tuition,
        mandatory_fees,
        scholarships,
        status,
        due_date,
        term:academic_terms (id, code, name, start_date, end_date, is_active),
        payments:student_payments (id, amount, reference_number, receipt_status, paid_at)
      `)
      .eq('student_id', studentId),
  ]);

  const profile = requireData(profileResult, 'profile');
  if (!profile) throw new BillingError('Your SIS profile has not been provisioned yet.', 404);

  const today = manilaIsoDate(now);
  const statements = asRows<Record<string, any>>(requireData(accountsResult, 'student account statements'))
    .flatMap((account) => {
      const term = asRecord(account.term);
      if (!term) return [];

      const charges = {
        tuition: asNumber(account.base_tuition),
        mandatoryFees: asNumber(account.mandatory_fees),
        scholarships: asNumber(account.scholarships),
      };
      const totalAssessed = charges.tuition + charges.mandatoryFees - charges.scholarships;
      const payments = asRows<Record<string, any>>(account.payments)
        .map((payment) => ({
          id: payment.id,
          amount: asNumber(payment.amount),
          referenceNumber: payment.reference_number,
          receiptStatus: payment.receipt_status,
          paidAt: payment.paid_at,
          // The database intentionally stores cashier receipts, not gateway data.
          paymentChannel: 'cashier' as const,
          countsTowardBalance: payment.receipt_status === 'completed',
        }))
        .sort((left, right) => String(right.paidAt).localeCompare(String(left.paidAt)));
      const totalPaid = payments
        .filter((payment) => payment.countsTowardBalance)
        .reduce((sum, payment) => sum + payment.amount, 0);
      const outstandingBalance = Math.max(0, totalAssessed - totalPaid);

      return [{
        id: account.id,
        term: {
          id: term.id,
          code: term.code,
          name: term.name,
          startDate: term.start_date,
          endDate: term.end_date,
          isActive: Boolean(term.is_active),
        },
        accountStatus: account.status,
        statementStatus: statementStatus(account.status, outstandingBalance, totalPaid, account.due_date, today),
        dueDate: account.due_date,
        charges,
        totalAssessed,
        totalPaid,
        outstandingBalance,
        payments,
      }];
    })
    .sort((left, right) => String(right.term.startDate).localeCompare(String(left.term.startDate)));

  return {
    // These are UI guardrails, not a payment provider configuration.
    isPaymentPortal: false,
    paymentChannel: 'cashier' as const,
    paymentNotice: 'Pay at the university cashier. Cashier-posted payments may take up to one business day to appear in SIS.',
    officialReceiptNotice: 'This statement is for account reference only. Keep the cashier-issued official receipt as proof of payment.',
    currentStatement: statements.find((statement) => statement.term.isActive) ?? null,
    statements,
  };
}
