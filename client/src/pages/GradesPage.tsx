import { useApiRead } from '../lib/useApiRead';
import { ErrorState, LoadingState, SectionHeading } from '../components/PageStates';
import { GradeRecords } from '../components/RecordViews';
import type { GradesData } from '../types/dashboard';

export function GradesPage() {
  const { data, error, retry } = useApiRead<GradesData>('/api/v1/grades/me');
  if (error) return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
  if (!data) return <LoadingState />;
  return <><SectionHeading eyebrow="ACADEMIC RECORDS" title="Grades" description="Review your transcript and term performance." /><GradeRecords data={data} /></>;
}
