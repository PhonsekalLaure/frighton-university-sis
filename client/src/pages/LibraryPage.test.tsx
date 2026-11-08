import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LibraryPage } from './LibraryPage';
import { apiGet, apiPost, apiDelete } from '../lib/api';
vi.mock('../lib/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
const book = {
  id: 'book-1',
  title: 'Dracula',
  authors: ['Bram Stoker'],
  coverUrl: null,
  availableCopies: 1,
  totalCopies: 1,
  reservable: true,
};
const reservation = {
  id: 'r-1',
  status: 'ready_for_pickup',
  createdAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-04T00:00:00Z',
  pickupLocation: 'Main Library',
  book,
};
const account = {
  reservations: [] as (typeof reservation)[],
  loans: [] as any[],
  unpaidFines: [] as any[],
  eligibility: { canReserve: true, reason: null as string | null },
};
function reads(a = account) {
  vi.mocked(apiGet).mockImplementation(async (path) =>
    path === '/api/v1/library/me' ? structuredClone(a) : { items: [book], page: 1, pageSize: 12, total: 1 },
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test('loads account and catalog, searches with pagination, and submits only bookId', async () => {
  reads();
  vi.mocked(apiPost).mockResolvedValue(reservation);
  render(<LibraryPage />);
  expect(await screen.findByText('Dracula')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Title or author'), { target: { value: 'Bram Stoker' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('q=Bram+Stoker'), expect.any(AbortSignal)),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Reserve for pickup' }));
  await waitFor(() =>
    expect(apiPost).toHaveBeenCalledWith('/api/v1/library/reservations', { bookId: 'book-1' }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('ready for Main Library pickup');
});
test('displays blocked standing, read-only amounts, Manila dates, and confirms cancellation', async () => {
  reads({
    ...account,
    reservations: [reservation],
    eligibility: { canReserve: false, reason: 'Return your borrowed book before reserving another.' },
    loans: [
      {
        id: 'l-1',
        book: { ...book, title: 'Current loan' },
        dueAt: '2026-11-01T23:59:59+08:00',
        overdueDays: 2,
      },
    ],
    unpaidFines: [{ id: 'f-1', amount: 200, reason: 'Replacement charge', kind: 'replacement' }],
  });
  const navigate = vi.fn();
  vi.mocked(apiDelete).mockResolvedValue();
  render(<LibraryPage onNavigate={navigate} />);
  expect(await screen.findByText('Replacement charge')).toBeInTheDocument();
  expect(screen.getByText('₱200.00')).toBeInTheDocument();
  expect(screen.getByText(/Expires Nov 4, 2026/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reserve for pickup' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review Holds' }));
  expect(navigate).toHaveBeenCalledWith('holds');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
  expect(apiDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/v1/library/reservations/r-1'));
});
test('disabled integration shows the pending screen; failures do not show false empty accounts', async () => {
  vi.mocked(apiGet).mockRejectedValue(
    Object.assign(new Error('Not enabled'), { status: 503, code: 'LIBRARY_DISABLED' }),
  );
  render(<LibraryPage />);
  expect(await screen.findByText('Library self-service is not available yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reserve for pickup' })).not.toBeInTheDocument();
});
test('uncertain reservation is never replayed and requires account reconciliation', async () => {
  reads();
  vi.mocked(apiPost).mockRejectedValue(Object.assign(new Error('Upstream unavailable'), { status: 503 }));
  render(<LibraryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reserve for pickup' }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upstream unavailable');
  expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/v1/library/me').length).toBeGreaterThan(1);
});
