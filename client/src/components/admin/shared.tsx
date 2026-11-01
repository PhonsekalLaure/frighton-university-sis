import type { ReactNode } from 'react';
import type { ApiFailure } from '../../lib/api';
import { ErrorState } from '../PageStates';
import type { Page } from '../../types/admin';
export function AdminPageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="supporting-copy">{description}</p>}</div>{action}</div>;
}
export function Failure({ error, retry }: { error: ApiFailure; retry?: () => void }) {
  return <ErrorState message={error.message} forbidden={error.status === 403} onRetry={retry} />;
}
export function Pagination({ data, onChange }: { data: Page<unknown>; onChange: (key: string, value: string) => void }) {
  return <div className="pagination" aria-label="Pagination"><label>Rows <select aria-label="Rows per page" value={data.pageSize} onChange={event => onChange('pageSize', event.target.value)}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label><span>{data.total} results · Page {data.page} of {Math.max(data.totalPages, 1)}</span><button disabled={data.page <= 1} onClick={() => onChange('page', String(data.page - 1))}>Previous</button><button disabled={data.totalPages === 0 || data.page >= data.totalPages} onClick={() => onChange('page', String(data.page + 1))}>Next</button></div>;
}
