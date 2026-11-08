import { config } from '../config/env.js';
export class LibraryError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function lmsRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  acceptImage = false,
): Promise<any> {
  if (!config.lms.serviceKey || config.lms.serviceKey === config.lms.apiKey)
    throw new LibraryError(503, 'LMS_UNAVAILABLE', 'Library integration is not configured.');
  try {
    const response = await fetch(config.lms.apiUrl + path, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: { 'x-sis-api-key': config.lms.serviceKey, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const status = [400, 403, 404, 409].includes(response.status) ? response.status : 503;
      const messages: Record<number, string> = {
        400: 'The library request is invalid.',
        403: 'Your library account is not eligible for this action.',
        404: 'The book or reservation was not found.',
        409: 'Availability or reservation status changed. Refresh and try again.',
        503: 'Library services are temporarily unavailable. Reload your account before retrying a reservation.',
      };
      throw new LibraryError(
        status,
        status === 503 ? 'LMS_UNAVAILABLE' : String(data.code || 'LIBRARY_REQUEST_FAILED'),
        messages[status],
      );
    }
    if (response.status === 204) return undefined;
    if (acceptImage) {
      const type = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Invalid image');
      return { bytes: Buffer.from(await response.arrayBuffer()), contentType: type };
    }
    return await response.json();
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    throw new LibraryError(
      503,
      'LMS_UNAVAILABLE',
      'Library services are temporarily unavailable. Reload your account before retrying a reservation.',
    );
  }
}
export function validLms<T>(value: unknown, guard: (v: any) => v is T): T {
  if (!guard(value))
    throw new LibraryError(
      503,
      'INVALID_LMS_RESPONSE',
      'Library services returned an invalid response. Please try again later.',
    );
  return value;
}
