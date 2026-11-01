import { useApiRead } from '../lib/useApiRead';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import { ScheduleRecords } from '../components/RecordViews';
import type { ScheduleData } from '../types/dashboard';

export function SchedulePage() {
  const { data, error, retry } = useApiRead<ScheduleData>('/api/v1/schedule/me');
  if (error) return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
  if (!data) return <LoadingState />;
  return <><SectionHeading eyebrow="ACADEMICS" title="My schedule" description="Your current academic assignments and published class meetings." /><ScheduleRecords data={data} /></>;
}
