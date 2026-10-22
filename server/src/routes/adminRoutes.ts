import { Router, type Request, type RequestHandler } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { AdminService } from '../services/adminService.js';
import { emptyBody, filters, studentInput, uuid } from '../services/adminValidation.js';

export function createAdminRouter(service: AdminService = new AdminService(), authenticate: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authenticate, requireAdmin);
  const handle = (work: (req: Request, actorId: string) => Promise<unknown>, status = 200): RequestHandler =>
    async (req, res, next) => {
      try { res.status(status).json(await work(req, res.locals.user.id)); } catch (error) { next(error); }
    };
  router.get('/dashboard', handle((_req, actor) => service.dashboard(actor)));
  router.get('/students', handle((req, actor) => service.students(actor, filters(req.query))));
  router.post('/students', handle((req, actor) => service.create(actor, studentInput(req.body, true)), 201));
  router.get('/students/:studentId', handle((req, actor) => service.detail(actor, uuid(req.params.studentId))));
  router.patch('/students/:studentId', handle((req, actor) => service.update(actor, uuid(req.params.studentId), studentInput(req.body))));
  router.post('/students/:studentId/deactivate', handle((req, actor) => {
    emptyBody(req.body); return service.access(actor, uuid(req.params.studentId), false);
  }));
  router.post('/students/:studentId/reactivate', handle((req, actor) => {
    emptyBody(req.body); return service.access(actor, uuid(req.params.studentId), true);
  }));
  router.post('/students/:studentId/password-recovery', handle((req, actor) => {
    emptyBody(req.body); return service.recovery(actor, uuid(req.params.studentId));
  }, 202));
  router.get('/audit-logs', handle(req => service.auditLogs(filters(req.query, true))));
  return router;
}
