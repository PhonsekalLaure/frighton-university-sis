import { Router } from 'express';
import { PasswordService } from '../services/passwordService.js';
import { clearAuthCookies } from '../utils/authCookies.js';

export function createPasswordRouter(service = new PasswordService()) {
  const router = Router();
  router.post('/complete', async (req, res, next) => {
    try {
      const result = await service.complete(req.body, req.ip || 'unknown');
      clearAuthCookies(res);
      res.json(result);
    } catch (error) { next(error); }
  });
  return router;
}
