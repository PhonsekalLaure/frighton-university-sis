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
  if (err.status === 413) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400) {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  console.error('Unhandled SIS server error:', err.name || err.message);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
};
