import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, requireStudent, type AuthenticatedRequest } from '../middlewares/auth.js';
import { getGrades } from '../services/gradesService.js';

export const gradesRouter = Router();

/**
 * GET /api/v1/grades/me
 * Returns the signed-in student's static transcript and GPA summary.
 */
gradesRouter.get('/me', requireAuth, requireStudent, async (
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
    res.json(await getGrades(user.id));
  } catch (error) {
    next(error);
  }
});
