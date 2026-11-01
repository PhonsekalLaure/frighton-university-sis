import { useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useApiRead } from '../../lib/useApiRead';
import { timestamp } from '../../lib/format';
import type { AuditEvent, Page } from '../../types/admin';
import { LoadingState } from '../PageStates';
import { AdminPageHeading, Failure, Pagination } from './shared';
import { actionLabels } from '../../lib/adminConstants';

function AuditFilters({ search, onApply }: { search: string; onApply: (params: URLSearchParams) => void }) {
  const params = new URLSearchParams(search);
  const [values, setValues] = useState(() => ({ action: params.get('action') ?? '', studentId: params.get('studentId') ?? '', actorId: params.get('actorId') ?? '', from: params.get('from')?.slice(0, 10) ?? '', to: params.get('to')?.slice(0, 10) ?? '' }));
  const [error, setError] = useState('');
  function apply(event: FormEvent) {
    event.preventDefault(); setError('');
    for (const key of ['studentId', 'actorId'] as const) {
      if (values[key].trim() && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(values[key].trim())) { setError(`${key} must be a UUID.`); return; }
    }
    if (values.from && values.to && values.from > values.to) { setError('Start date must not be after end date.'); return; }
    const next = new URLSearchParams();
    for (const key of ['action', 'studentId', 'actorId'] as const) if (values[key].trim()) next.set(key, values[key].trim());
    if (values.from) next.set('from', `${values.from}T00:00:00.000+08:00`);
    if (values.to) next.set('to', `${values.to}T23:59:59.999+08:00`);
    next.set('pageSize', params.get('pageSize') ?? '25'); next.set('page', '1'); onApply(next);
  }
  const set = (key: keyof typeof values, value: string) => setValues(current => ({ ...current, [key]: value }));
  return <><form className="filter-bar audit-filters" onSubmit={apply}><label>Action<select value={values.action} onChange={event => set('action', event.target.value)}><option value="">All actions</option>{Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Student UUID<input value={values.studentId} onChange={event => set('studentId', event.target.value)} /></label><label>Actor UUID<input value={values.actorId} onChange={event => set('actorId', event.target.value)} /></label><label>From (Manila)<input type="date" value={values.from} onChange={event => set('from', event.target.value)} /></label><label>To (Manila)<input type="date" value={values.to} onChange={event => set('to', event.target.value)} /></label><button className="admin-secondary">Apply filters</button><button className="admin-secondary" type="button" onClick={() => onApply(new URLSearchParams())}>Clear filters</button></form>{error && <p className="error-message" role="alert">{error}</p>}</>;
}

export function AuditLogs({ search, navigate }: { search: string; navigate: (path: string) => void }) {
  const { data, error, retry } = useApiRead<Page<AuditEvent>>(`/api/v1/admin/audit-logs${search}`);
  const [expanded, setExpanded] = useState<string>();
  function update(key: string, value: string) {
    const params = new URLSearchParams(search); params.set(key, value);
    if (key !== 'page') params.set('page', '1');
    navigate(`/admin/audit-logs?${params}`);
  }
  return <div className="admin-content"><AdminPageHeading eyebrow="GOVERNANCE" title="Audit log" description="A read-only history of administrator changes and historical snapshots." /><AuditFilters key={search} search={search} onApply={params => navigate(`/admin/audit-logs${params.size ? '?' + params : ''}`)} />
    {error ? <Failure error={error} retry={retry} /> : !data ? <LoadingState /> : <><div className="admin-card audit-log-card">{data.items.length ? data.items.map(event => <div className="audit-event" key={event.id}><button className="audit-event-heading" aria-expanded={expanded === event.id} onClick={() => setExpanded(expanded === event.id ? undefined : event.id)}><span><strong>{actionLabels[event.action]}</strong><small>{event.target.fullName} · {event.target.studentNumber} · {event.actor.fullName}</small></span><span>{timestamp(event.createdAt)} {expanded === event.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span></button>{expanded === event.id && <div className="change-list"><p>Actor: {event.actor.fullName} · {event.actor.email}</p><p>Student: {event.target.fullName} · {event.target.email}</p>{Object.keys(event.changes).length ? Object.entries(event.changes).map(([field, change]) => <div key={field}><strong>{field}</strong><span>{String(change.before ?? 'Not set')} → {String(change.after ?? 'Not set')}</span></div>) : <span>No profile fields changed.</span>}</div>}</div>) : <div className="admin-empty">No audit events match these filters.</div>}</div><Pagination data={data} onChange={update} /></>}
  </div>;
}
