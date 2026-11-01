import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SetPasswordPage } from './SetPasswordPage';
import { App } from '../App';
import { apiGet, apiPost } from '../lib/api';
import { capturePasswordLink, type PasswordLink } from '../lib/passwordLink';

vi.mock('../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api')>(), apiGet: vi.fn(), apiPost: vi.fn() }));
const post = vi.mocked(apiPost), get = vi.mocked(apiGet);
const password = ' synthetic secure password ';
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, '', '/set-password'); });
afterEach(cleanup);
function form(type: 'invite' | 'recovery' = 'invite') {
  const link: PasswordLink = { tokenHash: 'synthetic_test_link_1234567890', type };
  const complete = vi.fn(), clear = vi.fn();
  render(<SetPasswordPage link={link} onClearLink={clear} onComplete={complete} />);
  return { link, complete, clear };
}
function fill(value = password, confirmation = value) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmation } });
}

test.each([
  '', '?token_hash=short&type=invite', '?token_hash=synthetic_link_1234567890&type=wrong',
  '?token_hash=synthetic_link_1234567890&token_hash=synthetic_link_0987654321&type=invite',
  '?token_hash=synthetic_link_1234567890&type=invite&type=recovery',
])('missing/repeated/invalid link parameters are scrubbed without token consumption: %s', query => {
  window.history.replaceState({}, '', '/set-password' + query + '#sensitive');
  expect(capturePasswordLink()).toBeNull();
  expect(window.location.search + window.location.hash).toBe('');
  form(); // rendering a separate synthetic fixture also does not consume a link.
  expect(post).not.toHaveBeenCalled();
});

test('visiting without a valid link provides an actionable sign-in exit', () => {
  render(<SetPasswordPage link={null} onClearLink={vi.fn()} onComplete={vi.fn()} />);
  expect(screen.getByText('This link is not valid')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Go to sign in' })).toBeInTheDocument();
});

test('locally invalid and mismatched passwords never consume the link', () => {
  form(); fill('short'); fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('12 and 128');
  fill(password, 'different'); fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
  expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test.each(['invite', 'recovery'] as const)('%s submits once, never trims passwords, clears link memory and requires login', async type => {
  let finish!: (value: unknown) => void;
  post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { link, clear, complete } = form(type); fill();
  const submit = screen.getByRole('button', { name: 'Set password' });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/auth/password/complete', { tokenHash: 'synthetic_test_link_1234567890', type, password });
  await act(async () => { finish({ requiresLogin: true }); });
  expect(screen.getByText('Password set successfully')).toBeInTheDocument();
  expect(link.tokenHash).toBe(''); expect(clear).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' })); expect(complete).toHaveBeenCalledOnce();
});

test.each([
  ['invalid_or_expired_link', 400, /expired or was already used/],
  ['password_update_rejected', 400, /fresh recovery link/],
  ['password_update_throttled', 429, /temporarily limited/],
  ['password_update_unknown', 503, /Try normal sign in first/],
  ['verification_unavailable', 503, /outcome could not be confirmed/],
])('remote %s disables token replay and provides specific guidance', async (code, status, message) => {
  post.mockRejectedValue(Object.assign(new Error('Provider failure'), { code, status }));
  const { link } = form(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(link.tokenHash).toBe('');
  expect(screen.queryByRole('button', { name: 'Set password' })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledOnce();
});

test('pre-verification rate limiting honors cooldown without automatic submission', async () => {
  post.mockRejectedValue(Object.assign(new Error('Slow down'), { code: 'rate_limited', status: 429, retryAfter: 1 }));
  const { link } = form(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
  expect(await screen.findByText('Try again in 1 seconds.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Set password' })).toBeEnabled(), { timeout: 2200 });
  expect(post).toHaveBeenCalledOnce(); expect(link.tokenHash).not.toBe('');
});

test('password success entered with an existing session never restores that session automatically', async () => {
  window.history.replaceState({}, '', '/set-password?token_hash=synthetic_test_link_1234567890&type=recovery');
  const link = capturePasswordLink();
  get.mockResolvedValue({ user: { id: 'old-session', role: 'admin', fullName: 'Old session' } });
  post.mockResolvedValue({ requiresLogin: true });
  render(<StrictMode><App initialPasswordLink={link} /></StrictMode>);
  fill(); fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
  expect(await screen.findByText('Password set successfully')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
  expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled(); expect(link?.tokenHash).toBe('');
});
