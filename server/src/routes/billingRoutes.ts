import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, requireStudent, type AuthenticatedRequest } from '../middlewares/auth.js';
import { getBilling } from '../services/billingService.js';

export const billingRouter = Router();

/**
 * GET /api/v1/billing/me
 *
 * Student-only, read-only account statements. This route deliberately has no
 * payment creation endpoint: cash is accepted and receipted by the university
 * cashier, then posted to the SIS by an authorized internal process.
 */
billingRouter.get('/me', requireAuth, requireStudent, async (
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
    res.json(await getBilling(user.id));
  } catch (error) {
    next(error);
  }
});
