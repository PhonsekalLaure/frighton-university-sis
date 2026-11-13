import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useApiRead } from '../../lib/useApiRead';
import type { Page, StudentListItem } from '../../types/admin';
import { LoadingState } from '../PageStates';
import { AdminPageHeading, Failure, Pagination } from './shared';
import { statuses } from '../../lib/adminConstants';
import { StudentForm } from './StudentForm';

function buildParams(search: string) {
  const source = new URLSearchParams(search), result = new URLSearchParams();
  for (const key of ['q', 'accessStatus', 'academicStatus', 'department', 'page', 'pageSize']) {
    const value = source.get(key);
    if (value && value !== 'all') result.set(key, value);
  }
  return result;
}

export function Students({ navigate, search }: { navigate: (path: string) => void; search: string }) {
  const params = buildParams(search);
  const [draft, setDraft] = useState(() => ({ source: search, q: params.get('q') ?? '', department: params.get('department') ?? '' }));
  if (draft.source !== search) {
    const previous = new URLSearchParams(draft.source);
    setDraft({ source: search, q: draft.q.trim() === (params.get('q') ?? '') ? draft.q : params.get('q') ?? '',
      department: previous.get('department') === params.get('department') ? draft.department : params.get('department') ?? '' });
  }
  const [showCreate, setShowCreate] = useState(false);
  const [formOpener, setFormOpener] = useState<HTMLElement | null>(null);
  const { data, error, retry } = useApiRead<Page<StudentListItem>>(`/api/v1/admin/students?${params.toString()}`);
  const query = params.get('q') ?? '';
  useEffect(() => {
    if (draft.source !== search || draft.q.trim() === query) return;
    const timer = window.setTimeout(() => {
      const next = buildParams(search);
      if (draft.q.trim()) next.set('q', draft.q.trim()); else next.delete('q');
      next.set('page', '1');
      navigate(`/admin/students?${next}`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft.q, draft.source, query, search, navigate]);
  function update(key: string, value: string) {
    const next = buildParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    navigate(`/admin/students?${next}`);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const next = buildParams(search);
    for (const key of ['q', 'department'] as const) {
      if (draft[key].trim()) next.set(key, draft[key].trim()); else next.delete(key);
    }
    next.set('page', '1'); navigate(`/admin/students?${next}`);
  }
  return <div className="admin-content"><AdminPageHeading eyebrow="DIRECTORY" title="Student accounts" description="Search, review, and maintain student access records." action={<button className="admin-primary" onClick={event => { setFormOpener(event.currentTarget); setShowCreate(true); }}><Plus size={16} />Create account</button>} />
    <form className="filter-bar student-filters" onSubmit={apply}><label className="student-search-field">Search<span className="student-search-control"><Search size={16} aria-hidden="true" /><input type="search" value={draft.q} maxLength={100} placeholder="Name, email, or student number" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} /></span></label>
      <label>Access<select value={params.get('accessStatus') ?? ''} onChange={event => update('accessStatus', event.target.value)}><option value="">All access</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label>Academic status<select value={params.get('academicStatus') ?? ''} onChange={event => update('academicStatus', event.target.value)}><option value="">All academic status</option>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
      <label>Department<input maxLength={100} placeholder="All departments" value={draft.department} onChange={event => setDraft(value => ({ ...value, department: event.target.value }))} /></label><button className="admin-secondary"><SlidersHorizontal size={15} aria-hidden="true" />Apply filters</button>
    </form>
    {error ? <Failure error={error} retry={retry} /> : !data ? <LoadingState /> : <>
      <div className="table-meta">{data.total} student{data.total === 1 ? '' : 's'}</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Student</th><th>Program / department</th><th>Year</th><th>Academic status</th><th>Access</th><th>Holds</th><th><span className="sr-only">Open record</span></th></tr></thead><tbody>{data.items.map(student => <tr key={student.id} onClick={() => navigate(`/admin/students/${student.id}`)}><td><strong>{student.fullName}</strong><small>{student.studentNumber}<br />{student.email}</small></td><td>{student.program || 'Not set'}<small>{student.department || 'No department'}</small></td><td>{student.yearLevel ?? '—'}</td><td><span className={`status-tag ${student.academicStatus}`}>{student.academicStatus}</span></td><td><span className={`status-tag ${student.isActive ? 'active' : 'inactive'}`}>{student.isActive ? 'Active' : 'Inactive'}</span></td><td>{student.activeHoldCount}</td><td><button className="icon-button" aria-label={`Open ${student.fullName}`} onClick={event => { event.stopPropagation(); navigate(`/admin/students/${student.id}`); }}><ChevronRight size={16} /></button></td></tr>)}</tbody></table>{!data.items.length && <div className="admin-empty">No students match these filters.</div>}</div><Pagination data={data} onChange={update} /></>}
    {showCreate && <StudentForm restoreFocusTo={formOpener} onClose={() => setShowCreate(false)} onSaved={id => { setShowCreate(false); navigate(`/admin/students/${id}`); }} />}
  </div>;
}
