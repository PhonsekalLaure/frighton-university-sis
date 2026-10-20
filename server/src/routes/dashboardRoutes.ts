import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, requireStudent, type AuthenticatedRequest } from '../middlewares/auth.js';
import { getDashboard } from '../services/dashboardService.js';

export const dashboardRouter = Router();

/**
 * GET /api/v1/dashboard/me
 * Returns the authenticated SIS user's profile, academic summary, current
 * billing balance, holds, and schedule for the current Manila calendar day.
 */
dashboardRouter.get('/me', requireAuth, requireStudent, async (
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
    res.json(await getDashboard(user.id));
  } catch (error) {
    next(error);
  }
});
