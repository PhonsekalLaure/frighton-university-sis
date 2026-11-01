import { useApiRead } from '../lib/useApiRead';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import { BillingRecords } from '../components/RecordViews';
import type { BillingData } from '../types/dashboard';

export function BillingPage() {
  const { data, error, retry } = useApiRead<BillingData>('/api/v1/billing/me');
  if (error) return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
  if (!data) return <LoadingState />;
  return <><SectionHeading eyebrow="STUDENT ACCOUNT" title="Billing" description="View your current statement and cashier-posted payment history." /><BillingRecords data={data} /></>;
}
