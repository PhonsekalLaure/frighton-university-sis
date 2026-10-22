import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiGet } from '../lib/api';
import { AdminHandoffPage } from './AdminHandoffPage';
import { HoldsPage } from './HoldsPage';

vi.mock('../lib/api', () => ({ apiGet: vi.fn() }));

const apiGetMock = vi.mocked(apiGet);

afterEach(cleanup);

describe('HoldsPage', () => {
  beforeEach(() => vi.resetAllMocks());

  test('shows a loading state while holds are requested', () => {
    apiGetMock.mockReturnValue(new Promise(() => undefined));

    render(<HoldsPage onNavigate={vi.fn()} />);

    expect(screen.getByText(/Loading your SIS records/)).toBeInTheDocument();
  });

  test('shows clear and empty-history states when the account has no holds', async () => {
    apiGetMock.mockResolvedValue({ activeHolds: [], resolvedHolds: [] });

    render(<HoldsPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('Your account is clear')).toBeInTheDocument();
    expect(screen.getByText('No resolved holds are recorded.')).toBeInTheDocument();
  });

  test('shows the API error without rendering false account data', async () => {
    apiGetMock.mockRejectedValue(new Error('Library records are temporarily unavailable.'));

    render(<HoldsPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('We could not load this page')).toBeInTheDocument();
    expect(screen.getByText('Library records are temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Your account is clear')).not.toBeInTheDocument();
  });

  test('shows active holds before resolved history and follows library guidance', async () => {
    const onNavigate = vi.fn();
    apiGetMock.mockResolvedValue({
      activeHolds: [{
        id: 'active-library-debt', holdType: 'library_debt', reason: 'Overdue library item',
        placedBySystem: 'Frighton LMS', placedAt: '2026-10-08T16:00:00.000Z', resolvedAt: null,
      }],
      resolvedHolds: [{
        id: 'resolved-disciplinary', holdType: 'disciplinary', reason: 'Conduct review',
        placedBySystem: 'Student Affairs', placedAt: '2026-09-01T16:00:00.000Z', resolvedAt: '2026-09-15T16:00:00.000Z',
      }],
    });

    render(<HoldsPage onNavigate={onNavigate} />);

    expect(await screen.findByText('Overdue library item')).toBeInTheDocument();
    expect(screen.getByText('Conduct review')).toBeInTheDocument();
    expect(screen.getByText(/active restrictions/i).compareDocumentPosition(screen.getByText('Resolved holds'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(onNavigate).toHaveBeenCalledWith('library');
  });
});

describe('AdminHandoffPage', () => {
  test('keeps an administrator out of the student shell and permits sign out', () => {
    const onLogout = vi.fn();

    render(<AdminHandoffPage user={{ email: 'admin@frighton.edu', fullName: 'Ada Admin', role: 'admin' }} onLogout={onLogout} />);

    expect(screen.getByText('Welcome, Ada Admin.')).toBeInTheDocument();
    expect(screen.getByText(/Student self-service pages are intentionally unavailable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
