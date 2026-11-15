import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { apiGet, apiPost } from '../lib/api';
import { student } from '../test/fixtures';
import { ProfilePage } from './ProfilePage';

vi.mock('../lib/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
const get = vi.mocked(apiGet), post = vi.mocked(apiPost);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ profile: student }); });
afterEach(cleanup);

async function fill(current = 'old password 123', next = 'new password 123', confirm = next) {
  fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
}

test('loads profile details with fallbacks for nullable fields', async () => {
  get.mockResolvedValue({ profile: { ...student, department: null, program: null, yearLevel: null } });
  render(<ProfilePage onRequireLogin={vi.fn()} />);
  expect(screen.getByText(/Loading your SIS records/)).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: student.fullName })).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(4);
  expect(screen.getByText(student.email)).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/api/v1/profile/me', expect.any(AbortSignal));
});

test('a missing profile shows the server error and permits a deliberate retry', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('Your SIS profile has not been provisioned yet.'), { status: 404 }));
  render(<ProfilePage onRequireLogin={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('not been provisioned');
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
});

test.each([
  ['old password 123', 'short', 'short', '12–128'],
  ['old password 123', 'new password 123', 'different password', 'confirmation must match'],
  ['old password 123', 'old password 123', 'old password 123', 'different from your current'],
])('validates password input before posting (%s / %s)', async (current, next, confirm, feedback) => {
  render(<ProfilePage onRequireLogin={vi.fn()} />);
  await fill(current, next, confirm);
  expect(screen.getByRole('alert')).toHaveTextContent(feedback);
  expect(post).not.toHaveBeenCalled();
});

test.each([true, false])('clears fields and requires login on success (sessions revoked: %s)', async sessionsRevoked => {
  const onRequireLogin = vi.fn();
  post.mockResolvedValue({ requiresLogin: true, sessionsRevoked });
  render(<ProfilePage onRequireLogin={onRequireLogin} />);
  await fill(' old password 123 ', ' new password 123 ');
  await waitFor(() => expect(onRequireLogin).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/v1/profile/me/password', {
    currentPassword: ' old password 123 ', newPassword: ' new password 123 ', confirmPassword: ' new password 123 ',
  });
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(onRequireLogin.mock.calls[0][0]).toContain(sessionsRevoked ? 'Your password changed.' : 'Other sessions could not be confirmed signed out.');
});

test('rate limits block resubmission until Retry-After elapses', async () => {
  post.mockRejectedValueOnce(Object.assign(new Error('Too many password attempts.'), { status: 429, code: 'rate_limited', retryAfter: 120 }));
  render(<ProfilePage onRequireLogin={vi.fn()} />);
  await fill();
  expect(await screen.findByRole('status')).toHaveTextContent('120 seconds');
  expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
  expect(post).toHaveBeenCalledOnce();
});

test('incorrect current password clears secrets and permits a deliberate retry', async () => {
  const onRequireLogin = vi.fn();
  post.mockRejectedValueOnce(Object.assign(new Error('Your current password is incorrect.'), { status: 400, code: 'incorrect_current_password' }));
  render(<ProfilePage onRequireLogin={onRequireLogin} />);
  await fill();
  expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is incorrect.');
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  expect(onRequireLogin).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledOnce();
});

test.each([
  Object.assign(new Error('Unknown'), { status: 503, code: 'password_update_unknown' }),
  new TypeError('Failed to fetch'),
])('uncertain outcomes require login without replaying the write', async failure => {
  const onRequireLogin = vi.fn();
  post.mockRejectedValue(failure);
  render(<ProfilePage onRequireLogin={onRequireLogin} />);
  await fill();
  await waitFor(() => expect(onRequireLogin).toHaveBeenCalledWith(expect.stringContaining('Try signing in')));
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('New password')).toHaveValue('');
});

test('blocks duplicate submissions while a password change is pending', async () => {
  post.mockReturnValue(new Promise(() => undefined));
  render(<ProfilePage onRequireLogin={vi.fn()} />);
  await fill();
  fireEvent.submit(screen.getByLabelText('Current password').closest('form')!);
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Updating password…' })).toBeDisabled();
});
