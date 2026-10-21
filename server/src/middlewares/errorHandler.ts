import { Request, Response, NextFunction } from 'express';
import { AuthError } from '../services/authService.js';

export const errorHandler = (
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err.status && err.status >= 400 && err.status < 600) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err.status === 413) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400) {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  // Keep configuration details out of the browser response, but make local
  // development failures actionable instead of logging only "Error".
  if (err.message === 'Supabase authentication is not configured.') {
    console.error('Supabase authentication is not configured. Check server/.env.');
    res.status(503).json({ error: 'Authentication service is not configured. Please contact the system administrator.' });
    return;
  }
  console.error('Unhandled SIS server error:', err.stack || err.message);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
};
