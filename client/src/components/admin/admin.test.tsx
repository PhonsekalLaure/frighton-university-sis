import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AdminConsolePage } from '../../pages/AdminConsolePage';
import { StudentForm } from './StudentForm';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { studentPayload, studentValues } from '../../lib/studentForm';
import { adminDashboard, adminUser, detail, event, page, student } from '../../test/fixtures';

vi.mock('../../lib/api', () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
const get = vi.mocked(apiGet), patch = vi.mocked(apiPatch), post = vi.mocked(apiPost);
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); window.history.replaceState({}, '', '/admin'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function Harness({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return <AdminConsolePage user={adminUser} onLogout={vi.fn()} path={route} navigate={path => { window.history.pushState({}, '', path); setRoute(path); }} />;
}

test('admin detail uses one aggregate and presents complete read-only records in keyboard-operable tabs', async () => {
  get.mockResolvedValue(detail);
  render(<Harness initial={`/admin/students/${student.id}`} />);
  expect(await screen.findByRole('heading', { name: student.fullName, level: 1 })).toBeInTheDocument();
  const overview = screen.getByRole('tab', { name: 'Overview' });
  overview.focus(); fireEvent.keyDown(overview, { key: 'ArrowRight' });
  expect(await screen.findByRole('tab', { name: 'Schedule', selected: true })).toHaveFocus();
  expect(screen.getByText('instructor@example.invalid')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Grades' }));
  expect(screen.getByText('A')).toBeInTheDocument();
  expect(screen.getByText(/Programming · Section A/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Holds' }));
  expect(screen.getByText('Cleared conduct review')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open Library' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Billing' }));
  fireEvent.change(screen.getByLabelText('Statement'), { target: { value: 'statement-old' } });
  expect(screen.getByText(/OLD-RECEIPT/)).toBeInTheDocument();
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0][0]).toBe(`/api/v1/admin/students/${student.id}`);
  expect(patch).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

test('audit pagination and page-size changes are URL-backed and preserve filters', async () => {
  get.mockImplementation(async path => page([event], { page: Number(new URL(path, 'http://localhost').searchParams.get('page') ?? 1), total: 51, totalPages: 3, pageSize: Number(new URL(path, 'http://localhost').searchParams.get('pageSize') ?? 25) }));
  render(<Harness initial={`/admin/audit-logs?studentId=${student.id}`} />);
  expect(await screen.findByText('Profile updated')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('page=2'));
  expect(window.location.search).toContain(`studentId=${student.id}`);
  expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('pageSize=50'));
  expect(new URLSearchParams(window.location.search).get('page')).toBe('1');
});

test('audit validation, corrected filter recovery, historical snapshots and Manila dates work', async () => {
  get.mockRejectedValueOnce(new Error('Previous filter failed')).mockResolvedValue(page([event]));
  render(<Harness initial="/admin/audit-logs" />);
  expect(await screen.findByText('Previous filter failed')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Actor UUID'), { target: { value: 'bad' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(screen.getByText('actorId must be a UUID.')).toBeInTheDocument(); expect(get).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('Actor UUID'), { target: { value: adminUser.id } });
  fireEvent.change(screen.getByLabelText('From (Manila)'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('To (Manila)'), { target: { value: '2026-10-21' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(await screen.findByText('Profile updated')).toBeInTheDocument();
  expect(screen.queryByText('Previous filter failed')).not.toBeInTheDocument();
  const query = new URLSearchParams(window.location.search);
  expect(query.get('from')).toBe('2026-10-20T00:00:00.000+08:00');
  expect(query.get('to')).toBe('2026-10-21T23:59:59.999+08:00');
  fireEvent.click(screen.getByRole('button', { name: /Profile updated/ }));
  expect(screen.getByText(`Actor: ${adminUser.fullName} · ${adminUser.email}`)).toBeInTheDocument();
});

test('out-of-order audit responses cannot overwrite a newer filter', async () => {
  let old!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(resolve => { old = resolve; })).mockResolvedValue(page([]));
  render(<Harness initial="/admin/audit-logs?studentId=bad" />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByText('No audit events match these filters.')).toBeInTheDocument();
  await act(async () => { old(page([event])); });
  expect(screen.queryByRole('button', { name: /Profile updated/ })).not.toBeInTheDocument();
});

test('student-list search is debounced, departments retain spaces, and records open by keyboard', async () => {
  get.mockResolvedValue(page([{ ...student, activeHoldCount: 1 }]));
  render(<Harness initial="/admin/students" />);
  expect(await screen.findByText(student.fullName)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Demo' } });
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('q=Demo'));
  const department = screen.getByLabelText('Department');
  fireEvent.change(department, { target: { value: 'Computer ' } });
  expect(department).toHaveValue('Computer ');
  fireEvent.change(department, { target: { value: 'Computer Studies' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('department=Computer+Studies'));
  get.mockResolvedValue(detail);
  const open = await screen.findByRole('button', { name: `Open ${student.fullName}` });
  open.focus(); fireEvent.click(open);
  expect(await screen.findByRole('heading', { name: student.fullName, level: 1 })).toBeInTheDocument();
});

test('edit forms disable unchanged saves and send only changed nullable fields', async () => {
  const saved = vi.fn(), baseline = { ...student, middleName: 'M.' };
  patch.mockResolvedValue({ student });
  render(<StudentForm student={baseline} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  for (const label of ['Middle name', 'Department', 'Program', 'Year level']) fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(student.id));
  expect(patch).toHaveBeenCalledExactlyOnceWith(`/api/v1/admin/students/${student.id}`, { middleName: null, department: null, program: null, yearLevel: null });
  expect(screen.getByLabelText('Student number')).toBeDisabled();
});

test('email changes require shared-login confirmation and duplicate errors preserve edits', async () => {
  patch.mockRejectedValue(Object.assign(new Error('Email already exists'), { status: 409 }));
  render(<StudentForm student={student} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('University email'), { target: { value: 'changed@example.invalid' } });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Email already exists')).toBeInTheDocument();
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('SIS and LMS'));
  expect(screen.getByLabelText('University email')).toHaveValue('changed@example.invalid');
});

test('uncertain edit outcomes block another save until an explicit record review', async () => {
  patch.mockRejectedValue(Object.assign(new Error('Unknown commit'), { status: 503 }));
  const review = vi.fn().mockResolvedValue(student);
  render(<StudentForm student={student} onClose={vi.fn()} onSaved={vi.fn()} onReview={review} />);
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText(/Outcome not confirmed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review record' }));
  expect(await screen.findByText('Current committed record')).toBeInTheDocument();
  expect(review).toHaveBeenCalledOnce(); expect(patch).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('First name')).toHaveValue('Changed');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('profile validation matches field limits, year bounds and student-number syntax', () => {
  const values = studentValues(student);
  expect(studentPayload(values, student)).toEqual({});
  expect(() => studentPayload({ ...values, firstName: 'x'.repeat(101) })).toThrow(/100/);
  expect(() => studentPayload({ ...values, yearLevel: '1.5' })).toThrow(/integer/);
  expect(() => studentPayload({ ...values, studentNumber: 'ADM-123' })).toThrow(/STU/);
  expect(() => studentPayload({ ...values, firstName: 'Demo\n' })).toThrow(/control/);
  expect(() => studentPayload({ ...values, avatarUrl: 'https://user:pass@example.invalid/pic' })).toThrow(/without credentials/);
  expect(studentPayload({ ...values, avatarUrl: 'https://example.invalid/' + 'a'.repeat(1800) })).toHaveProperty('avatarUrl');
});

test('detail serializes account actions and disables email requests during cooldown', async () => {
  get.mockResolvedValue(detail);
  post.mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { status: 429, retryAfter: 1 }));
  render(<Harness initial={`/admin/students/${student.id}`} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send recovery instructions' }));
  expect(await screen.findByText('Try again in 1 seconds.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send recovery instructions' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send recovery instructions' })).toBeEnabled(), { timeout: 2200 });
  expect(post).toHaveBeenCalledOnce();
});

test('uncertain mail delivery does not show success or enable an automatic resend after refresh', async () => {
  get.mockResolvedValue(detail);
  post.mockRejectedValue(Object.assign(new Error('Unknown delivery'), { status: 503, code: 'email_delivery_unknown' }));
  render(<Harness initial={`/admin/students/${student.id}`} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send recovery instructions' }));
  expect(await screen.findByText(/Outcome not confirmed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review record' }));
  expect(await screen.findByText(/Email delivery still needs operator review/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send recovery instructions' })).toBeDisabled();
  expect(post).toHaveBeenCalledOnce();
});

test('dialogs trap keyboard focus and return it to the opener on close', async () => {
  get.mockResolvedValue(page([]));
  render(<Harness initial="/admin/students" />);
  const opener = screen.getByRole('button', { name: 'Create account' });
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole('dialog');
  const close = within(dialog).getByRole('button', { name: 'Close' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(within(dialog).getByRole('button', { name: 'Create account' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('admin dashboard has real empty and no-term states', async () => {
  get.mockResolvedValue({ ...adminDashboard, currentTerm: null });
  render(<Harness initial="/admin" />);
  expect(await screen.findByText('No active academic term.')).toBeInTheDocument();
  expect(screen.getByText('No recent activity.')).toBeInTheDocument();
});

test('creating a student validates locally and provisions through one mocked request', async () => {
  const saved = vi.fn();
  post.mockResolvedValue({ student });
  render(<StudentForm onClose={vi.fn()} onSaved={saved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('alert')).toHaveTextContent('firstName is required');
  expect(post).not.toHaveBeenCalled();
  for (const [label, value] of [
    ['First name', 'Demo'], ['Last name', 'Student'], ['University email', 'STUDENT@example.invalid'],
    ['Student number', student.studentNumber], ['Department', student.department!], ['Program', student.program!],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(student.id));
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/students', {
    firstName: 'Demo', lastName: 'Student', email: student.email, studentNumber: student.studentNumber,
    department: student.department, program: student.program, yearLevel: 1, academicStatus: 'active',
  });
});

test('an uncertain creation retains input and reviews existing accounts without sending another invitation', async () => {
  post.mockRejectedValue(new TypeError('Network response lost'));
  get.mockResolvedValue(page([{ ...student, activeHoldCount: 0 }]));
  render(<StudentForm onClose={vi.fn()} onSaved={vi.fn()} />);
  for (const [label, value] of [
    ['First name', 'Demo'], ['Last name', 'Student'], ['University email', student.email], ['Student number', student.studentNumber],
    ['Department', student.department!], ['Program', student.program!],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText(/Outcome not confirmed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review record' }));
  expect(await screen.findByRole('button', { name: 'Open matching account' })).toBeInTheDocument();
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('First name')).toHaveValue('Demo');
});

test('pending account actions serialize requests and refresh the committed access state', async () => {
  let finish!: (value: unknown) => void;
  get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, student: { ...detail.student, isActive: false } });
  post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<Harness initial={`/admin/students/${student.id}`} />);
  const deactivate = await screen.findByRole('button', { name: 'Deactivate' });
  fireEvent.click(deactivate); fireEvent.click(deactivate);
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Edit profile' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send recovery instructions' })).toBeDisabled();
  await act(async () => { finish({ student: { ...student, isActive: false } }); });
  expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeEnabled();
  expect(screen.getByText('Access deactivated.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send recovery instructions' })).not.toBeInTheDocument();
});

test('pending invitations offer resend while missing Auth metadata disables mail actions', async () => {
  get.mockResolvedValue({ ...detail, student: { ...detail.student, auth: { ...detail.student.auth, emailConfirmedAt: null } } });
  render(<Harness initial={`/admin/students/${student.id}`} />);
  expect(await screen.findByRole('button', { name: 'Resend invitation' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Send recovery instructions' })).not.toBeInTheDocument();
  cleanup(); get.mockResolvedValue({ ...detail, student: { ...detail.student, auth: null } });
  render(<Harness initial={`/admin/students/${student.id}`} />);
  expect(await screen.findByText(/Authentication identity is unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resend invitation' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test('closing an edit dialog restores its opener after account controls were disabled', async () => {
  get.mockResolvedValue(detail);
  render(<Harness initial={`/admin/students/${student.id}`} />);
  const opener = await screen.findByRole('button', { name: 'Edit profile' });
  opener.focus(); fireEvent.click(opener);
  expect(opener).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
  expect(opener).toBeEnabled();
});
