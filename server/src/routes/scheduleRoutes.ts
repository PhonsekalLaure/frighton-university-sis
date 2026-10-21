import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, requireStudent, type AuthenticatedRequest } from '../middlewares/auth.js';
import { getSchedule } from '../services/scheduleService.js';

export const scheduleRouter = Router();

/**
 * GET /api/v1/schedule/me
 * Returns the signed-in student's current-term academic assignments. It does
 * not create, change, or imply enrollment or registration.
 */
scheduleRouter.get('/me', requireAuth, requireStudent, async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user ?? res.locals.user;
    if (!user) {
      res.status(401).json({ error: 'Please sign in to access this resource.' });
      return;
    }
    res.json(await getSchedule(user.id));
  } catch (error) {
    next(error);
  }
});
