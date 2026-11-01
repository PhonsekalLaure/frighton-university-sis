import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BillingRecords, GradeRecords, ScheduleRecords } from '../components/RecordViews';
import { DashboardRecords } from './DashboardPage';
import { BillingPage } from './BillingPage';
import { apiGet } from '../lib/api';
import { billing, currentStatement, dashboard, grades, oldStatement, schedule } from '../test/fixtures';

vi.mock('../lib/api', () => ({ apiGet: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test('billing shows Manila receipt timestamps and switches every statement and receipt ledger', () => {
  render(<BillingRecords data={billing} />);
  const receipt = screen.getByText(/CURRENT-RECEIPT/);
  expect(receipt).not.toHaveTextContent('Invalid Date');
  expect(receipt.textContent).toMatch(/21/); // 16:30 UTC is the following Manila day.
  expect(screen.getByLabelText('Statement').querySelectorAll('option')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Statement'), { target: { value: oldStatement.id } });
  expect(screen.getByText(/OLD-RECEIPT/)).toBeInTheDocument();
  expect(screen.queryByText(/CURRENT-RECEIPT/)).not.toBeInTheDocument();
  expect(screen.getByText('HISTORICAL STATEMENT')).toBeInTheDocument();
  expect(screen.getByText(/official cashier receipt/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
});

test('no current statement retains historical access and no statements is not a confirmed zero', () => {
  const result = render(<BillingRecords data={{ ...billing, currentStatement: null, statements: [oldStatement] }} />);
  expect(screen.getByText(/No active-term statement/)).toBeInTheDocument();
  expect(screen.getByText(/OLD-RECEIPT/)).toBeInTheDocument();
  result.rerender(<BillingRecords data={{ ...billing, currentStatement: null, statements: [] }} />);
  expect(screen.getByRole('heading', { name: 'No statement available' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Statement')).not.toBeInTheDocument();
  expect(screen.queryByText(/₱0\.00/)).not.toBeInTheDocument();
});

test('calendar due dates do not shift and confirmed zero balances remain visible', () => {
  render(<BillingRecords data={{ ...billing, currentStatement: { ...currentStatement, outstandingBalance: 0 }, statements: [{ ...currentStatement, outstandingBalance: 0 }] }} />);
  expect(screen.getByRole('heading', { name: '₱0.00' })).toBeInTheDocument();
  expect(screen.getByText(/15.*Nov|Nov.*15/)).toBeInTheDocument();
});

test('missing grades are distinct from in-progress and withdrawn courses', () => {
  const course = grades.terms[0].courses[0];
  render(<GradeRecords data={{ ...grades, terms: [{ ...grades.terms[0], courses: [course,
    { ...course, id: 'none', grade: null, gradeStatus: 'not_recorded' },
    { ...course, id: 'ip', grade: 'IP', gradeStatus: 'in_progress' },
    { ...course, id: 'w', grade: 'W', gradeStatus: 'withdrawn' }] }] }} />);
  for (const label of ['A', 'Not recorded', 'In progress', 'Withdrawn']) expect(screen.getByText(label)).toBeInTheDocument();
});

test('dashboard distinguishes a missing statement from an actual zero balance', () => {
  const result = render(<DashboardRecords data={{ ...dashboard, billing: { ...dashboard.billing, status: null, outstandingBalance: 0 } }} />);
  expect(screen.getByText('No statement available')).toBeInTheDocument();
  result.rerender(<DashboardRecords data={{ ...dashboard, billing: { ...dashboard.billing, outstandingBalance: 0 } }} />);
  expect(screen.getByText('₱0.00 outstanding')).toBeInTheDocument();
});

test('student record failures render retry instead of false empty data', async () => {
  vi.mocked(apiGet).mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValueOnce(billing);
  render(<BillingPage />);
  expect(await screen.findByText('Temporary read failure')).toBeInTheDocument();
  expect(screen.queryByText('No statement available')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/CURRENT-RECEIPT/)).toBeInTheDocument();
  expect(screen.queryByText('Temporary read failure')).not.toBeInTheDocument();
});

test('the shared schedule presents instructor and assignment data without write controls', () => {
  render(<ScheduleRecords data={schedule} />);
  expect(screen.getByText('CS101 · Programming')).toBeInTheDocument();
  expect(screen.getByText('instructor@example.invalid')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
