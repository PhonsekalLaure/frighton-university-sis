import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { apiGet, apiPost } from './lib/api';
import { capturePasswordLink } from './lib/passwordLink';
import { adminDashboard, adminUser, dashboard, schedule, studentUser } from './test/fixtures';

vi.mock('./lib/api', async importOriginal => ({ ...await importOriginal<typeof import('./lib/api')>(), apiGet: vi.fn(), apiPost: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, '', '/'); });
afterEach(cleanup);
const get = vi.mocked(apiGet), post = vi.mocked(apiPost);

test('signing in from a schedule link renders dashboard at the dashboard URL', async () => {
  window.history.replaceState({}, '', '/schedule');
  get.mockImplementation(async path => { if (path === '/api/auth/me') throw Object.assign(new Error('Expired'), { status: 401 }); return dashboard; });
  post.mockResolvedValue({ user: studentUser });
  render(<App />);
  fireEvent.change(await screen.findByLabelText('University email'), { target: { value: studentUser.email } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: `Welcome, ${studentUser.fullName}.` })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard');
  expect(screen.queryByRole('heading', { name: 'My schedule' })).not.toBeInTheDocument();
});

test('direct links and browser back/forward derive the active page from the URL', async () => {
  window.history.replaceState({}, '', '/schedule');
  get.mockImplementation(async path => path === '/api/auth/me' ? { user: studentUser } : path.includes('/schedule') ? schedule : dashboard);
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'My schedule' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
  expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
  window.history.replaceState({}, '', '/schedule');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByRole('heading', { name: 'My schedule' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
});

test('student access denial returns to a matching dashboard page and URL', async () => {
  window.history.replaceState({}, '', '/admin/students');
  get.mockImplementation(async path => path === '/api/auth/me' ? { user: studentUser } : dashboard);
  render(<App />);
  expect(await screen.findByText('Administrator access required.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Return to student portal' }));
  expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/dashboard');
});

test('temporary bootstrap outages remain retryable and permission failures are explicit', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('Authentication unavailable'), { status: 503 }))
    .mockResolvedValueOnce({ user: adminUser }).mockResolvedValue(adminDashboard);
  render(<App />);
  expect(await screen.findByText('Authentication unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Sign in to your account' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Total students')).toBeInTheDocument();
  cleanup();
  get.mockRejectedValue(Object.assign(new Error('Account deactivated'), { status: 403 }));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
});

test('sign-out waits for cookie cleanup before offering another sign-in', async () => {
  let finish!: (value: unknown) => void;
  get.mockImplementation(async path => path === '/api/auth/me' ? { user: studentUser } : dashboard);
  post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(screen.getByText('Loading Frighton SIS…')).toBeInTheDocument();
  finish({});
  expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument();
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/auth/logout', {});
  expect(window.location.pathname).toBe('/login');
});

test('StrictMode password bootstrap scrubs once, skips session bootstrap, and exits to normal login', async () => {
  window.history.replaceState({}, '', '/set-password?token_hash=synthetic_password_link_1234567890&type=invite#secret');
  const link = capturePasswordLink();
  get.mockRejectedValue(Object.assign(new Error('No session'), { status: 401 }));
  render(<StrictMode><App initialPasswordLink={link} /></StrictMode>);
  expect(screen.getByRole('heading', { name: 'Create your SIS password' })).toBeInTheDocument();
  expect(window.location.search + window.location.hash).toBe('');
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
  expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument();
  expect(link?.tokenHash).toBe('');
  await waitFor(() => expect(window.location.pathname).toBe('/login'));
});

test.each([
  ['/login', studentUser, '/dashboard'], ['/billing', adminUser, '/admin'],
])('restored role sessions canonicalize %s without displaying a page under the wrong URL', async (path, user, expected) => {
  window.history.replaceState({}, '', path);
  get.mockImplementation(async requested => requested === '/api/auth/me' ? { user } : user.role === 'admin' ? adminDashboard : dashboard);
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe(expected));
  if (user.role === 'admin') expect(await screen.findByText('Total students')).toBeInTheDocument();
  else expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument();
});
