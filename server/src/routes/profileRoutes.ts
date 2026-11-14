import { Router, type RequestHandler } from 'express';
import { requireAuth, requireStudent } from '../middlewares/auth.js';
import { AccountError } from '../services/accountRateLimit.js';
import { ProfileService } from '../services/profileService.js';
import { clearAuthCookies } from '../utils/authCookies.js';

export function createProfileRouter(service = new ProfileService(), authenticate: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authenticate, requireStudent);
  router.get('/me', async (_req, res, next) => {
    try { res.json(await service.me(res.locals.user)); } catch (error) { next(error); }
  });
  router.post('/me/password', async (req, res, next) => {
    try {
      const result = await service.changePassword(res.locals.user, req.body, req.ip || 'unknown');
      clearAuthCookies(res);
      res.json(result);
    } catch (error) {
      if (error instanceof AccountError && error.code === 'password_update_unknown') clearAuthCookies(res);
      next(error);
    }
  });
  return router;
}
