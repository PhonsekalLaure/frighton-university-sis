import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, requireStudent, type AuthenticatedRequest } from '../middlewares/auth.js';
import { getHolds } from '../services/holdsService.js';

export const holdsRouter = Router();

/**
 * GET /api/v1/holds/me
 *
 * Student-only, read-only account restrictions. A student cannot create,
 * resolve, or pay a hold from SIS.
 */
holdsRouter.get('/me', requireAuth, requireStudent, async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user ?? res.locals.user;
    if (!user) {
      res.status(401).json({ error: 'Please sign in to access your account.' });
      return;
    }
    res.json(await getHolds(user.id));
  } catch (error) {
    next(error);
  }
});
