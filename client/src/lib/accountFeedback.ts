import type { ApiFailure } from './api';

export function uncertainOutcome(error: ApiFailure) {
  return !error.status || (error.status >= 500 && !['rate_limit_unavailable', 'email_rejected', 'identity_inconsistent', 'provisioning_rejected'].includes(error.code ?? ''));
}

export function accountFeedback(error: ApiFailure) {
  if (error.code === 'identity_inconsistent') return 'Account identity needs operator review. Further email requests are disabled.';
  if (uncertainOutcome(error)) return 'Outcome not confirmed. The change or email may already have succeeded. Refresh and review the record before another attempt.';
  if (error.status === 429) return error.retryAfter ? `Please wait ${error.retryAfter} seconds before another request.` : 'Please wait before trying again. The server did not provide a reset time.';
  return error.message || 'The request could not be completed.';
}
